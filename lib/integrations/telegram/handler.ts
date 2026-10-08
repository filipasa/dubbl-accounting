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
  listRecentBills,
  listAllContacts,
  createQuoteAction,
  createInvoiceAction,
  createBillAction,
  normalizeDateInput,
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
      "Create a sales invoice for a customer in Fixbooks. Use this when the user asks to invoice a customer, bill a customer, or create a sales invoice. DO NOT use this for vendor/supplier bills (use create_bill instead). Put ALL items and delivery fees into the 'lines' array of a SINGLE invoice.",
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
    name: "create_bill",
    description:
      "Create a supplier / vendor bill (accounts payable) in Fixbooks. Use this when the user asks to create, add, or record a 'bill' from a supplier/vendor, or an expense bill. Put ALL items into the 'lines' array of a SINGLE bill.",
    parameters: {
      type: "OBJECT",
      properties: {
        supplierName: {
          type: "STRING",
          description: "Name of the supplier or vendor (e.g. Screwfix, Toolstation, Builders Depot)",
        },
        supplierEmail: {
          type: "STRING",
          description: "Supplier email address if provided",
        },
        supplierAddress: {
          type: "STRING",
          description: "Supplier postal address if provided",
        },
        lines: {
          type: "ARRAY",
          description:
            "Array of bill line items. Include products, materials, and services.",
          items: {
            type: "OBJECT",
            properties: {
              description: {
                type: "STRING",
                description: "Description of the good or service purchased",
              },
              quantity: {
                type: "NUMBER",
                description: "Quantity of items (default: 1)",
              },
              unitPrice: {
                type: "NUMBER",
                description: "Unit price in pounds (e.g. 120 for £120, 45.50 for £45.50)",
              },
            },
            required: ["description", "unitPrice"],
          },
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
          description: "Shorthand single line item quantity (default: 1)",
        },
        taxRatePercent: {
          type: "NUMBER",
          description: "VAT / Tax percentage (e.g. 20 for 20% VAT, 0 for zero rate)",
        },
        currencyCode: {
          type: "STRING",
          description: "Currency code (default: GBP)",
        },
        reference: {
          type: "STRING",
          description: "Supplier's invoice reference number (e.g. INV-98234 or receipt #)",
        },
        issueDate: {
          type: "STRING",
          description: "Bill date / invoice date from supplier (e.g. 2026-10-08)",
        },
        dueDate: {
          type: "STRING",
          description: "Payment due date (e.g. 2026-11-08)",
        },
        notes: {
          type: "STRING",
          description: "Optional notes for the bill",
        },
        accountCodeOrName: {
          type: "STRING",
          description: "Expense account code or name (e.g. 5000, Cost of Goods Sold, Materials)",
        },
      },
      required: ["supplierName"],
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
    name: "list_bills",
    description: "List recent supplier / vendor bills in Fixbooks with status, numbers, suppliers, and totals.",
    parameters: {
      type: "OBJECT",
      properties: {
        limit: {
          type: "NUMBER",
          description: "Number of bills to retrieve (default 5)",
        },
        status: {
          type: "STRING",
          description: "Optional status filter (e.g. draft, received, paid, overdue)",
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
                description: "Line item description",
              },
              quantity: {
                type: "NUMBER",
                description: "Quantity (default 1)",
              },
              unitPrice: {
                type: "NUMBER",
                description: "Unit price in pounds (e.g. 250 for £250)",
              },
            },
            required: ["description", "unitPrice"],
          },
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
                description: "Line item description",
              },
              quantity: {
                type: "NUMBER",
                description: "Quantity (default 1)",
              },
              unitPrice: {
                type: "NUMBER",
                description: "Unit price in pounds (e.g. 450 for £450)",
              },
            },
            required: ["description", "unitPrice"],
          },
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
    case "create_bill": {
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
      return await createBillAction(ctx, {
        supplierName: args.supplierName || args.vendorName || args.customerName || "Supplier",
        ...args,
        lines,
      });
    }
    case "list_quotes":
      return await listRecentQuotes(ctx, args.limit || 5);
    case "list_invoices":
      return await listRecentInvoices(ctx, args.limit || 5);
    case "list_bills":
      return await listRecentBills(ctx, args.limit || 5);
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
        `I can create quotes, generate invoices, record supplier bills, edit them, email them to your customers with PDFs and payment links, and reconcile your bank transactions.\n\n` +
        `<b>Available Commands:</b>\n` +
        `• <b>/quotes</b> — List recent estimates & quotes\n` +
        `• <b>/invoices</b> — List recent sales invoices\n` +
        `• <b>/bills</b> — List recent supplier & vendor bills\n` +
        `• <b>/invoice &lt;Customer&gt;, &lt;Amount&gt;, &lt;Description&gt;</b> — Fast invoice creation\n` +
        `  <i>Example:</i> <code>/invoice John Doe, 350, Exterior Painting</code>\n` +
        `• <b>/bill &lt;Supplier&gt;, &lt;Amount&gt;, &lt;Description&gt; [DueDate]</b> — Fast bill creation\n` +
        `  <i>Example:</i> <code>/bill Screwfix, 120, Building Materials</code>\n` +
        `• <b>/sendinvoice &lt;Invoice #&gt; [email]</b> — Email invoice PDF & pay link to customer\n` +
        `  <i>Example:</i> <code>/sendinvoice INV-00017 client@example.com</code>\n` +
        `• <b>/sendquote &lt;Quote #&gt; [email]</b> — Email quote PDF to customer\n` +
        `  <i>Example:</i> <code>/sendquote QTE-00007 client@example.com</code>\n` +
        `• <b>/reconcile</b> — View unreconciled bank transactions & match suggestions\n` +
        `• <b>/reconcile &lt;tx_id&gt; &lt;INV-# / BILL-# / Account&gt;</b> — Reconcile transaction\n` +
        `  <i>Example:</i> <code>/reconcile 6ab9e4fc INV-00017</code> or <code>/reconcile 93ce783a 5000</code>\n` +
        `• <b>/reconcile report [bank]</b> — Bank reconciliation proof & GL balance\n` +
        `• <b>/contacts</b> — Current customers and suppliers\n` +
        `• <b>/org</b> — Company profile, currency, and VAT\n` +
        `• <b>/balance</b> — Registered bank accounts & balances\n\n` +
        `💡 <i>You can also message me in full natural language:</i>\n` +
        `• "Create a quote for Login Construction for 2 doors at £450 each"\n` +
        `• "Create a bill from Screwfix for £120 for building materials"\n` +
        `• "Edit invoice INV-00017 with 3 doors at £600 each"\n` +
        `• "Edit quote QTE-00007: change price to £450"\n` +
        `• "Send invoice INV-00017 to customer email"\n` +
        `• "Send quote QTE-00007 to customer email"\n` +
        `• "Show unreconciled bank transactions"\n` +
        `• "Reconcile transaction 6ab9e4fc with invoice INV-00017"\n` +
        `• "Categorize transaction 93ce783a as Cost of Goods Sold"\n` +
        `• "Give me a bank reconciliation report for Wise"`
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

    case "/bills": {
      const bills = await listRecentBills(ctx, 5);
      if (!bills || bills.length === 0) {
        return "📭 No bills found in this organization.";
      }

      let reply = `🧾 <b>Recent Bills (${bills.length})</b>\n\n`;
      for (const b of bills) {
        const contactName = b.contact?.name || "Unknown Supplier";
        const total = (b.total / 100).toFixed(2);
        const statusEmoji =
          b.status === "paid"
            ? "✅"
            : b.status === "received" || b.status === "approved"
            ? "📬"
            : b.status === "pending_approval"
            ? "⏳"
            : b.status === "draft"
            ? "📝"
            : b.status === "overdue"
            ? "⚠️"
            : b.status === "void"
            ? "🚫"
            : "📄";
        reply += `${statusEmoji} <b>${b.billNumber}</b> — ${b.currencyCode} ${total}\n`;
        reply += `   Supplier: ${contactName}\n`;
        reply += `   Status: <b>${(b.status || "").toUpperCase()}</b> | Due: ${b.dueDate || "N/A"}\n\n`;
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

    case "/bill": {
      if (!argsString) {
        return (
          `⚠️ <b>Usage:</b> <code>/bill &lt;Supplier&gt;, &lt;Amount&gt;, &lt;Description&gt; [optional Due Date]</code>\n\n` +
          `<i>Example:</i> <code>/bill Screwfix, 120, Building Materials</code>\n` +
          `<i>Example:</i> <code>/bill Toolstation, 45.50, Screws and Drill Bits, 2026-10-25</code>`
        );
      }

      const segments = argsString.split(",").map((s) => s.trim());
      if (segments.length < 2) {
        return (
          `⚠️ Please separate supplier, amount, and description with commas.\n\n` +
          `<i>Example:</i> <code>/bill Screwfix, 120, Building Materials</code>`
        );
      }

      const supplierName = segments[0];
      const amount = parseFloat(segments[1].replace(/[^0-9.]/g, ""));
      const description = segments[2] || "Supplier Bill Item";
      const dueDate = segments[3] ? normalizeDateInput(segments[3]) : undefined;

      if (isNaN(amount) || amount <= 0) {
        return "⚠️ Invalid amount. Please enter a valid number (e.g. 120 or 45.50).";
      }

      const { bill: createdBill, contact } = await createBillAction(ctx, {
        supplierName,
        unitPrice: amount,
        description,
        dueDate,
      });

      const totalFormatted = (createdBill.total / 100).toFixed(2);
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.fixbooks.io";
      return (
        `✅ <b>Bill Created Successfully!</b>\n\n` +
        `• <b>Bill #:</b> ${createdBill.billNumber}\n` +
        `• <b>Supplier:</b> ${contact.name}\n` +
        `• <b>Amount:</b> ${createdBill.currencyCode} ${totalFormatted}\n` +
        `• <b>Item:</b> ${description}\n` +
        `• <b>Status:</b> ${createdBill.status.toUpperCase()}\n` +
        `• <b>Due Date:</b> ${createdBill.dueDate}\n` +
        (createdBill.reference ? `• <b>Reference:</b> ${createdBill.reference}\n` : "") +
        `\n🔗 <a href="${appUrl}/purchases/${createdBill.id}">View in Fixbooks</a>`
      );
    }

    case "/sendinvoice": {
      if (!argsString) {
        return (
          `⚠️ <b>Usage:</b> <code>/sendinvoice &lt;Invoice #&gt; [optional email]</code>\n\n` +
          `<i>Example:</i> <code>/sendinvoice INV-00017 client@example.com</code>`
        );
      }
      const [invNum, maybeEmail] = argsString.split(/\s+/);
      const res = await sendInvoiceEmailAction(ctx, {
        invoiceNumber: invNum,
        recipientEmail: maybeEmail && maybeEmail.includes("@") ? maybeEmail : undefined,
      });
      if (res.error) {
        return `⚠️ ${res.error}`;
      }
      return (
        `✉️ <b>Invoice Sent to Customer!</b>\n\n` +
        `• <b>Invoice #:</b> ${res.invoiceNumber}\n` +
        `• <b>Customer:</b> ${res.customerName}\n` +
        `• <b>Sent To:</b> <code>${res.recipientEmail}</code>\n` +
        `• <b>Total:</b> ${res.total}\n` +
        `• <b>Status:</b> ${res.status?.toUpperCase()}\n` +
        (res.paymentLink ? `• <b>Payment Link:</b> Included (Pay by Bank)\n` : "") +
        `\n📄 <i>PDF copy has been emailed successfully.</i>`
      );
    }

    case "/sendquote": {
      if (!argsString) {
        return (
          `⚠️ <b>Usage:</b> <code>/sendquote &lt;Quote #&gt; [optional email]</code>\n\n` +
          `<i>Example:</i> <code>/sendquote QTE-00007 client@example.com</code>`
        );
      }
      const [qNum, maybeEmail] = argsString.split(/\s+/);
      const res = await sendQuoteEmailAction(ctx, {
        quoteNumber: qNum,
        recipientEmail: maybeEmail && maybeEmail.includes("@") ? maybeEmail : undefined,
      });
      if (res.error) {
        return `⚠️ ${res.error}`;
      }
      return (
        `✉️ <b>Quote Sent to Customer!</b>\n\n` +
        `• <b>Quote #:</b> ${res.quoteNumber}\n` +
        `• <b>Customer:</b> ${res.customerName}\n` +
        `• <b>Sent To:</b> <code>${res.recipientEmail}</code>\n` +
        `• <b>Total:</b> ${res.total}\n` +
        `• <b>Status:</b> ${res.status?.toUpperCase()}\n\n` +
        `📄 <i>PDF copy has been emailed successfully.</i>`
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
        const bal = typeof b.balance === "number" ? `£${(b.balance / 100).toFixed(2)}` : null;
        reply += `• <b>${b.name}</b> (${b.currency || "GBP"})`;
        if (bal) reply += `: <b>${bal}</b>`;
        reply += `\n`;
        if (b.code) reply += `  Account: <code>${b.code}</code>\n`;
      }
      return reply.trim();
    }

    case "/reconcile": {
      if (!argsString) {
        const res = await listUnreconciledBankTransactionsAction(ctx);
        return res.formattedMessage;
      }

      const lowerArgs = argsString.toLowerCase();

      // Check if user asked for report, e.g. /reconcile report or /reconcile report Wise
      if (lowerArgs.startsWith("report")) {
        const bankName = argsString.replace(/^report\s*/i, "").trim();
        const res = await getReconciliationReportAction(
          ctx,
          bankName ? { bankAccountName: bankName } : undefined
        );
        return res.formattedMessage;
      }

      // Check if user asked for suggestions, e.g. /reconcile suggestions 6ab9e4fc
      if (lowerArgs.startsWith("suggestions") || lowerArgs.startsWith("suggest")) {
        const txId = argsString.replace(/^(suggestions|suggest)\s*/i, "").trim();
        const res = await getReconciliationSuggestionsAction(ctx, { transactionId: txId });
        return res.formattedMessage;
      }

      // Format: /reconcile <txId> [target]
      const [txId, ...targetParts] = argsString.split(/\s+/);
      const target = targetParts.join(" ").trim();

      const res = await reconcileBankTransactionAction(ctx, {
        transactionId: txId,
        target: target || undefined,
      });

      return res.formattedMessage;
    }

    case "/reconcilereport": {
      const res = await getReconciliationReportAction(
        ctx,
        argsString ? { bankAccountName: argsString } : undefined
      );
      return res.formattedMessage;
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
1. QUOTES vs INVOICES vs BILLS:
   - When the user asks to create a "Quote", "Estimate", or "Pricing proposal", you MUST execute the \`create_quote\` tool. NEVER call \`create_invoice\` or \`create_bill\` when a quote was requested!
   - When the user asks for a sales "Invoice" to a customer, execute the \`create_invoice\` tool.
   - When the user asks to create, add, or record a "Bill", vendor/supplier bill, or purchase bill (e.g. from a supplier/store like Screwfix, Travis Perkins, Toolstation, or paying for materials, tools, or supplies), you MUST execute the \`create_bill\` tool.
2. MULTI-LINE ITEMS IN A SINGLE DOCUMENT:
   - NEVER create multiple separate quotes, invoices, or bills for a single transaction.
   - When the user provides multiple items, materials, or fees (such as products, delivery fees, installation, shipping), put ALL items into the \`lines\` array of ONE single quote, invoice, or bill.
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
6. INVOICE LINKS & PDF DOWNLOADS:
   - When the user asks for a link to an invoice or PDF (e.g. "Give me link to the invoice INV-00017"), ONLY provide the PDF download link (Download PDF: <downloadUrl>).
   - NEVER output internal web app dashboard links like "View Online" or "/sales/" URLs.
7. EDITING INVOICES & QUOTES:
   - When the user asks to edit, update, modify, or change an existing invoice (e.g. "Edit invoice INV-00017...", "Update lines on INV-00017..."), call the \`edit_invoice\` tool with invoiceNumber and updated lines/fields.
   - When the user asks to edit, update, modify, or change an existing quote (e.g. "Edit quote QTE-00007...", "Change quote QTE-00007 price to..."), call the \`edit_quote\` tool with quoteNumber and updated lines/fields.
   - Only DRAFT documents can be edited.
8. SENDING INVOICES & QUOTES TO CUSTOMER EMAIL:
   - When the user asks to send or email an invoice to a customer (e.g. "Send invoice INV-00017 to customer email", "Email invoice INV-00017 to client@example.com"), execute the \`send_invoice_email\` tool.
   - When the user asks to send or email a quote to a customer (e.g. "Send quote QTE-00007 to customer email", "Email quote QTE-00007 to client@example.com"), execute the \`send_quote_email\` tool.
   - If the user provides a recipient email in their message, pass it into \`recipientEmail\`. If not provided, leave \`recipientEmail\` empty and the tool will automatically use the customer's email on file.
9. BANK RECONCILIATION & TRANSACTIONS:
   - When the user asks to see unreconciled transactions, review bank accounts, or asks what needs reconciling, call the \`list_unreconciled_transactions\` tool.
   - When the user asks for candidate matches or suggestions for a specific transaction (e.g. "What matches transaction 6ab9e4fc?"), call \`get_reconciliation_suggestions\`.
   - When the user asks to reconcile, match, or categorize a bank transaction (e.g. "Reconcile transaction 6ab9e4fc with invoice INV-00017", "Match 6ab9e4fc to INV-00017", "Categorize 93ce783a as Cost of Goods Sold", "Reconcile 93ce783a to 5000", "Match 9b4425d3 to bill BILL-00001"), call the \`reconcile_bank_transaction\` tool with transactionId and the corresponding invoiceNumber, billNumber, accountCodeOrName, or target.
   - When the user asks for a bank reconciliation report or proof of balances, call \`get_reconciliation_report\`.
   - The tool outputs will already contain formatted HTML messages. Present them clearly and directly to the user.

TELEGRAM FORMATTING RULES:
- ONLY use Telegram-supported HTML tags: <b>bold</b>, <i>italic</i>, and <code>code</code>.
- NEVER use <h3>, <h2>, <h1>, <p>, <br>, <div>, or markdown (no ###, no ---).
- For section titles or totals, use bold text with an emoji, e.g. <b>Total: £685.00</b>.
When confirming actions, display clean breakdowns with emojis.`;

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
