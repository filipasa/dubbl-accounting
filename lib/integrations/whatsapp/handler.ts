import { db } from "@/lib/db";
import { whatsappMessageLog } from "@/lib/db/schema";
import { eq, and, ne, desc } from "drizzle-orm";
import {
  getWhatsAppConfig,
  sendWhatsAppTextMessage,
  markWhatsAppMessageRead,
} from "./client";
import { getPublicAppUrl } from "@/lib/public-url";
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
  updateInvoiceAction,
  updateQuoteAction,
  sendInvoiceEmailAction,
  sendQuoteEmailAction,
  listUnreconciledBankTransactionsAction,
  getReconciliationSuggestionsAction,
  reconcileBankTransactionAction,
  getReconciliationReportAction,
  executeMcpTool,
  sanitizePortalUrls,
} from "./executor";
import {
  resolveBotUserContext,
  linkConversationWithCode,
  unlinkConversation,
  getLinkedUserInfo,
} from "@/lib/integrations/bot-auth";
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
                  "Product name or main service title ONLY (e.g. 'Pocket Door Kit'). Do NOT include size, dimensions, or specifications here.",
              },
              shortDescription: {
                type: "STRING",
                description:
                  "Short secondary description, specifications, dimensions, attributes, or size (e.g. 'Size: 1981 x 762'). NEVER merge into description.",
              },
              quantity: {
                type: "NUMBER",
                description: "Quantity of items (default: 1)",
              },
              unitPrice: {
                type: "NUMBER",
                description:
                  "Unit price in pounds (e.g. 580 for £580, 90 for £90). MUST be provided for every item. If the user did not specify prices in their message, DO NOT call this tool; ask the user for the unit prices first (unless they explicitly instructed to create a draft at £0 / no prices).",
              },
              discountPercent: {
                type: "NUMBER",
                description: "Optional line-level discount percentage (e.g. 5 for 5%, 10 for 10%)",
              },
            },
            required: ["description", "unitPrice"],
          },
        },
        shipping: {
          type: "NUMBER",
          description:
            "Shipping, delivery, or carriage fee in pounds (e.g. 15 for £15). This populates the dedicated shipping field below subtotal, NOT an ordinary line item.",
        },
        discount: {
          type: "STRING",
          description:
            "Discount to apply to the quote (e.g. '5%' for 5% off items subtotal, or fixed amount in pounds like '25' or '£25'). Fixbooks automatically creates a dedicated Discount line below subtotal. NEVER manually deduct discounts from product unit prices!",
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
                description: "Product name or main service title ONLY (e.g. 'Pocket Door Kit'). Do NOT include size or dimensions here.",
              },
              shortDescription: {
                type: "STRING",
                description:
                  "Short secondary description, specifications, dimensions, attributes, or size (e.g. 'Size: 1981 x 762'). NEVER merge into description.",
              },
              quantity: {
                type: "NUMBER",
                description: "Quantity of items (default: 1)",
              },
              unitPrice: {
                type: "NUMBER",
                description:
                  "Unit price in pounds (e.g. 250 for £250, 487.50 for £487.50). MUST be provided for every item. If the user did not specify prices in their message, DO NOT call this tool; ask the user for the unit prices first (unless they explicitly instructed to create a draft at £0 / no prices).",
              },
              discountPercent: {
                type: "NUMBER",
                description: "Optional line-level discount percentage (e.g. 5 for 5%, 10 for 10%)",
              },
            },
            required: ["description", "unitPrice"],
          },
        },
        shipping: {
          type: "NUMBER",
          description: "Shipping or delivery fee in pounds (e.g. 15 for £15). Adds shipping under the dedicated shipping field below subtotal.",
        },
        discount: {
          type: "STRING",
          description:
            "Discount to apply to the invoice (e.g. '5%' for 5% off items subtotal, or fixed amount in pounds like '25' or '£25'). Fixbooks automatically creates a dedicated Discount line below subtotal. NEVER manually deduct discounts from product unit prices!",
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
  {
    name: "edit_invoice",
    description:
      "Edit or update an existing draft sales invoice in Fixbooks (e.g. change quantity, unit price, line items, customer, due date, notes, or reference). Only draft invoices can be edited.",
    parameters: {
      type: "OBJECT",
      properties: {
        invoiceNumber: {
          type: "STRING",
          description: "The invoice number (e.g. INV-00017) or UUID of the invoice to edit",
        },
        customerName: {
          type: "STRING",
          description: "New customer name if changing customer",
        },
        lines: {
          type: "ARRAY",
          description: "Replacement array of line items. When provided, replaces existing lines.",
          items: {
            type: "OBJECT",
            properties: {
              description: {
                type: "STRING",
                description: "Product name or service title ONLY (e.g. 'Pocket Door Kit'). Do NOT put size or dimensions here.",
              },
              shortDescription: {
                type: "STRING",
                description:
                  "Short secondary description, specifications, dimensions, attributes, or size (e.g. 'Size: 1981 x 762').",
              },
              quantity: {
                type: "NUMBER",
                description: "Quantity (default 1)",
              },
              unitPrice: {
                type: "NUMBER",
                description: "Unit price in pounds (e.g. 250 for £250)",
              },
              discountPercent: {
                type: "NUMBER",
                description: "Optional line-level discount percentage (e.g. 5 for 5%, 10 for 10%)",
              },
            },
            required: ["description", "unitPrice"],
          },
        },
        shipping: {
          type: "NUMBER",
          description: "Shipping or delivery fee in pounds (e.g. 15 for £15)",
        },
        discount: {
          type: "STRING",
          description:
            "Discount to apply to the invoice (e.g. '5%' for 5% off items subtotal, or fixed amount in pounds like '25' or '£25'). Fixbooks automatically creates a dedicated Discount line below subtotal. NEVER manually deduct discounts from product unit prices!",
        },
        description: {
          type: "STRING",
          description: "Shorthand single line item description",
        },
        unitPrice: {
          type: "NUMBER",
          description: "Shorthand single line item unit price in pounds",
        },
        quantity: {
          type: "NUMBER",
          description: "Shorthand single line item quantity",
        },
        taxRatePercent: {
          type: "NUMBER",
          description: "VAT / Tax percentage (e.g. 20 for 20% VAT, 0 for zero rate)",
        },
        issueDate: {
          type: "STRING",
          description: "New issue date (e.g. 2026-10-05 or 05/10/2026)",
        },
        dueDate: {
          type: "STRING",
          description: "New due date (e.g. 2026-10-20 or 20/10/2026)",
        },
        reference: {
          type: "STRING",
          description: "PO number or reference",
        },
        notes: {
          type: "STRING",
          description: "Invoice notes",
        },
      },
      required: ["invoiceNumber"],
    },
  },
  {
    name: "edit_quote",
    description:
      "Edit or update an existing draft sales quote / estimate in Fixbooks (e.g. change quantity, price, line items, customer, expiry date, notes, or reference). Only draft quotes can be edited.",
    parameters: {
      type: "OBJECT",
      properties: {
        quoteNumber: {
          type: "STRING",
          description: "The quote number (e.g. QTE-00007) or UUID of the quote to edit",
        },
        customerName: {
          type: "STRING",
          description: "New customer name if changing customer",
        },
        lines: {
          type: "ARRAY",
          description: "Replacement array of line items. When provided, replaces existing lines.",
          items: {
            type: "OBJECT",
            properties: {
              description: {
                type: "STRING",
                description: "Product name or service title ONLY (e.g. 'Pocket Door Kit'). Do NOT put size or dimensions here.",
              },
              shortDescription: {
                type: "STRING",
                description:
                  "Short secondary description, specifications, dimensions, attributes, or size (e.g. 'Size: 1981 x 762').",
              },
              quantity: {
                type: "NUMBER",
                description: "Quantity (default 1)",
              },
              unitPrice: {
                type: "NUMBER",
                description: "Unit price in pounds (e.g. 450 for £450)",
              },
              discountPercent: {
                type: "NUMBER",
                description: "Optional line-level discount percentage (e.g. 5 for 5%, 10 for 10%)",
              },
            },
            required: ["description", "unitPrice"],
          },
        },
        shipping: {
          type: "NUMBER",
          description: "Shipping or delivery fee in pounds (e.g. 15 for £15)",
        },
        discount: {
          type: "STRING",
          description:
            "Discount to apply to the quote (e.g. '5%' for 5% off items subtotal, or fixed amount in pounds like '25' or '£25'). Fixbooks automatically creates a dedicated Discount line below subtotal. NEVER manually deduct discounts from product unit prices!",
        },
        description: {
          type: "STRING",
          description: "Shorthand single line item description",
        },
        unitPrice: {
          type: "NUMBER",
          description: "Shorthand single line item unit price in pounds",
        },
        quantity: {
          type: "NUMBER",
          description: "Shorthand single line item quantity",
        },
        taxRatePercent: {
          type: "NUMBER",
          description: "VAT / Tax percentage (e.g. 20 for 20% VAT, 0 for zero rate)",
        },
        issueDate: {
          type: "STRING",
          description: "New issue date (e.g. 2026-10-05 or 05/10/2026)",
        },
        expiryDate: {
          type: "STRING",
          description: "New expiry date (e.g. 2026-11-05 or 05/11/2026)",
        },
        reference: {
          type: "STRING",
          description: "PO number or reference",
        },
        notes: {
          type: "STRING",
          description: "Quote notes",
        },
      },
      required: ["quoteNumber"],
    },
  },
  {
    name: "send_invoice_email",
    description:
      "Send an invoice directly to the customer's email address with professional PDF attached and Pay by Bank payment link. If recipientEmail is not specified, uses the customer's email on file.",
    parameters: {
      type: "OBJECT",
      properties: {
        invoiceNumber: {
          type: "STRING",
          description: "The invoice number (e.g. INV-00017) or invoice ID to email",
        },
        recipientEmail: {
          type: "STRING",
          description: "Recipient email address. If omitted, uses the customer's email on file.",
        },
        personalMessage: {
          type: "STRING",
          description: "Optional personal message to include in the email body",
        },
        subject: {
          type: "STRING",
          description: "Optional custom email subject",
        },
      },
      required: ["invoiceNumber"],
    },
  },
  {
    name: "send_quote_email",
    description:
      "Send a sales quote / estimate directly to the customer's email address with professional PDF attached and link to view/accept. If recipientEmail is not specified, uses the customer's email on file.",
    parameters: {
      type: "OBJECT",
      properties: {
        quoteNumber: {
          type: "STRING",
          description: "The quote number (e.g. QTE-00007) or quote ID to email",
        },
        recipientEmail: {
          type: "STRING",
          description: "Recipient email address. If omitted, uses the customer's email on file.",
        },
        personalMessage: {
          type: "STRING",
          description: "Optional personal message to include in the email body",
        },
        subject: {
          type: "STRING",
          description: "Optional custom email subject",
        },
      },
      required: ["quoteNumber"],
    },
  },
  {
    name: "list_unreconciled_transactions",
    description:
      "List unreconciled bank transactions across registered bank accounts, showing amounts, dates, descriptions, references, and suggested matches (invoices, bills, or chart accounts). Use when the user asks to see unreconciled transactions, view bank activity for review, or asks what needs reconciling.",
    parameters: {
      type: "OBJECT",
      properties: {
        bankAccountName: {
          type: "STRING",
          description: "Optional bank account name to filter by (e.g. 'Wise', 'Tide', 'Barclays')",
        },
        limit: {
          type: "NUMBER",
          description: "Maximum number of transactions to return (default: 10)",
        },
      },
    },
  },
  {
    name: "get_reconciliation_suggestions",
    description:
      "Find candidate matches (open invoices, open bills, existing payments, or suggested chart accounts) for a specific bank transaction.",
    parameters: {
      type: "OBJECT",
      properties: {
        transactionId: {
          type: "STRING",
          description: "UUID, short ID (e.g. 6ab9e4fc), or description of the bank transaction",
        },
      },
      required: ["transactionId"],
    },
  },
  {
    name: "reconcile_bank_transaction",
    description:
      "Reconcile a bank transaction by matching it to an invoice (for incoming money), matching to a bill (for outgoing money), or categorizing to a chart-of-accounts account (e.g. 5000, Cost of Goods Sold, Office Supplies).",
    parameters: {
      type: "OBJECT",
      properties: {
        transactionId: {
          type: "STRING",
          description: "UUID or short 8-char ID (e.g. 6ab9e4fc) of the bank transaction to reconcile",
        },
        invoiceNumber: {
          type: "STRING",
          description: "Invoice number (e.g. INV-00017) to match incoming funds to",
        },
        billNumber: {
          type: "STRING",
          description: "Bill number (e.g. BILL-00001) to match outgoing funds to",
        },
        accountCodeOrName: {
          type: "STRING",
          description: "Chart of accounts code or name (e.g. 5000, 4000, Cost of Goods Sold, Advertising, Rent) to categorize to",
        },
        target: {
          type: "STRING",
          description: "Generic target identifier (e.g. 'INV-00017', 'BILL-00001', or '5000')",
        },
        memo: {
          type: "STRING",
          description: "Optional memo or description for the reconciled posting",
        },
      },
      required: ["transactionId"],
    },
  },
  {
    name: "get_reconciliation_report",
    description:
      "Generate a bank reconciliation proof report showing statement balance, general ledger balance, variance, and reconciled vs unreconciled line counts.",
    parameters: {
      type: "OBJECT",
      properties: {
        bankAccountName: {
          type: "STRING",
          description: "Optional bank account name (e.g. 'Wise', 'Barclays') to filter report by",
        },
      },
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
    case "edit_invoice":
    case "update_invoice":
      return await updateInvoiceAction(ctx, args as any);
    case "edit_quote":
    case "update_quote":
      return await updateQuoteAction(ctx, args as any);
    case "send_invoice_email":
      return await sendInvoiceEmailAction(ctx, args as any);
    case "send_quote_email":
      return await sendQuoteEmailAction(ctx, args as any);
    case "list_unreconciled_transactions": {
      const res = await listUnreconciledBankTransactionsAction(ctx, args as any);
      return res.formattedMessage || res;
    }
    case "get_reconciliation_suggestions": {
      const res = await getReconciliationSuggestionsAction(ctx, args as any);
      return res.formattedMessage || res;
    }
    case "reconcile_bank_transaction": {
      const res = await reconcileBankTransactionAction(ctx, args as any);
      return res.formattedMessage || res;
    }
    case "get_reconciliation_report": {
      const res = await getReconciliationReportAction(ctx, args as any);
      return res.formattedMessage || res;
    }
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
        `• *!sendinvoice <Invoice #> [email]* — Email invoice PDF & pay link\n` +
        `• *!sendquote <Quote #> [email]* — Email quote PDF\n` +
        `• *!reconcile* — View unreconciled bank transactions & match suggestions\n` +
        `• *!reconcile <tx_id> <INV-# / BILL-# / Account>* — Reconcile transaction\n` +
        `• *!reconcile report [bank]* — Bank reconciliation proof & GL balance\n` +
        `• *!contacts* — List current customers and suppliers\n` +
        `• *!org* — View company info and currency\n` +
        `• *!balance* — View bank accounts & balances\n\n` +
        `💡 _You can also text me in full natural language (e.g. "Create a quote...", "Reconcile transaction 6ab9e4fc with INV-00017", "Categorize 93ce783a as Cost of Goods Sold")!_`
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
      const appUrl = getPublicAppUrl();
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

    case "!whoami":
    case "/whoami": {
      const info = await getLinkedUserInfo("whatsapp", parts[1] || "");
      if (info) {
        return (
          `👤 *Fixbooks Connected Account*\n\n` +
          `• *User:* ${info.user.name || "Fixbooks User"} (${info.user.email})\n` +
          `• *Organization:* ${info.org.name}\n` +
          `• *Role:* ${info.role.toUpperCase()}\n\n` +
          `💡 _To disconnect this WhatsApp number, type \`!unlink\`._`
        );
      }
      return (
        `👤 *Fixbooks Connected Account*\n\n` +
        `• *User ID:* \`${ctx.userId}\`\n` +
        `• *Organization ID:* \`${ctx.organizationId}\`\n` +
        `• *Role:* ${ctx.role.toUpperCase()}\n\n` +
        `💡 _To disconnect this WhatsApp number, type \`!unlink\`._`
      );
    }

    case "!balance": {
      const banks = await getBankAccountsAction(ctx);
      if (!banks || banks.length === 0) {
        return "🏦 No bank accounts registered yet.";
      }
      let reply = `🏦 *Bank Accounts*\n\n`;
      for (const b of banks) {
        const bal = typeof b.balance === "number" ? `£${(b.balance / 100).toFixed(2)}` : null;
        reply += `• *${b.name}* (${b.currency || "GBP"})`;
        if (bal) reply += `: *${bal}*`;
        reply += `\n`;
        if (b.code) reply += `  Account: \`${b.code}\`\n`;
      }
      return reply.trim();
    }

    case "!reconcile": {
      if (!argsString) {
        const res = await listUnreconciledBankTransactionsAction(ctx);
        return res.formattedMessage;
      }

      const lowerArgs = argsString.toLowerCase();

      if (lowerArgs.startsWith("report")) {
        const bankName = argsString.replace(/^report\s*/i, "").trim();
        const res = await getReconciliationReportAction(
          ctx,
          bankName ? { bankAccountName: bankName } : undefined
        );
        return res.formattedMessage;
      }

      if (lowerArgs.startsWith("suggestions") || lowerArgs.startsWith("suggest")) {
        const txId = argsString.replace(/^(suggestions|suggest)\s*/i, "").trim();
        const res = await getReconciliationSuggestionsAction(ctx, { transactionId: txId });
        return res.formattedMessage;
      }

      const [txId, ...targetParts] = argsString.split(/\s+/);
      const target = targetParts.join(" ").trim();

      const res = await reconcileBankTransactionAction(ctx, {
        transactionId: txId,
        target: target || undefined,
      });

      return res.formattedMessage;
    }

    case "!reconcilereport": {
      const res = await getReconciliationReportAction(
        ctx,
        argsString ? { bankAccountName: argsString } : undefined
      );
      return res.formattedMessage;
    }

    default:
      return `❓ Unknown command \`${command}\`. Type \`!help\` to see available commands!`;
  }
}

/**
 * Loads recent WhatsApp conversation history for multi-turn context
 */
async function getRecentWhatsAppConversationHistory(
  senderPhone: string,
  excludeLogId?: string | null,
  limit = 8
): Promise<Array<{ role: "user" | "model"; text: string }>> {
  try {
    const logs = await db.query.whatsappMessageLog.findMany({
      where: and(
        eq(whatsappMessageLog.senderPhone, senderPhone),
        excludeLogId ? ne(whatsappMessageLog.id, excludeLogId) : undefined
      ),
      orderBy: desc(whatsappMessageLog.createdAt),
      limit: limit + 6,
    });

    if (!logs || logs.length === 0) return [];

    const valid = logs
      .filter((l) => {
        const body = (l.messageBody || "").trim();
        if (!body) return false;
        if (body.startsWith("!") || body.toLowerCase() === "help") return false;
        if (body.includes("AI service is momentarily busy")) return false;
        if (body.includes("Fixbooks Access Restricted")) return false;
        if (body.includes("This WhatsApp number is not connected")) return false;
        return true;
      })
      .slice(0, limit)
      .reverse();

    return valid.map((l) => ({
      role: l.direction === "outbound" ? ("model" as const) : ("user" as const),
      text: l.messageBody || "",
    }));
  } catch (err) {
    console.warn("[WhatsApp] Failed to fetch conversation history:", err);
    return [];
  }
}

function buildWhatsAppSystemPrompt(orgName: string): string {
  return `You are a friendly, professional accounting assistant on WhatsApp for "${orgName}", a UK company.
All company transactions and amounts are in British Pounds (£ / GBP). Always display figures with the £ symbol (e.g. £250.00).

CRITICAL INSTRUCTIONS:
1. QUOTES vs INVOICES & MANDATORY PRICES:
   - When the user asks to create a "Quote", "Estimate", or "Pricing proposal", execute the \`create_quote\` tool. NEVER call \`create_invoice\` when a quote was requested!
   - When the user asks for an "Invoice" or "Bill", execute the \`create_invoice\` tool.
   - MANDATORY PRICES & ASKING FOR MISSING INFORMATION (CRITICAL):
     * Every quote and invoice line item requires a unit price.
     * If the user sends a request to create a quote or invoice with items, schedules (e.g. door schedules), or materials WITHOUT providing unit prices:
       -> DO NOT call \`create_quote\` or \`create_invoice\` with £0.00!
       -> You MUST pause and reply to the user asking for the missing unit prices.
       -> Summarize the extracted items clearly (with quantities, references, dimensions, and finishes) and ask:
          "I have extracted the items for *[Customer Name]*:\n• [item 1]\n• [item 2]\n\nCould you please provide the unit prices for these items, or would you like me to create this draft at £0.00 so you can fill them in later?"
       -> When the user replies with the prices (or confirms to create it as a £0 draft / leave prices blank), merge with the prior conversation details and execute \`create_quote\` or \`create_invoice\`.
     * If only some items have prices and others are missing, ask for the prices of the missing items before executing the tool.
     * If the customer name is missing, ask for the customer name before creating the document.
2. PRODUCT NAME vs SHORT DESCRIPTION (CRITICAL):
   - In Fixbooks, line items have two distinct fields:
     * \`description\`: The product title or service name ONLY (e.g. "Pocket Door Kit").
     * \`shortDescription\`: The specifications, dimensions, attributes, or size (e.g. "Size: 1981 x 762").
   - If the user provides a product description/size (e.g. "Product Name: Pocket Door Kit Description: Size: 1981 x 762", or "Pocket Door Kit, Size: 1981 x 762"):
     * \`description\` MUST be ONLY "Pocket Door Kit".
     * \`shortDescription\` MUST be "Size: 1981 x 762".
     * NEVER concatenate the size or specifications into the description field!
3. SHIPPING & DELIVERY FEES (CRITICAL):
   - When the user specifies shipping, delivery, or carriage (e.g. "Shipping: 15£", "Delivery: £20", "Shipping fee: £15"):
     * Pass this amount in the top-level \`shipping\` argument of \`create_quote\` or \`create_invoice\` (e.g. \`shipping: 15\`).
     * Do NOT add shipping as a regular product line inside the \`lines\` array! The top-level \`shipping\` argument places it in the dedicated Shipping field below subtotal in Fixbooks.
4. DISCOUNTS & PROMOTIONS (CRITICAL):
   - When the user specifies a discount (e.g. "Discount: 5%", "apply 5% discount", "Discount: £25", "10% off", "5% discount"):
     * NEVER manually reduce or alter the product unitPrice!
     * Always pass the EXACT original unit price in lines (e.g. £568.33).
     * Pass the discount in the dedicated top-level \`discount\` parameter of \`create_quote\`, \`create_invoice\`, \`edit_quote\`, or \`edit_invoice\` (e.g. \`discount: "5%"\` or \`discount: "25"\`).
     * Fixbooks will automatically keep the full unit price on the product and create the dedicated Discount line below subtotal.
5. MULTI-LINE ITEMS IN A SINGLE DOCUMENT:
   - NEVER create multiple separate quotes or invoices for a single transaction.
   - When the user provides multiple items, put ALL items into the \`lines\` array of ONE single quote or invoice.
6. CUSTOMER DETAILS & TAX:
   - If the customer details include both a person name and a business/company name (e.g. "ILIE Sula" and "Zamos Construction LTD"), use the business name for customerName (e.g. "Zamos Construction LTD" or "Zamos Construction LTD (ILIE Sula)").
   - If the user provides an address, email, phone, or tax rate (e.g. 20%), pass them into customerEmail, customerAddress, customerPhone, and taxRatePercent.
7. INVOICE & QUOTE NUMBERS & DATES:
   - If user provides an explicit invoice number (e.g. "Invoice Number: 146233"), ALWAYS pass it into the "invoiceNumber" argument.
   - If user provides dates (e.g. "Date of issue: 09/08/2026", "Date due: 09/08/2026"), pass them into "issueDate" and "dueDate". Note that dates in the UK are DD/MM/YYYY.
   - For quotes, quotations are valid for 15 days from issue date. If the user does not specify an expiry date, expiryDate defaults to 15 days after issueDate.
8. NOTES:
   - NEVER put "Created via WhatsApp Bot", "Created via Telegram Bot", or any bot/integration branding into the notes field.
   - Do NOT put the customer address in the notes. Leave notes empty unless the user specifically provides customer/order notes.
9. INVOICE & QUOTE LINKS & PDF DOWNLOADS:
   - When the user asks for a link to an invoice or PDF (e.g. "Give me link to the invoice INV-00017"), ONLY provide the PDF download link (Download PDF: <downloadUrl>).
   - For quotes, provide the customer view/accept link (portalUrl) and the PDF download link (pdfUrl).
   - CRITICAL: When outputting customer portal links, use the EXACT portalUrl returned by the tool (e.g. https://fixbooks.io/portal/<token>/quotes). NEVER prefix it with "/api" or "/api/v1"! The customer portal is a web UI page at /portal/..., NOT an API endpoint.
   - NEVER output internal web app dashboard links like "View Online" or "/sales/" URLs.
10. EDITING INVOICES & QUOTES:
   - When the user asks to edit, update, modify, or change an existing invoice (e.g. "Edit invoice INV-00017...", "Update lines on INV-00017..."), call the \`edit_invoice\` tool with invoiceNumber and updated lines/fields.
   - When the user asks to edit, update, modify, or change an existing quote (e.g. "Edit quote QTE-00007...", "Change quote QTE-00007 price to..."), call the \`edit_quote\` tool with quoteNumber and updated lines/fields.
   - Only DRAFT documents can be edited.
11. SENDING INVOICES & QUOTES TO CUSTOMER EMAIL:
   - When the user asks to send or email an invoice to a customer (e.g. "Send invoice INV-00017 to customer email", "Email invoice INV-00017 to client@example.com"), execute the \`send_invoice_email\` tool.
   - When the user asks to send or email a quote to a customer (e.g. "Send quote QTE-00007 to customer email", "Email quote QTE-00007 to client@example.com"), execute the \`send_quote_email\` tool.
   - If the user provides a recipient email in their message, pass it into \`recipientEmail\`. If not provided, leave \`recipientEmail\` empty and the tool will automatically use the customer's email on file.
12. BANK RECONCILIATION & TRANSACTIONS:
   - When the user asks to see unreconciled transactions, review bank accounts, or asks what needs reconciling, call the \`list_unreconciled_transactions\` tool.
   - When the user asks for candidate matches or suggestions for a specific transaction (e.g. "What matches transaction 6ab9e4fc?"), call \`get_reconciliation_suggestions\`.
   - When the user asks to reconcile, match, or categorize a bank transaction (e.g. "Reconcile transaction 6ab9e4fc with invoice INV-00017", "Match 6ab9e4fc to INV-00017", "Categorize 93ce783a as Cost of Goods Sold", "Reconcile 93ce783a to 5000", "Match 9b4425d3 to bill BILL-00001"), call the \`reconcile_bank_transaction\` tool with transactionId and the corresponding invoiceNumber, billNumber, accountCodeOrName, or target.
   - When the user asks for a bank reconciliation report or proof of balances, call \`get_reconciliation_report\`.

WHATSAPP FORMATTING RULES:
- NEVER use HTML tags (NO <b>, NO <h3>, NO <br>, etc.). WhatsApp does NOT render HTML tags.
- Use WhatsApp markdown ONLY: *bold*, _italic_, ~strikethrough~, \`code\`.
- For section titles or totals, use emojis and bold text, e.g. *Total: £685.00*.
When confirming actions, display clean breakdowns with emojis.`;
}

/**
 * Handles natural language via Gemini REST API with multi-turn function calling
 */
async function handleGeminiNaturalLanguage(
  ctx: AuthContext,
  senderPhone: string,
  userMessage: string,
  apiKey: string,
  currentInboundId?: string | null
): Promise<string> {
  const org = await getOrganizationDetails(ctx);
  const systemPrompt = buildWhatsAppSystemPrompt(org.name);

  const candidateModels = [
    "gemini-flash-latest",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-2.5-flash",
  ];

  let lastError: any = null;

  // Load prior conversation history for multi-turn context
  const history = await getRecentWhatsAppConversationHistory(senderPhone, currentInboundId);
  const initialContents: any[] = history.map((h) => ({
    role: h.role,
    parts: [{ text: h.text }],
  }));
  initialContents.push({
    role: "user",
    parts: [{ text: userMessage }],
  });

  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const contents: any[] = JSON.parse(JSON.stringify(initialContents));

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
  senderPhone: string,
  userMessage: string,
  apiKey: string,
  currentInboundId?: string | null
): Promise<string> {
  try {
    const org = await getOrganizationDetails(ctx);
    const systemPrompt = buildWhatsAppSystemPrompt(org.name);
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

    const history = await getRecentWhatsAppConversationHistory(senderPhone, currentInboundId);

    const messages: any[] = [
      {
        role: "system",
        content: systemPrompt,
      },
      ...history.map((h) => ({
        role: h.role === "model" ? ("assistant" as const) : ("user" as const),
        content: h.text,
      })),
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

  // 2. Deduplication check
  if (messageId) {
    const existing = await db.query.whatsappMessageLog.findFirst({
      where: eq(whatsappMessageLog.messageId, messageId),
    });
    if (existing) {
      console.log(`[WhatsApp] Message ${messageId} already processed, skipping.`);
      return { reply: existing.messageBody || "", sent: false };
    }
  }

  // 3. Mark message as read
  if (messageId) {
    await markWhatsAppMessageRead(messageId).catch(() => {});
  }

  const trimmed = (text || "").trim();
  const appUrl = getPublicAppUrl();

  // 4. Handle Link Command (!link <code> or /link <code> or link <code>)
  const isLinkCommand =
    trimmed.startsWith("!link") ||
    trimmed.startsWith("/link") ||
    /^link\s+/i.test(trimmed);

  if (isLinkCommand) {
    const code = trimmed.replace(/^(!|\/)?link\s*/i, "").trim();
    if (code) {
      const linkResult = await linkConversationWithCode(
        "whatsapp",
        cleanedFrom,
        code,
        { displayName: cleanedFrom }
      );

      let linkReply = "";
      if (linkResult.success && linkResult.user && linkResult.org) {
        linkReply =
          `✅ *Account Linked Successfully!*\n\n` +
          `Welcome, *${linkResult.user.name || linkResult.user.email}*!\n` +
          `This WhatsApp number (+${cleanedFrom}) is now connected to *${linkResult.org.name}* on Fixbooks.\n\n` +
          `All invoices, quotes, and reports will be saved directly under your account.\n\n` +
          `Type \`!help\` to see available commands or message me in natural language!`;
      } else {
        linkReply =
          `⚠️ *Linking Failed*\n\n` +
          `${linkResult.error || "Invalid or expired link code."}\n\n` +
          `To generate a fresh link code:\n` +
          `1. Log in to Fixbooks: ${appUrl}/settings\n` +
          `2. Click *Connect WhatsApp*\n` +
          `3. Reply here with: \`!link <your-code>\``;
      }

      await sendWhatsAppTextMessage({
        to: cleanedFrom,
        text: linkReply,
      }).catch(() => {});

      try {
        await db.insert(whatsappMessageLog).values({
          organizationId: linkResult.org?.id || null,
          userId: linkResult.user?.id || null,
          messageId: messageId || null,
          senderPhone: cleanedFrom,
          direction: "inbound",
          messageBody: text,
          status: linkResult.success ? "processed" : "failed",
          errorMessage: linkResult.error || null,
        });
      } catch (dbErr) {
        console.warn("[WhatsApp] Failed to save link log:", dbErr);
      }

      return { reply: linkReply, sent: true };
    }
  }

  // 5. Handle Unlink Command (!unlink or /unlink)
  if (
    trimmed === "!unlink" ||
    trimmed === "/unlink" ||
    trimmed.toLowerCase() === "unlink"
  ) {
    await unlinkConversation("whatsapp", cleanedFrom);
    const unlinkReply =
      `👋 *Conversation Disconnected*\n\n` +
      `This WhatsApp number is no longer connected to Fixbooks. You will not be able to create invoices or view financial data from this chat until you link again.`;

    await sendWhatsAppTextMessage({
      to: cleanedFrom,
      text: unlinkReply,
    }).catch(() => {});

    try {
      await db.insert(whatsappMessageLog).values({
        messageId: messageId || null,
        senderPhone: cleanedFrom,
        direction: "inbound",
        messageBody: text,
        status: "processed",
      });
    } catch {}

    return { reply: unlinkReply, sent: true };
  }

  // 6. Resolve User Context for this specific conversation
  const ctx = await resolveBotUserContext("whatsapp", cleanedFrom);

  // If conversation is NOT linked to any Fixbooks user, refuse action and instruct user
  if (!ctx) {
    const unlinkedReply =
      `👋 *Fixbooks WhatsApp Assistant*\n\n` +
      `This WhatsApp number (+${cleanedFrom}) is not connected to a Fixbooks user account yet.\n\n` +
      `Each conversation is separated and associated with a specific user so your business books stay private and secure.\n\n` +
      `*To connect your account:*\n` +
      `1. Log in to Fixbooks: ${appUrl}/settings\n` +
      `2. Go to *Settings*\n` +
      `3. Click *Connect WhatsApp* to get your link code\n` +
      `4. Reply here with: \`!link <your-code>\`\n\n` +
      `_Example:_ \`!link FB-123456\``;

    await sendWhatsAppTextMessage({
      to: cleanedFrom,
      text: unlinkedReply,
    }).catch(() => {});

    try {
      await db.insert(whatsappMessageLog).values({
        messageId: messageId || null,
        senderPhone: cleanedFrom,
        direction: "inbound",
        messageBody: text,
        status: "unlinked",
      });
    } catch {}

    return { reply: unlinkedReply, sent: true };
  }

  // 7. Save inbound log with user and organization association
  let inboundLogId: string | null = null;
  try {
    const [inserted] = await db
      .insert(whatsappMessageLog)
      .values({
        organizationId: ctx.organizationId,
        userId: ctx.userId,
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

  // 8. Process message text under user's AuthContext
  let replyText = "";

  try {
    if (trimmed.startsWith("!") || trimmed.toLowerCase() === "help") {
      replyText = await handleShortcutCommand(ctx, trimmed);
    } else if (config.geminiApiKey) {
      replyText = await handleGeminiNaturalLanguage(ctx, cleanedFrom, trimmed, config.geminiApiKey, inboundLogId);
      if (replyText.includes("AI service is momentarily busy") && config.openaiApiKey) {
        console.log("[WhatsApp] Gemini busy, falling back to OpenAI...");
        replyText = await handleOpenAiNaturalLanguage(ctx, cleanedFrom, trimmed, config.openaiApiKey, inboundLogId);
      }
    } else if (config.openaiApiKey) {
      replyText = await handleOpenAiNaturalLanguage(ctx, cleanedFrom, trimmed, config.openaiApiKey, inboundLogId);
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
        `• \`!whoami\` — Connected account details\n` +
        `• \`!help\` — Full command list`;
    }
  } catch (err: any) {
    console.error("[WhatsApp] Error processing message content:", err);
    replyText = `⚠️ Something went wrong processing that request: ${err.message || "Internal error"}. Type \`!help\` for available commands.`;
  }

  // 9. Send reply via Meta WhatsApp Cloud API
  let sendResult: any = null;
  let sendError: string | undefined;

  // Sanitize any hallucinated /api/ or /api/v1/ prefix in customer portal UI links
  replyText = sanitizePortalUrls(replyText);

  try {
    sendResult = await sendWhatsAppTextMessage({
      to: cleanedFrom,
      text: replyText,
    });
  } catch (err: any) {
    console.error("[WhatsApp] Failed to send outbound WhatsApp message:", err);
    sendError = err.message || String(err);
  }

  // 10. Record outbound log and update inbound log
  try {
    await db.insert(whatsappMessageLog).values({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
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
