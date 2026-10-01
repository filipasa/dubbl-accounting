import { db } from "@/lib/db";
import { whatsappMessageLog } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  getWhatsAppConfig,
  sendWhatsAppTextMessage,
  markWhatsAppMessageRead,
} from "./client";
import {
  resolveWhatsAppAuthContext,
  getOrganizationDetails,
  listRecentInvoices,
  listRecentQuotes,
  listAllContacts,
  createQuoteAction,
  createInvoiceAction,
  getInvoicePdfAction,
  getBankAccountsAction,
  executeMcpTool,
} from "./executor";
import type { AuthContext } from "@/lib/api/auth-context";

// Tool definitions for Gemini / OpenAI function calling
const TOOL_DEFINITIONS = [
  {
    name: "create_quote",
    description:
      "Create a sales quote / estimate in Fixbooks. Use this when the user asks for a 'quote', 'estimate', or 'pricing proposal'. Put ALL items (doors, materials, delivery fees, installation, etc.) as separate objects inside the 'lines' array of a SINGLE quote. NEVER create multiple quotes for one request.",
    parameters: {
      type: "OBJECT",
      properties: {
        customerName: {
          type: "STRING",
          description: "Name of the customer or business (e.g. LOGIN CONSTRUCTION LTD)",
        },
        customerEmail: {
          type: "STRING",
          description: "Customer email address if provided",
        },
        customerAddress: {
          type: "STRING",
          description: "Full customer postal address (e.g. 45 ROMNEY ROAD, HAYES, UB4 8PU)",
        },
        customerPhone: {
          type: "STRING",
          description: "Customer phone number if provided",
        },
        lines: {
          type: "ARRAY",
          description:
            "Array of line items. Include products, materials, and any delivery fee as separate items in this array.",
          items: {
            type: "OBJECT",
            properties: {
              description: {
                type: "STRING",
                description:
                  "Description of the good, service, or fee (e.g. 'frameless door with concealed design' or 'Delivery Fee')",
              },
              quantity: {
                type: "NUMBER",
                description: "Quantity of items (default: 1)",
              },
              unitPrice: {
                type: "NUMBER",
                description: "Unit price in pounds (e.g. 580 for £580, 90 for £90)",
              },
            },
            required: ["description", "unitPrice"],
          },
        },
        taxRatePercent: {
          type: "NUMBER",
          description: "VAT / Tax percentage (e.g. 20 for 20% VAT, 5 for 5%, 0 for zero rate)",
        },
        currencyCode: {
          type: "STRING",
          description: "Currency code (default: GBP)",
        },
        notes: {
          type: "STRING",
          description: "Optional notes or specifications",
        },
      },
      required: ["customerName", "lines"],
    },
  },
  {
    name: "create_invoice",
    description:
      "Create a sales invoice in Fixbooks. Use this ONLY when the user asks for an 'invoice' or 'bill'. Put ALL items and delivery fees into the 'lines' array of a SINGLE invoice.",
    parameters: {
      type: "OBJECT",
      properties: {
        customerName: {
          type: "STRING",
          description: "Name of the customer or business",
        },
        customerEmail: {
          type: "STRING",
          description: "Customer email address if provided",
        },
        customerAddress: {
          type: "STRING",
          description: "Full customer postal address",
        },
        customerPhone: {
          type: "STRING",
          description: "Customer phone number if provided",
        },
        lines: {
          type: "ARRAY",
          description:
            "Array of invoice line items. Include products, services, and delivery fees.",
          items: {
            type: "OBJECT",
            properties: {
              description: {
                type: "STRING",
                description: "Description of the good or service",
              },
              quantity: {
                type: "NUMBER",
                description: "Quantity of items (default: 1)",
              },
              unitPrice: {
                type: "NUMBER",
                description: "Unit price in pounds (e.g. 250 for £250)",
              },
            },
            required: ["description", "unitPrice"],
          },
        },
        taxRatePercent: {
          type: "NUMBER",
          description: "VAT / Tax percentage (e.g. 20 for 20% VAT)",
        },
        currencyCode: {
          type: "STRING",
          description: "Currency code (default: GBP)",
        },
        dueDate: {
          type: "STRING",
          description: "Due date (YYYY-MM-DD)",
        },
        notes: {
          type: "STRING",
          description: "Invoice notes",
        },
      },
      required: ["customerName", "lines"],
    },
  },
  {
    name: "list_quotes",
    description: "List recent sales quotes / estimates in Fixbooks.",
    parameters: {
      type: "OBJECT",
      properties: {
        limit: {
          type: "NUMBER",
          description: "Number of quotes to retrieve (default 5)",
        },
      },
    },
  },
  {
    name: "list_invoices",
    description: "List recent invoices in Fixbooks with status, numbers, and totals.",
    parameters: {
      type: "OBJECT",
      properties: {
        limit: {
          type: "NUMBER",
          description: "Number of invoices to retrieve (default 5)",
        },
      },
    },
  },
  {
    name: "get_invoice_pdf",
    description:
      "Get the download URL for an invoice PDF by invoice number (e.g. INV-00001) or UUID.",
    parameters: {
      type: "OBJECT",
      properties: {
        invoiceNumber: {
          type: "STRING",
          description: "The invoice number (e.g. INV-00001) or invoice ID",
        },
      },
      required: ["invoiceNumber"],
    },
  },
  {
    name: "list_contacts",
    description: "Search or list customer and supplier contacts.",
    parameters: {
      type: "OBJECT",
      properties: {
        search: {
          type: "STRING",
          description: "Optional customer or supplier name to search for",
        },
      },
    },
  },
  {
    name: "get_organization",
    description: "Get organization profile, currency, and address details.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
];

async function executeTool(ctx: AuthContext, name: string, args: Record<string, any> = {}) {
  switch (name) {
    case "create_quote": {
      let lines = args.lines;
      if (!lines && args.description) {
        lines = [
          {
            description: args.description,
            quantity: args.quantity || 1,
            unitPrice: args.unitPrice,
          },
        ];
      }
      return await createQuoteAction(ctx, {
        customerName: args.customerName || "Customer",
        ...args,
        lines,
      });
    }
    case "create_invoice": {
      let lines = args.lines;
      if (!lines && args.description) {
        lines = [
          {
            description: args.description,
            quantity: args.quantity || 1,
            unitPrice: args.unitPrice,
          },
        ];
      }
      return await createInvoiceAction(ctx, {
        customerName: args.customerName || "Customer",
        ...args,
        lines,
      });
    }
    case "list_quotes":
      return await listRecentQuotes(ctx, args.limit || 5);
    case "list_invoices":
      return await listRecentInvoices(ctx, args.limit || 5);
    case "list_contacts":
      return await listAllContacts(ctx, args.search || "");
    case "get_organization":
      return await getOrganizationDetails(ctx);
    case "get_invoice_pdf":
      return await getInvoicePdfAction(ctx, args.invoiceNumber);
    default:
      return await executeMcpTool(ctx, name, args);
  }
}

/**
 * Handles shortcut commands starting with ! or "help"
 */
export async function handleShortcutCommand(ctx: AuthContext, text: string): Promise<string> {
  const parts = text.split(" ");
  const command = parts[0].toLowerCase();
  const argsString = parts.slice(1).join(" ").trim();

  switch (command) {
    case "!help":
    case "help":
      return (
        `📋 *Fixbooks WhatsApp Commands:*\n\n` +
        `• *!quotes* — List recent quotes / estimates\n` +
        `• *!invoices* — List recent invoices\n` +
        `• *!invoice <Customer>, <Amount>, <Description>* — Create an invoice\n` +
        `  _Example:_ \`!invoice Filip Vacarciuc, 250, Oak Veneer Door\`\n` +
        `• *!contacts* — List current customers and suppliers\n` +
        `• *!org* — View company info and currency\n` +
        `• *!balance* — View bank accounts\n\n` +
        `💡 _You can also text me in full natural language (e.g. "Create a quote for Login Construction for 2 doors at £450 each")!_`
      );

    case "!org": {
      const org = await getOrganizationDetails(ctx);
      return (
        `🏢 *Organization Details*\n\n` +
        `• *Name:* ${org.name}\n` +
        `• *Currency:* ${org.defaultCurrency || "GBP"}\n` +
        `• *Country:* ${org.country || "GB"}\n` +
        `• *VAT/Tax ID:* ${org.taxId || "N/A"}\n` +
        `• *Payment Terms:* ${org.defaultPaymentTerms || "30 days"}`
      );
    }

    case "!quotes": {
      const quotes = await listRecentQuotes(ctx, 5);
      if (!quotes || quotes.length === 0) {
        return "📭 No quotes found in this organization.";
      }

      let reply = `📑 *Recent Quotes (${quotes.length})*\n\n`;
      for (const q of quotes) {
        const contactName = q.contact?.name || "Unknown Customer";
        const total = (q.total / 100).toFixed(2);
        const statusEmoji =
          q.status === "accepted" ? "✅" : q.status === "sent" ? "📬" : q.status === "draft" ? "📝" : "📄";
        reply += `${statusEmoji} *${q.quoteNumber || q.id}* — ${q.currencyCode} ${total}\n`;
        reply += `   Customer: ${contactName}\n`;
        reply += `   Status: *${(q.status || "").toUpperCase()}* | Expiry: ${q.expiryDate || "N/A"}\n\n`;
      }
      return reply.trim();
    }

    case "!invoices": {
      const invoices = await listRecentInvoices(ctx, 5);
      if (!invoices || invoices.length === 0) {
        return "📭 No invoices found in this organization.";
      }

      let reply = `🧾 *Recent Invoices (${invoices.length})*\n\n`;
      for (const inv of invoices) {
        const contactName = inv.contact?.name || "Unknown Customer";
        const total = (inv.total / 100).toFixed(2);
        const statusEmoji =
          inv.status === "paid" ? "✅" : inv.status === "sent" ? "📬" : "📝";
        reply += `${statusEmoji} *${inv.invoiceNumber}* — ${inv.currencyCode} ${total}\n`;
        reply += `   Customer: ${contactName}\n`;
        reply += `   Status: *${(inv.status || "").toUpperCase()}* | Date: ${inv.issueDate}\n\n`;
      }
      return reply.trim();
    }

    case "!contacts": {
      const contacts = await listAllContacts(ctx);
      if (!contacts || contacts.length === 0) {
        return "👥 No contacts found.";
      }
      let reply = `👥 *Contacts (${contacts.length})*\n\n`;
      for (const c of contacts) {
        reply += `• *${c.name}* (${c.type})\n`;
        if (c.email) reply += `  Email: ${c.email}\n`;
        if (c.phone) reply += `  Phone: ${c.phone}\n`;
      }
      return reply.trim();
    }

    case "!invoice": {
      if (!argsString) {
        return (
          `⚠️ *Usage:* \`!invoice <Customer>, <Amount>, <Description>\`\n\n` +
          `_Example:_ \`!invoice Filip Vacarciuc, 250, Oak Door Finishing\``
        );
      }

      const segments = argsString.split(",").map((s) => s.trim());
      if (segments.length < 2) {
        return (
          `⚠️ Please separate customer, amount, and description with commas.\n\n` +
          `_Example:_ \`!invoice Filip Vacarciuc, 250, Oak Door Finishing\``
        );
      }

      const customerName = segments[0];
      const amount = parseFloat(segments[1].replace(/[^0-9.]/g, ""));
      const description = segments[2] || "Products / Services";

      if (isNaN(amount) || amount <= 0) {
        return "⚠️ Invalid amount. Please enter a valid number (e.g. 250 or 99.50).";
      }

      const { invoice, contact } = await createInvoiceAction(ctx, {
        customerName,
        unitPrice: amount,
        description,
      });

      const totalFormatted = (invoice.total / 100).toFixed(2);
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      return (
        `✅ *Invoice Created Successfully!*\n\n` +
        `• *Invoice #:* ${invoice.invoiceNumber}\n` +
        `• *Customer:* ${contact.name}\n` +
        `• *Amount:* ${invoice.currencyCode} ${totalFormatted}\n` +
        `• *Item:* ${description}\n` +
        `• *Status:* ${invoice.status.toUpperCase()}\n` +
        `• *Due Date:* ${invoice.dueDate}\n\n` +
        `🔗 View in Fixbooks: ${appUrl}/sales/${invoice.id}`
      );
    }

    case "!balance": {
      const banks = await getBankAccountsAction(ctx);
      if (!banks || banks.length === 0) {
        return "🏦 No bank accounts registered yet.";
      }
      let reply = `🏦 *Bank Accounts*\n\n`;
      for (const b of banks) {
        reply += `• *${b.name}* (Code ${b.code})\n`;
      }
      return reply.trim();
    }

    default:
      return `❓ Unknown command \`${command}\`. Type \`!help\` to see available commands!`;
  }
}

/**
 * Handles natural language via Gemini REST API with multi-turn function calling
 */
async function handleGeminiNaturalLanguage(
  ctx: AuthContext,
  userMessage: string,
  apiKey: string
): Promise<string> {
  const org = await getOrganizationDetails(ctx);
  const systemPrompt = `You are a friendly, professional accounting assistant on WhatsApp for "${org.name}", a UK company.
All company transactions and amounts are in British Pounds (£ / GBP). Always display figures with the £ symbol (e.g. £250.00).

CRITICAL INSTRUCTIONS:
1. QUOTES vs INVOICES:
   - When the user asks to create a "Quote", "Estimate", or "Pricing proposal", you MUST execute the \`create_quote\` tool. NEVER call \`create_invoice\` when a quote was requested!
   - When the user asks for an "Invoice" or "Bill", execute the \`create_invoice\` tool.
2. MULTI-LINE ITEMS IN A SINGLE DOCUMENT:
   - NEVER create multiple separate quotes or invoices for a single transaction.
   - When the user provides multiple items, materials, or fees (such as products, delivery fees, installation), put ALL items into the \`lines\` array of ONE single quote or invoice.
   - Example \`lines\` array:
     [
       { "description": "1x frameless door with concealed design", "quantity": 1, "unitPrice": 580 },
       { "description": "Delivery Fee", "quantity": 1, "unitPrice": 90 }
     ]
3. CUSTOMER DETAILS & TAX:
   - If the user provides an address, email, or tax rate (e.g. 20%), pass them into customerEmail, customerAddress, and taxRatePercent.

When confirming the created quote or invoice, display a clean breakdown with the item names, subtotal, VAT/Tax, and final total with emojis. Keep messages polite, concise, and clean.`;

  const candidateModels = [
    "gemini-2.5-flash",
    "gemini-1.5-flash",
    "gemini-2.0-flash",
  ];

  let lastError: any = null;

  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const contents: any[] = [
        {
          role: "user",
          parts: [{ text: userMessage }],
        },
      ];

      // Up to 5 function-calling turns
      for (let turn = 0; turn < 5; turn++) {
        const payload = {
          system_instruction: {
            parts: [{ text: systemPrompt }],
          },
          contents,
          tools: [
            {
              function_declarations: TOOL_DEFINITIONS,
            },
          ],
        };

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`Gemini ${res.status}: ${errBody}`);
        }

        const data = await res.json();
        const candidate = data.candidates?.[0];
        if (!candidate || !candidate.content) {
          throw new Error("No candidate returned from Gemini");
        }

        const parts = candidate.content.parts || [];
        const functionCallPart = parts.find((p: any) => p.functionCall);

        if (!functionCallPart) {
          // Final text response
          const text = parts.map((p: any) => p.text).filter(Boolean).join("\n");
          return text || "Action completed.";
        }

        // Execute function call
        const call = functionCallPart.functionCall;
        console.log(`[WhatsApp Gemini Tool Call] ${call.name}:`, call.args);

        let toolResult: any;
        try {
          toolResult = await executeTool(ctx, call.name, call.args || {});
        } catch (toolErr: any) {
          toolResult = { error: toolErr.message || String(toolErr) };
        }

        // Add model's functionCall turn
        contents.push({
          role: "model",
          parts: [functionCallPart],
        });

        // Add tool response turn
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: call.name,
                response: { result: toolResult },
              },
            },
          ],
        });
      }

      return "Completed bookkeeping operations.";
    } catch (err: any) {
      console.warn(`[Gemini] Model ${model} failed:`, err.message || err);
      lastError = err;
      if (err.message?.includes("429") || err.message?.includes("503") || err.message?.includes("demand")) {
        continue;
      }
      break;
    }
  }

  console.error("Gemini all models failed:", lastError);
  return `⚠️ AI service is momentarily busy. You can use shortcut commands like \`!invoices\` or \`!invoice\`.`;
}

