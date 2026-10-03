import {
  getOrganization,
  listInvoices,
  listQuotes,
  listContacts,
  listTaxRates,
  createInvoice,
  createQuote,
  callMcpTool,
} from "./mcp-client.js";
import { config } from "./config.js";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";

let geminiClient = null;
if (config.geminiApiKey) {
  geminiClient = new GoogleGenAI({ apiKey: config.geminiApiKey });
}

let openaiClient = null;
if (config.openaiApiKey) {
  openaiClient = new OpenAI({ apiKey: config.openaiApiKey });
}

// Tool definitions for Function Calling
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
          description: "Customer email address if provided (e.g. self.cognisance@gmail.com)",
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

async function executeTool(name, args = {}) {
  switch (name) {
    case "create_quote": {
      // Support legacy single item args if passed by model
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
      return await createQuote({
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
      return await createInvoice({
        ...args,
        lines,
      });
    }
    case "list_quotes":
      return await listQuotes(args.limit || 5);
    case "list_invoices":
      return await listInvoices(args.limit || 5);
    case "list_contacts":
      return await listContacts(args.search || "");
    case "get_organization":
      return await getOrganization();
    case "get_invoice_pdf": {
      const invoices = await listInvoices(50);
      const query = (args.invoiceNumber || "").trim().toLowerCase();
      const inv = invoices.find(
        (i) =>
          i.invoiceNumber?.toLowerCase() === query ||
          i.id?.toLowerCase() === query
      );
      if (!inv) {
        return { error: `Invoice "${args.invoiceNumber}" not found.` };
      }
      const pdfRes = await callMcpTool("get_invoice_pdf", { invoiceId: inv.id });
      return {
        invoiceNumber: inv.invoiceNumber,
        downloadUrl: pdfRes.downloadUrl,
        customerName: inv.contact?.name || "Customer",
        total: `£${(inv.total / 100).toFixed(2)}`,
        status: inv.status,
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function handleIncomingMessage(text, senderNumber) {
  try {
    const trimmed = text.trim();

    // 1. Shorthand commands starting with ! or "help"
    if (trimmed.startsWith("!") || trimmed.toLowerCase() === "help") {
      return await handleCommand(trimmed);
    }

    // 2. Natural language processing via Gemini
    if (geminiClient) {
      return await handleGeminiNaturalLanguage(trimmed);
    }

    // 3. Natural language processing via OpenAI
    if (openaiClient) {
      return await handleOpenAiNaturalLanguage(trimmed);
    }

    // 4. Guidance if no AI key configured yet
    return (
      `👋 *Fixbooks WhatsApp Bot*\n\n` +
      `To chat in natural language (e.g. _"Create an invoice for Filip for 2 doors at £250 each"_ or _"What are our recent invoices?"_):\n\n` +
      `🔑 *Add an AI Key:*\n` +
      `Add a free Gemini API key to \`services/whatsapp-bot/.env\`:\n` +
      `\`GEMINI_API_KEY="AIzaSy..."\`\n\n` +
      `⚡ In the meantime, you can use instant shortcut commands:\n` +
      `• \`!invoices\` — View invoices\n` +
      `• \`!invoice Filip Vacarciuc, 250, Oak Door\` — Create invoice\n` +
      `• \`!org\` — Organization details\n` +
      `• \`!help\` — Full command list`
    );
  } catch (err) {
    console.error("handleIncomingMessage error:", err);
    return "⚠️ Something went wrong on my end while processing that. Please try again in a moment, or type `!help` for available commands.";
  }
}

let cachedOrg = null;
let lastOrgFetch = 0;
async function getCachedOrganization() {
  if (cachedOrg && Date.now() - lastOrgFetch < 5 * 60 * 1000) {
    return cachedOrg;
  }
  try {
    cachedOrg = await getOrganization();
    lastOrgFetch = Date.now();
    return cachedOrg;
  } catch (e) {
    if (cachedOrg) return cachedOrg;
    return { name: "Doors Delivered", defaultCurrency: "GBP", country: "GB" };
  }
}

async function handleGeminiNaturalLanguage(userMessage) {
  const org = await getCachedOrganization();
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
    "gemini-3.1-flash-lite-preview",
    "gemini-flash-latest",
    "gemini-2.5-flash",
  ];

  let lastError = null;
  for (const model of candidateModels) {
    try {
      const chat = geminiClient.chats.create({
        model,
        config: {
          systemInstruction: systemPrompt,
          tools: [{ functionDeclarations: TOOL_DEFINITIONS }],
        },
      });

      let response = await chat.sendMessage({ message: userMessage });

      // Handle tool call loops
      while (response.functionCalls && response.functionCalls.length > 0) {
        const call = response.functionCalls[0];
        console.log(`[AI Tool Call] ${call.name}:`, call.args);

        let toolResult;
        try {
          toolResult = await executeTool(call.name, call.args);
        } catch (err) {
          toolResult = { error: err.message };
        }

        response = await chat.sendMessage({
          message: [
            {
              functionResponse: {
                name: call.name,
                response: { result: toolResult },
              },
            },
          ],
        });
      }

      return response.text || "Action completed.";
    } catch (err) {
      console.warn(`[Gemini] Model ${model} error:`, err.message || err);
      lastError = err;
      if (
        err.status === 503 ||
        err.status === 429 ||
        err.message?.includes("503") ||
        err.message?.includes("demand")
      ) {
        continue;
      }
      break;
    }
  }

  console.error("Gemini all models failed:", lastError);
  return `⚠️ Temporary AI service busy. You can use shortcut commands like \`!invoices\` or \`!invoice\`.`;
}

async function handleOpenAiNaturalLanguage(userMessage) {
  try {
    const org = await getOrganization();
    const openAiTools = TOOL_DEFINITIONS.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: "object",
          properties: Object.fromEntries(
            Object.entries(t.parameters.properties).map(([k, v]) => [
              k,
              { type: v.type.toLowerCase(), description: v.description },
            ])
          ),
          required: t.parameters.required || [],
        },
      },
    }));

    const messages = [
      {
        role: "system",
        content: `You are an accounting assistant for "${org.name}" on WhatsApp. Currency: ${org.defaultCurrency}. Use tools to perform actions. Format response cleanly for WhatsApp with emojis.`,
      },
      { role: "user", content: userMessage },
    ];

    let completion = await openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      tools: openAiTools,
    });

    while (completion.choices[0]?.finish_reason === "tool_calls") {
      const toolCalls = completion.choices[0].message.tool_calls || [];
      messages.push(completion.choices[0].message);

      for (const call of toolCalls) {
        const args = JSON.parse(call.function.arguments || "{}");
        console.log(`[OpenAI Tool Call] ${call.function.name}:`, args);
        let result;
        try {
          result = await executeTool(call.function.name, args);
        } catch (err) {
          result = { error: err.message };
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }

      completion = await openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
      });
    }

    return completion.choices[0]?.message?.content || "Done.";
  } catch (err) {
    console.error("OpenAI error:", err);
    return `⚠️ Error processing natural language: ${err.message}`;
  }
}

