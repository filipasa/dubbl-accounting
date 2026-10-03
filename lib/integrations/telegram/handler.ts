import { db } from "@/lib/db";
import { telegramMessageLog } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  getTelegramConfig,
  sendTelegramMessage,
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
} from "@/lib/integrations/whatsapp/executor";
import {
  resolveBotUserContext,
  linkConversationWithCode,
  unlinkConversation,
  getLinkedUserInfo,
} from "@/lib/integrations/bot-auth";
import type { AuthContext } from "@/lib/api/auth-context";
import type { TelegramUpdate } from "./types";

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
        quoteNumber: {
          type: "STRING",
          description: "Optional custom quote number if specified by user (e.g. QTE-00007)",
        },
        issueDate: {
          type: "STRING",
          description: "Date of issue (e.g. 09/08/2026 or 2026-08-09). Defaults to today if not provided.",
        },
        expiryDate: {
          type: "STRING",
          description: "Quote expiry date (e.g. 09/09/2026 or 2026-09-09)",
        },
        reference: {
          type: "STRING",
          description: "Customer PO number or reference",
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
                description: "Unit price in pounds (e.g. 250 for £250, 487.50 for £487.50)",
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
        invoiceNumber: {
          type: "STRING",
          description: "Explicit invoice number specified by user (e.g. '146233' or 'INV-00014')",
        },
        issueDate: {
          type: "STRING",
          description: "Date of issue (e.g. '09/08/2026' or '2026-08-09'). Defaults to today if not provided.",
        },
        dueDate: {
          type: "STRING",
          description: "Due date (e.g. '09/08/2026' or '2026-08-09')",
        },
        reference: {
          type: "STRING",
          description: "Customer PO number or order reference (e.g. '146233')",
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
 * Handles Telegram slash commands
 */
export async function handleTelegramCommand(ctx: AuthContext, text: string): Promise<string> {
  const parts = text.split(" ");
  // Strip bot mention if in group (e.g. /quotes@MyBot -> /quotes)
  const rawCommand = parts[0].split("@")[0].toLowerCase();
  const command = rawCommand.startsWith("/") ? rawCommand : `/${rawCommand}`;
  const argsString = parts.slice(1).join(" ").trim();

  switch (command) {
    case "/start":
    case "/help":
      return (
        `👋 <b>Fixbooks Telegram Bookkeeper</b>\n\n` +
        `I can create quotes, generate invoices, and fetch summaries directly for your business.\n\n` +
        `<b>Available Commands:</b>\n` +
        `• <b>/quotes</b> — List recent estimates & quotes\n` +
        `• <b>/invoices</b> — List recent sales invoices\n` +
        `• <b>/invoice &lt;Customer&gt;, &lt;Amount&gt;, &lt;Description&gt;</b> — Fast invoice creation\n` +
        `  <i>Example:</i> <code>/invoice John Doe, 350, Exterior Painting</code>\n` +
        `• <b>/contacts</b> — Current customers and suppliers\n` +
        `• <b>/org</b> — Company profile, currency, and VAT\n` +
        `• <b>/balance</b> — Registered bank accounts\n\n` +
        `💡 <i>You can also text me in full natural language (e.g. "Create a quote for Login Construction for 2 doors at £450 each")!</i>`
      );

    case "/org": {
      const org = await getOrganizationDetails(ctx);
      return (
        `🏢 <b>Organization Profile</b>\n\n` +
        `• <b>Name:</b> ${org.name}\n` +
        `• <b>Currency:</b> ${org.defaultCurrency || "GBP"}\n` +
        `• <b>Country:</b> ${org.country || "GB"}\n` +
        `• <b>VAT / Tax ID:</b> ${org.taxId || "N/A"}\n` +
        `• <b>Payment Terms:</b> ${org.defaultPaymentTerms || "30 days"}`
      );
    }

    case "/quotes": {
      const quotes = await listRecentQuotes(ctx, 5);
      if (!quotes || quotes.length === 0) {
        return "📭 No quotes found in this organization.";
      }

      let reply = `📑 <b>Recent Quotes (${quotes.length})</b>\n\n`;
      for (const q of quotes) {
        const contactName = q.contact?.name || "Unknown Customer";
        const total = (q.total / 100).toFixed(2);
        const statusEmoji =
          q.status === "accepted" ? "✅" : q.status === "sent" ? "📬" : q.status === "draft" ? "📝" : "📄";
        reply += `${statusEmoji} <b>${q.quoteNumber || q.id}</b> — ${q.currencyCode} ${total}\n`;
        reply += `   Customer: ${contactName}\n`;
        reply += `   Status: <b>${(q.status || "").toUpperCase()}</b> | Expiry: ${q.expiryDate || "N/A"}\n\n`;
      }
      return reply.trim();
    }

    case "/invoices": {
      const invoices = await listRecentInvoices(ctx, 5);
      if (!invoices || invoices.length === 0) {
        return "📭 No invoices found in this organization.";
      }

      let reply = `🧾 <b>Recent Invoices (${invoices.length})</b>\n\n`;
      for (const inv of invoices) {
        const contactName = inv.contact?.name || "Unknown Customer";
        const total = (inv.total / 100).toFixed(2);
        const statusEmoji =
          inv.status === "paid" ? "✅" : inv.status === "sent" ? "📬" : "📝";
        reply += `${statusEmoji} <b>${inv.invoiceNumber}</b> — ${inv.currencyCode} ${total}\n`;
        reply += `   Customer: ${contactName}\n`;
        reply += `   Status: <b>${(inv.status || "").toUpperCase()}</b> | Date: ${inv.issueDate}\n\n`;
      }
      return reply.trim();
    }

    case "/contacts": {
      const contacts = await listAllContacts(ctx);
      if (!contacts || contacts.length === 0) {
        return "👥 No contacts found.";
      }
      let reply = `👥 <b>Contacts (${contacts.length})</b>\n\n`;
      for (const c of contacts) {
        reply += `• <b>${c.name}</b> (${c.type})\n`;
        if (c.email) reply += `  Email: ${c.email}\n`;
        if (c.phone) reply += `  Phone: ${c.phone}\n`;
      }
      return reply.trim();
    }

    case "/invoice": {
      if (!argsString) {
        return (
          `⚠️ <b>Usage:</b> <code>/invoice &lt;Customer&gt;, &lt;Amount&gt;, &lt;Description&gt;</code>\n\n` +
          `<i>Example:</i> <code>/invoice Filip Vacarciuc, 250, Oak Door Finishing</code>`
        );
      }

      const segments = argsString.split(",").map((s) => s.trim());
      if (segments.length < 2) {
        return (
          `⚠️ Please separate customer, amount, and description with commas.\n\n` +
          `<i>Example:</i> <code>/invoice Filip Vacarciuc, 250, Oak Door Finishing</code>`
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
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.fixbooks.io";
      return (
        `✅ <b>Invoice Created Successfully!</b>\n\n` +
        `• <b>Invoice #:</b> ${invoice.invoiceNumber}\n` +
        `• <b>Customer:</b> ${contact.name}\n` +
        `• <b>Amount:</b> ${invoice.currencyCode} ${totalFormatted}\n` +
        `• <b>Item:</b> ${description}\n` +
        `• <b>Status:</b> ${invoice.status.toUpperCase()}\n` +
        `• <b>Due Date:</b> ${invoice.dueDate}\n\n` +
        `🔗 <a href="${appUrl}/sales/${invoice.id}">View in Fixbooks</a>`
      );
    }

    case "/whoami": {
      const info = await getLinkedUserInfo("telegram", parts[1] || "");
      if (info) {
        return (
          `👤 <b>Fixbooks Connected Account</b>\n\n` +
          `• <b>User:</b> ${info.user.name || "Fixbooks User"} (${info.user.email})\n` +
          `• <b>Organization:</b> ${info.org.name}\n` +
          `• <b>Role:</b> ${info.role.toUpperCase()}\n\n` +
          `💡 <i>To disconnect this chat from Fixbooks, type <b>/unlink</b>.</i>`
        );
      }
      return (
        `👤 <b>Fixbooks Connected Account</b>\n\n` +
        `• <b>User ID:</b> <code>${ctx.userId}</code>\n` +
        `• <b>Organization ID:</b> <code>${ctx.organizationId}</code>\n` +
        `• <b>Role:</b> ${ctx.role.toUpperCase()}\n\n` +
        `💡 <i>To disconnect this chat, type <b>/unlink</b>.</i>`
      );
    }

    case "/balance": {
      const banks = await getBankAccountsAction(ctx);
      if (!banks || banks.length === 0) {
        return "🏦 No bank accounts registered yet.";
      }
      let reply = `🏦 <b>Bank Accounts</b>\n\n`;
      for (const b of banks) {
        reply += `• <b>${b.name}</b> (Code ${b.code})\n`;
      }
      return reply.trim();
    }

    default:
      return `❓ Unknown command <code>${command}</code>. Type <b>/help</b> to see what I can do!`;
  }
}

/**
 * Handles natural language via Gemini REST API
 */
async function handleGeminiNaturalLanguage(
  ctx: AuthContext,
  userMessage: string,
  apiKey: string
): Promise<string> {
  const org = await getOrganizationDetails(ctx);
  const systemPrompt = `You are a friendly, professional accounting assistant on Telegram for "${org.name}", a UK company.
All company transactions and amounts are in British Pounds (£ / GBP). Always display figures with the £ symbol (e.g. £250.00).

CRITICAL INSTRUCTIONS:
1. QUOTES vs INVOICES:
   - When the user asks to create a "Quote", "Estimate", or "Pricing proposal", you MUST execute the \`create_quote\` tool. NEVER call \`create_invoice\` when a quote was requested!
   - When the user asks for an "Invoice" or "Bill", execute the \`create_invoice\` tool.
2. MULTI-LINE ITEMS IN A SINGLE DOCUMENT:
   - NEVER create multiple separate quotes or invoices for a single transaction.
   - When the user provides multiple items, materials, or fees (such as products, delivery fees, installation, shipping), put ALL items into the \`lines\` array of ONE single quote or invoice.
   - Example \`lines\` array:
     [
       { "description": "1x frameless door with concealed design", "quantity": 1, "unitPrice": 580 },
       { "description": "Delivery Fee", "quantity": 1, "unitPrice": 90 }
     ]
3. CUSTOMER DETAILS & TAX:
   - If the customer details include both a person name and a business/company name (e.g. "ILIE Sula" and "Zamos Construction LTD"), use the business name for customerName (e.g. "Zamos Construction LTD" or "Zamos Construction LTD (ILIE Sula)").
   - If the user provides an address, email, phone, or tax rate (e.g. 20%), pass them into customerEmail, customerAddress, customerPhone, and taxRatePercent.
4. INVOICE NUMBERS & DATES:
   - If user provides an explicit invoice number (e.g. "Invoice Number: 146233"), ALWAYS pass it into the "invoiceNumber" argument.
   - If user provides dates (e.g. "Date of issue: 09/08/2026", "Date due: 09/08/2026"), pass them into "issueDate" and "dueDate". Note that dates in the UK are DD/MM/YYYY.
5. NOTES:
   - NEVER put "Created via Telegram Bot", "Created via WhatsApp Bot", or any bot/integration branding into the notes field.
   - Do NOT put the customer address in the notes. Leave notes empty unless the user specifically provides customer/order notes.

TELEGRAM FORMATTING RULES:
- ONLY use Telegram-supported HTML tags: <b>bold</b>, <i>italic</i>, and <code>code</code>.
- NEVER use <h3>, <h2>, <h1>, <p>, <br>, <div>, or markdown (no ###, no ---).
- For section titles or totals, use bold text with an emoji, e.g. <b>Total: £685.00</b>.
When confirming the created quote or invoice, display a clean breakdown with the item names, subtotal, VAT/Tax, and final total with emojis.`;

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

      for (let turn = 0; turn < 5; turn++) {
        const payload = {
          system_instruction: {
            parts: [{ text: systemPrompt }],
          },
          contents,
          tools: [{ function_declarations: TOOL_DEFINITIONS }],
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
          const text = parts.map((p: any) => p.text).filter(Boolean).join("\n");
          return text || "Action completed.";
        }

        const call = functionCallPart.functionCall;
        console.log(`[Telegram Gemini Tool Call] ${call.name}:`, call.args);

        let toolResult: any;
        try {
          toolResult = await executeTool(ctx, call.name, call.args || {});
        } catch (toolErr: any) {
          toolResult = { error: toolErr.message || String(toolErr) };
        }

        contents.push({
          role: "model",
          parts: [functionCallPart],
        });

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
      console.warn(`[Telegram Gemini] Model ${model} failed:`, err.message || err);
      lastError = err;
      if (err.message?.includes("429") || err.message?.includes("503") || err.message?.includes("demand")) {
        continue;
      }
      break;
    }
  }

  console.error("Gemini all models failed:", lastError);
  return `⚠️ AI service is momentarily busy. You can use shortcut commands like <code>/invoices</code> or <code>/quotes</code>.`;
}

/**
 * Handles natural language via OpenAI REST API
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
        content: `You are a friendly accounting assistant for "${org.name}" on Telegram. Currency: ${org.defaultCurrency || "GBP"}. Format response with HTML tags <b>, <i>, <code> where suitable with emojis.`,
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
          console.log(`[Telegram OpenAI Tool Call] ${call.function.name}:`, args);
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
    console.error("[Telegram OpenAI error]:", err);
    return `⚠️ Error processing natural language: ${err.message}`;
  }
}

/**
 * Main incoming Telegram update processor
 */
export async function processIncomingTelegramUpdate(
  update: TelegramUpdate
): Promise<{ ok: boolean; reply?: string; error?: string }> {
  const message = update.message || update.edited_message;
  if (!message || !message.text) {
    return { ok: true };
  }

  const config = getTelegramConfig();
  const chatId = String(message.chat.id);
  const senderUsername = (message.from?.username || "").toLowerCase();
  const senderId = String(message.from?.id || "");
  const senderName = [message.from?.first_name, message.from?.last_name]
    .filter(Boolean)
    .join(" ");

  // 1. Authorization check
  if (config.allowedUsers.length > 0) {
    const isAuthorized =
      config.allowedUsers.includes(senderUsername) ||
      config.allowedUsers.includes(senderId);

    if (!isAuthorized) {
      console.warn(`[Telegram] Unauthorized access attempt from @${senderUsername} (${senderId})`);
      const unauthText = `🔒 <b>Fixbooks Access Restricted</b>\n\nYour Telegram account (@${senderUsername || senderId}) is not authorized. Please add your username or ID to <code>TELEGRAM_ALLOWED_USERS</code> in Fixbooks Settings.`;
      await sendTelegramMessage({ chatId, text: unauthText, parseMode: "HTML" }).catch(() => {});
      return { ok: true, error: "Unauthorized user" };
    }
  }

  // 2. Deduplication check
  if (update.update_id) {
    const existing = await db.query.telegramMessageLog.findFirst({
      where: eq(telegramMessageLog.updateId, update.update_id),
    });
    if (existing) {
      console.log(`[Telegram] Update ${update.update_id} already processed.`);
      return { ok: true };
    }
  }

  const trimmed = message.text.trim();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.fixbooks.io";

  // 3. Handle Link Command (/link <code> or /start link_<code> or /start FB-<code>)
  const isLinkCommand =
    trimmed.startsWith("/link") ||
    (trimmed.startsWith("/start") &&
      (trimmed.includes("link_") ||
        trimmed.includes("FB-") ||
        (/^\/start\s+[A-Za-z0-9_-]+$/.test(trimmed) && trimmed !== "/start")));

  if (isLinkCommand) {
    let code = "";
    if (trimmed.startsWith("/link")) {
      code = trimmed.replace(/^\/link\s*/i, "").trim();
    } else {
      const startArg = trimmed.replace(/^\/start\s*/i, "").trim();
      code = startArg.replace(/^link_/i, "").trim();
    }

    if (code) {
      const linkResult = await linkConversationWithCode(
        "telegram",
        chatId,
        code,
        { username: senderUsername, userId: senderId, displayName: senderName }
      );

      let linkReply = "";
      if (linkResult.success && linkResult.user && linkResult.org) {
        linkReply =
          `✅ <b>Account Linked Successfully!</b>\n\n` +
          `Welcome, <b>${linkResult.user.name || linkResult.user.email}</b>!\n` +
          `This Telegram chat is now connected to <b>${linkResult.org.name}</b> on Fixbooks.\n\n` +
          `All invoices, quotes, and reports will be saved directly under your account.\n\n` +
          `Type <b>/help</b> to see available commands or text me in natural language!`;
      } else {
        linkReply =
          `⚠️ <b>Linking Failed</b>\n\n` +
          `${linkResult.error || "Invalid or expired link code."}\n\n` +
          `To generate a fresh link code:\n` +
          `1. Log in to <a href="${appUrl}/settings/telegram">Fixbooks Settings &gt; Telegram</a>\n` +
          `2. Click <b>Connect Telegram</b>\n` +
          `3. Send <code>/link &lt;your-code&gt;</code> here.`;
      }

      await sendTelegramMessage({
        chatId,
        text: linkReply,
        parseMode: "HTML",
        replyToMessageId: message.message_id,
      }).catch(() => {});

      try {
        await db.insert(telegramMessageLog).values({
          organizationId: linkResult.org?.id || null,
          userId: linkResult.user?.id || null,
          updateId: update.update_id,
          messageId: message.message_id,
          chatId,
          senderUsername,
          senderName,
          direction: "inbound",
          messageBody: message.text,
          status: linkResult.success ? "processed" : "failed",
          errorMessage: linkResult.error || null,
        });
      } catch (dbErr) {
        console.warn("[Telegram] Failed to save link log:", dbErr);
      }

      return { ok: true, reply: linkReply };
    }
  }

  // 4. Handle Unlink Command (/unlink)
  if (trimmed.toLowerCase() === "/unlink") {
    await unlinkConversation("telegram", chatId);
    const unlinkReply =
      `👋 <b>Conversation Disconnected</b>\n\n` +
      `This Telegram chat is no longer connected to Fixbooks. You will not be able to create invoices or view financial data from this chat until you link again.`;

    await sendTelegramMessage({
      chatId,
      text: unlinkReply,
      parseMode: "HTML",
      replyToMessageId: message.message_id,
    }).catch(() => {});

    try {
      await db.insert(telegramMessageLog).values({
        updateId: update.update_id,
        messageId: message.message_id,
        chatId,
        senderUsername,
        senderName,
        direction: "inbound",
        messageBody: message.text,
        status: "processed",
      });
    } catch {}

    return { ok: true, reply: unlinkReply };
  }

  // 5. Resolve User Context for this specific conversation
  const ctx = await resolveBotUserContext("telegram", chatId, {
    username: senderUsername,
    userId: senderId,
    displayName: senderName,
  });

  // If conversation is NOT linked to any Fixbooks user, refuse action and instruct user
  if (!ctx) {
    const unlinkedText =
      `👋 <b>Fixbooks Telegram Assistant</b>\n\n` +
      `This Telegram chat is not connected to a Fixbooks user account yet.\n\n` +
      `Each conversation is separated and associated with a specific user so your business books stay private and secure.\n\n` +
      `<b>To connect your account:</b>\n` +
      `1. Log in to <a href="${appUrl}/settings/telegram">Fixbooks</a>\n` +
      `2. Go to <b>Settings &gt; Telegram Assistant</b>\n` +
      `3. Click <b>Connect Telegram</b> to get your link code\n` +
      `4. Reply here with: <code>/link &lt;your-code&gt;</code>\n\n` +
      `<i>Example:</i> <code>/link FB-123456</code>`;

    await sendTelegramMessage({
      chatId,
      text: unlinkedText,
      parseMode: "HTML",
      replyToMessageId: message.message_id,
    }).catch(() => {});

    try {
      await db.insert(telegramMessageLog).values({
        updateId: update.update_id,
        messageId: message.message_id,
        chatId,
        senderUsername,
        senderName,
        direction: "inbound",
        messageBody: message.text,
        status: "unlinked",
      });
    } catch {}

    return { ok: true, reply: unlinkedText };
  }

  // 6. Save inbound log with user and organization association
  let inboundLogId: string | null = null;
  try {
    const [inserted] = await db
      .insert(telegramMessageLog)
      .values({
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        updateId: update.update_id,
        messageId: message.message_id,
        chatId,
        senderUsername,
        senderName,
        direction: "inbound",
        messageBody: message.text,
        status: "received",
        rawPayload: update as unknown as Record<string, unknown>,
      })
      .returning({ id: telegramMessageLog.id });
    inboundLogId = inserted?.id || null;
  } catch (dbErr) {
    console.warn("[Telegram] Failed to save inbound log:", dbErr);
  }

  // 7. Process message text under user's AuthContext
  let replyText = "";

  try {
    if (trimmed.startsWith("/") || trimmed.toLowerCase() === "help") {
      replyText = await handleTelegramCommand(ctx, trimmed);
    } else if (config.geminiApiKey) {
      replyText = await handleGeminiNaturalLanguage(ctx, trimmed, config.geminiApiKey);
    } else if (config.openaiApiKey) {
      replyText = await handleOpenAiNaturalLanguage(ctx, trimmed, config.openaiApiKey);
    } else {
      replyText =
        `👋 <b>Fixbooks Telegram Bookkeeper</b>\n\n` +
        `To chat in natural language (e.g. <i>"Create a quote for Login Construction for 2 doors at £450 each"</i>):\n\n` +
        `🔑 <b>Add Gemini API Key:</b>\n` +
        `Add <code>GEMINI_API_KEY</code> to your Vercel Environment Variables.\n\n` +
        `⚡ In the meantime, use shortcut slash commands:\n` +
        `• <b>/invoices</b> — View invoices\n` +
        `• <b>/quotes</b> — View quotes\n` +
        `• <b>/invoice Filip, 250, Oak Door</b> — Create invoice\n` +
        `• <b>/org</b> — Organization details\n` +
        `• <b>/whoami</b> — Connected account details\n` +
        `• <b>/help</b> — Full command list`;
    }
  } catch (err: any) {
    console.error("[Telegram] Error processing message content:", err);
    replyText = `⚠️ Something went wrong processing that request: ${err.message || "Internal error"}. Type <b>/help</b> for commands.`;
  }

  // 8. Send reply via Telegram Bot API
  let sendError: string | undefined;
  let sentResult: any = null;

  try {
    sentResult = await sendTelegramMessage({
      chatId,
      text: replyText,
      parseMode: "HTML",
      replyToMessageId: message.message_id,
    });
  } catch (err: any) {
    console.error("[Telegram] Failed to send outbound Telegram message:", err);
    sendError = err.message || String(err);
  }

  // 9. Record outbound log and update inbound status
  try {
    await db.insert(telegramMessageLog).values({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      messageId: sentResult?.result?.message_id || null,
      chatId,
      senderUsername: "FixbooksBot",
      direction: "outbound",
      messageBody: replyText,
      status: sendError ? "failed" : "sent",
      errorMessage: sendError || null,
    });

    if (inboundLogId) {
      await db
        .update(telegramMessageLog)
        .set({ status: sendError ? "failed" : "processed" })
        .where(eq(telegramMessageLog.id, inboundLogId));
    }
  } catch (dbErr) {
    console.warn("[Telegram] Failed to save outbound log:", dbErr);
  }

  return {
    ok: !sendError,
    reply: replyText,
    error: sendError,
  };
}