/**
 * Handles natural language via OpenAI REST API with multi-turn function calling
 */
async function handleOpenAiNaturalLanguage(
  ctx: AuthContext,
  userMessage: string,
  apiKey: string
): Promise<string> {
  try {
    const org = await getOrganizationDetails(ctx);
    const openAiTools = TOOL_DEFINITIONS.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: "object",
          properties: Object.fromEntries(
            Object.entries(t.parameters.properties).map(([k, v]: [string, any]) => [
              k,
              { type: v.type.toLowerCase(), description: v.description },
            ])
          ),
          required: t.parameters.required || [],
        },
      },
    }));

    const messages: any[] = [
      {
        role: "system",
        content: `You are a friendly accounting assistant for "${org.name}" on WhatsApp. Currency: ${org.defaultCurrency || "GBP"}. Format response cleanly for WhatsApp with emojis.`,
      },
      { role: "user", content: userMessage },
    ];

    for (let turn = 0; turn < 5; turn++) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages,
          tools: openAiTools,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenAI ${res.status}: ${errText}`);
      }

      const completion = await res.json();
      const choice = completion.choices?.[0];
      const message = choice?.message;

      if (!message) throw new Error("No response message from OpenAI");

      if (choice.finish_reason === "tool_calls" && message.tool_calls) {
        messages.push(message);

        for (const call of message.tool_calls) {
          const args = JSON.parse(call.function.arguments || "{}");
          console.log(`[WhatsApp OpenAI Tool Call] ${call.function.name}:`, args);
          let result: any;
          try {
            result = await executeTool(ctx, call.name, args);
          } catch (err: any) {
            result = { error: err.message || String(err) };
          }
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
        }
      } else {
        return message.content || "Done.";
      }
    }

    return "Completed bookkeeping operations.";
  } catch (err: any) {
    console.error("OpenAI error:", err);
    return `⚠️ Error processing natural language: ${err.message}`;
  }
}

/**
 * Main incoming WhatsApp message processor
 */
export async function processIncomingWhatsAppMessage({
  from,
  text,
  messageId,
  rawPayload,
}: {
  from: string;
  text: string;
  messageId?: string;
  rawPayload?: Record<string, unknown>;
}): Promise<{ reply: string; sent: boolean; error?: string }> {
  const config = getWhatsAppConfig();
  const cleanedFrom = from.replace(/[^0-9]/g, "");

  // 1. Authorization check
  if (config.allowedNumbers.length > 0 && !config.allowedNumbers.includes(cleanedFrom)) {
    console.warn(`[WhatsApp] Unauthorized message from +${cleanedFrom}`);
    const unauthReply = `🔒 *Fixbooks WhatsApp Bot: Access Restricted*\n\nYour phone number (+${cleanedFrom}) is not authorized. Please add this number to \`WHATSAPP_ALLOWED_NUMBERS\` in your environment settings.`;
    if (messageId) {
      await markWhatsAppMessageRead(messageId).catch(() => {});
    }
    await sendWhatsAppTextMessage({ to: cleanedFrom, text: unauthReply }).catch(() => {});
    return { reply: unauthReply, sent: true, error: "Unauthorized sender" };
  }

  // 2. Resolve AuthContext
  const ctx = await resolveWhatsAppAuthContext();

  // 3. Deduplication check
  if (messageId) {
    const existing = await db.query.whatsappMessageLog.findFirst({
      where: eq(whatsappMessageLog.messageId, messageId),
    });
    if (existing) {
      console.log(`[WhatsApp] Message ${messageId} already processed, skipping.`);
      return { reply: existing.messageBody || "", sent: false };
    }
  }

  // 4. Mark message as read
  if (messageId) {
    await markWhatsAppMessageRead(messageId).catch(() => {});
  }

  // 5. Insert inbound log
  let inboundLogId: string | null = null;
  try {
    const [inserted] = await db
      .insert(whatsappMessageLog)
      .values({
        organizationId: ctx.organizationId,
        messageId: messageId || null,
        senderPhone: cleanedFrom,
        direction: "inbound",
        messageBody: text,
        status: "received",
        rawPayload: rawPayload || null,
      })
      .returning({ id: whatsappMessageLog.id });
    inboundLogId = inserted?.id || null;
  } catch (dbErr) {
    console.warn("[WhatsApp] Failed to save inbound log:", dbErr);
  }

  // 6. Process message text
  const trimmed = (text || "").trim();
  let replyText = "";

  try {
    if (trimmed.startsWith("!") || trimmed.toLowerCase() === "help") {
      replyText = await handleShortcutCommand(ctx, trimmed);
    } else if (config.geminiApiKey) {
      replyText = await handleGeminiNaturalLanguage(ctx, trimmed, config.geminiApiKey);
    } else if (config.openaiApiKey) {
      replyText = await handleOpenAiNaturalLanguage(ctx, trimmed, config.openaiApiKey);
    } else {
      replyText =
        `👋 *Fixbooks WhatsApp Bot*\n\n` +
        `To chat in natural language (e.g. _"Create a quote for Login Construction for 2 doors at £450 each"_ or _"What are our recent invoices?"_):\n\n` +
        `🔑 *Configure Gemini API Key:*\n` +
        `Add \`GEMINI_API_KEY\` to your Vercel Environment Variables.\n\n` +
        `⚡ In the meantime, you can use instant shortcut commands:\n` +
        `• \`!invoices\` — View invoices\n` +
        `• \`!quotes\` — View quotes\n` +
        `• \`!invoice Filip, 250, Oak Door\` — Create invoice\n` +
        `• \`!org\` — Organization details\n` +
        `• \`!help\` — Full command list`;
    }
  } catch (err: any) {
    console.error("[WhatsApp] Error processing message content:", err);
    replyText = `⚠️ Something went wrong processing that request: ${err.message || "Internal error"}. Type \`!help\` for available commands.`;
  }

  // 7. Send reply via Meta WhatsApp Cloud API
  let sendResult: any = null;
  let sendError: string | undefined;

  try {
    sendResult = await sendWhatsAppTextMessage({
      to: cleanedFrom,
      text: replyText,
    });
  } catch (err: any) {
    console.error("[WhatsApp] Failed to send outbound WhatsApp message:", err);
    sendError = err.message || String(err);
  }

  // 8. Record outbound log and update inbound log
  try {
    await db.insert(whatsappMessageLog).values({
      organizationId: ctx.organizationId,
      messageId: sendResult?.messages?.[0]?.id || null,
      senderPhone: config.phoneNumberId || "bot",
      recipientPhone: cleanedFrom,
      direction: "outbound",
      messageBody: replyText,
      status: sendError ? "failed" : "sent",
      errorMessage: sendError || null,
    });

    if (inboundLogId) {
      await db
        .update(whatsappMessageLog)
        .set({ status: sendError ? "failed" : "processed" })
        .where(eq(whatsappMessageLog.id, inboundLogId));
    }
  } catch (dbErr) {
    console.warn("[WhatsApp] Failed to save outbound log:", dbErr);
  }

  return {
    reply: replyText,
    sent: !sendError,
    error: sendError,
  };
}