async function handleCommand(text) {
  try {
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
          `💡 _Add a GEMINI_API_KEY in .env to text in full natural language!_`
        );

      case "!org": {
        const org = await getOrganization();
        return (
          `🏢 *Organization Details*\n\n` +
          `• *Name:* ${org.name}\n` +
          `• *Currency:* ${org.defaultCurrency}\n` +
          `• *Country:* ${org.country || "GB"}\n` +
          `• *VAT/Tax ID:* ${org.taxId || "N/A"}\n` +
          `• *Payment Terms:* ${org.defaultPaymentTerms || "Default"}`
        );
      }

      case "!quotes": {
        const quotes = await listQuotes(5);
        if (quotes.length === 0) {
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
        const invoices = await listInvoices(5);
        if (invoices.length === 0) {
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
          reply += `   Status: *${inv.status.toUpperCase()}* | Date: ${inv.issueDate}\n\n`;
        }
        return reply.trim();
      }

      case "!contacts": {
        const contacts = await listContacts();
        if (contacts.length === 0) {
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

        const { invoice, contact } = await createInvoice({
          customerName,
          unitPrice: amount,
          description,
        });

        const totalFormatted = (invoice.total / 100).toFixed(2);
        return (
          `✅ *Invoice Created Successfully!*\n\n` +
          `• *Invoice #:* ${invoice.invoiceNumber}\n` +
          `• *Customer:* ${contact.name}\n` +
          `• *Amount:* ${invoice.currencyCode} ${totalFormatted}\n` +
          `• *Item:* ${description}\n` +
          `• *Status:* ${invoice.status.toUpperCase()}\n` +
          `• *Due Date:* ${invoice.dueDate}\n\n` +
          `🔗 View in Fixbooks: http://localhost:3001/invoices`
        );
      }

      case "!balance": {
        const bankAccounts = await callMcpTool("list_accounts", {
          type: "asset",
        });
        const banks = (bankAccounts.accounts || []).filter(
          (a) => a.subType === "bank" || a.name.toLowerCase().includes("bank")
        );
        if (banks.length === 0) {
          return "🏦 No bank accounts registered yet.";
        }
        let reply = `🏦 *Bank Accounts*\n\n`;
        for (const b of banks) {
          reply += `• *${b.name}* (Code ${b.code})\n`;
        }
        return reply.trim();
      }

      default:
        return `❓ Unknown command \`${command}\`. Type \`!help\` to see what I can do!`;
    }
  } catch (cmdErr) {
    console.error("handleCommand error:", cmdErr);
    return "⚠️ Sorry, I could not complete that command right now. Please try again or type `!help`.";
  }
}
