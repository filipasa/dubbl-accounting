import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createMcpServer } from "@/lib/mcp/server";
import { resolveToken } from "@/lib/mcp/auth";
import { db } from "@/lib/db";
import { organization, member } from "@/lib/db/schema";
import { isNull } from "drizzle-orm";
import type { AuthContext } from "@/lib/api/auth-context";
import { getWhatsAppConfig } from "./client";

/**
 * Resolves the AuthContext for the WhatsApp bot.
 * Tries WHATSAPP_FIXBOOKS_TOKEN / DUBBL_TOKEN first,
 * then falls back to the first active organization and owner in the database.
 */
export async function resolveWhatsAppAuthContext(): Promise<AuthContext> {
  const config = getWhatsAppConfig();

  if (config.fixbooksToken) {
    try {
      const authCtx = await resolveToken(config.fixbooksToken);
      return authCtx;
    } catch (e) {
      console.warn("[WhatsApp] Failed to resolve fixbooksToken, falling back to database org:", e);
    }
  }

  // Fallback: Find the first active organization
  const org = await db.query.organization.findFirst({
    where: isNull(organization.deletedAt),
  });

  if (!org) {
    throw new Error("No organization found in Fixbooks database. Please complete onboarding first.");
  }

  // Find owner or any member
  const owner =
    (await db.query.member.findFirst({
      where: (m, { eq, and }) => and(eq(m.organizationId, org.id), eq(m.role, "owner")),
    })) ||
    (await db.query.member.findFirst({
      where: (m, { eq }) => eq(m.organizationId, org.id),
    }));

  return {
    userId: owner?.userId || "whatsapp-system",
    organizationId: org.id,
    role: "owner",
  };
}

/**
 * Executes any MCP tool in-process using InMemoryTransport.
 * Avoids all external HTTP calls and shares database connections directly.
 */
export async function executeMcpTool(
  ctx: AuthContext,
  name: string,
  args: Record<string, unknown> = {}
): Promise<any> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(ctx);
  await server.connect(serverTransport);

  const client = new Client(
    { name: "fixbooks-whatsapp-bot", version: "1.0.0" },
    { capabilities: {} }
  );
  await client.connect(clientTransport);

  try {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) {
      const msg = (result.content as any)?.[0]?.text || "Tool execution error";
      throw new Error(msg);
    }
    const text = (result.content as any)?.[0]?.text;
    if (typeof text === "string") {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    return result;
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

export async function getOrganizationDetails(ctx: AuthContext) {
  const result = await executeMcpTool(ctx, "get_organization");
  return result?.organization || {
    name: "Fixbooks Business",
    defaultCurrency: "GBP",
    country: "GB",
  };
}

export async function listRecentInvoices(ctx: AuthContext, limit = 5) {
  const result = await executeMcpTool(ctx, "list_invoices", { limit });
  return result?.invoices || [];
}

export async function listRecentQuotes(ctx: AuthContext, limit = 5) {
  const result = await executeMcpTool(ctx, "list_quotes", { limit });
  return result?.quotes || [];
}

export async function listAllContacts(ctx: AuthContext, search = "") {
  const args: Record<string, unknown> = { limit: 50 };
  if (search) args.search = search;
  const result = await executeMcpTool(ctx, "list_contacts", args);
  return result?.contacts || [];
}

export async function listAllTaxRates(ctx: AuthContext) {
  const result = await executeMcpTool(ctx, "list_tax_rates");
  return result?.taxRates || [];
}

/**
 * Resolves a tax rate UUID from percentage or rate name (e.g. 20, "20%", "standard")
 */
export async function resolveTaxRateId(
  ctx: AuthContext,
  taxRateInput?: number | string | null
): Promise<string | undefined> {
  if (taxRateInput == null || taxRateInput === "") return undefined;
  const taxRates = await listAllTaxRates(ctx);
  if (!taxRates || taxRates.length === 0) return undefined;

  const num = typeof taxRateInput === "number" ? taxRateInput : parseFloat(taxRateInput);
  if (!isNaN(num)) {
    const basisPoints = Math.round(num * 100);
    const match = taxRates.find((t: any) => t.rate === basisPoints && t.isActive !== false);
    if (match) return match.id;
  }

  const str = String(taxRateInput).toLowerCase();
  if (str.includes("20")) {
    const match = taxRates.find((t: any) => t.rate === 2000);
    if (match) return match.id;
  }
  if (str.includes("5")) {
    const match = taxRates.find((t: any) => t.rate === 500);
    if (match) return match.id;
  }
  if (str.includes("zero") || str === "0" || str.includes("0%")) {
    const match = taxRates.find(
      (t: any) => t.rate === 0 && (t.name?.toLowerCase().includes("zero") || t.kind === "zero")
    );
    if (match) return match.id;
  }
  if (str.includes("exempt")) {
    const match = taxRates.find((t: any) => t.kind === "exempt");
    if (match) return match.id;
  }

  const byName = taxRates.find((t: any) => t.name?.toLowerCase().includes(str));
  return byName?.id;
}

function parseAddressString(rawAddress: string) {
  if (!rawAddress) return {};
  const parts = rawAddress.split(/[\r\n,]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { addressLine: parts[0] };
  if (parts.length === 2) return { addressLine: parts[0], city: parts[1] };
  const postalCode = parts[parts.length - 1];
  const city = parts[parts.length - 2];
  const addressLine = parts.slice(0, parts.length - 2).join(", ");
  return { addressLine, city, postalCode };
}

/**
 * Finds or creates a customer contact
 */
export async function resolveContact(
  ctx: AuthContext,
  params: {
    customerName: string;
    customerEmail?: string;
    customerAddress?: string;
    customerPhone?: string;
  }
) {
  const contacts = await listAllContacts(ctx, params.customerName);
  let found = contacts.find(
    (c: any) => c.name?.toLowerCase() === params.customerName.toLowerCase()
  );

  if (!found && contacts.length > 0) {
    found = contacts.find((c: any) =>
      c.name?.toLowerCase().includes(params.customerName.toLowerCase())
    );
  }

  const parsedAddr = params.customerAddress ? parseAddressString(params.customerAddress) : {};

  if (!found) {
    const newContactRes = await executeMcpTool(ctx, "create_contact", {
      name: params.customerName,
      type: "customer",
      currencyCode: "GBP",
      ...(params.customerEmail ? { email: params.customerEmail } : {}),
      ...(params.customerPhone ? { phone: params.customerPhone } : {}),
      ...(parsedAddr.addressLine ? { addressLine: parsedAddr.addressLine } : {}),
      ...(parsedAddr.city ? { city: parsedAddr.city } : {}),
      ...(parsedAddr.postalCode ? { postalCode: parsedAddr.postalCode } : {}),
    });
    return newContactRes.contact;
  }

  // Update contact if email or address provided and missing
  if (
    (params.customerEmail && !found.email) ||
    (parsedAddr.addressLine && (!found.addresses || !found.addresses.billing))
  ) {
    await executeMcpTool(ctx, "update_contact", {
      contactId: found.id,
      ...(params.customerEmail && !found.email ? { email: params.customerEmail } : {}),
      ...(parsedAddr.addressLine ? { addressLine: parsedAddr.addressLine } : {}),
      ...(parsedAddr.city ? { city: parsedAddr.city } : {}),
      ...(parsedAddr.postalCode ? { postalCode: parsedAddr.postalCode } : {}),
    }).catch(() => {});
  }

  return found;
}

export interface LineItemInput {
  description: string;
  quantity?: number;
  unitPrice: number;
}

/**
 * Creates a Quote / Estimate with support for multi-line items
 */
export async function createQuoteAction(
  ctx: AuthContext,
  params: {
    customerName: string;
    customerEmail?: string;
    customerAddress?: string;
    customerPhone?: string;
    lines?: LineItemInput[];
    description?: string;
    unitPrice?: number;
    quantity?: number;
    taxRatePercent?: number | string;
    currencyCode?: string;
    expiryDate?: string;
    reference?: string;
    notes?: string;
  }
) {
  const org = await getOrganizationDetails(ctx);
  const contact = await resolveContact(ctx, {
    customerName: params.customerName,
    customerEmail: params.customerEmail,
    customerAddress: params.customerAddress,
    customerPhone: params.customerPhone,
  });

  const currency = params.currencyCode || org.defaultCurrency || "GBP";

  // Find default revenue account
  const accountsRes = await executeMcpTool(ctx, "list_accounts", { type: "revenue" });
  const accounts = accountsRes?.accounts || [];
  const account = accounts.find((a: any) => a.code === "4000") || accounts[0];

  const taxRateId = await resolveTaxRateId(ctx, params.taxRatePercent);

  let rawLines = params.lines;
  if (!rawLines || rawLines.length === 0) {
    if (params.description && params.unitPrice != null) {
      rawLines = [
        {
          description: params.description,
          quantity: params.quantity || 1,
          unitPrice: params.unitPrice,
        },
      ];
    } else {
      throw new Error("Quote must have at least one line item with description and unit price.");
    }
  }

  const formattedLines = rawLines.map((l) => {
    const rawPrice = Number(l.unitPrice || 0);
    // Integer cents/pence
    const centsPrice = Math.round(rawPrice * 100);
    return {
      description: l.description,
      quantity: Number(l.quantity || 1),
      unitPrice: centsPrice,
      ...(account?.id ? { accountId: account.id } : {}),
      ...(taxRateId ? { taxRateId } : {}),
    };
  });

  const today = new Date().toISOString().split("T")[0];
  const calculatedExpiry =
    params.expiryDate ||
    new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

  const res = await executeMcpTool(ctx, "create_quote", {
    contactId: contact.id,
    currencyCode: currency,
    issueDate: today,
    expiryDate: calculatedExpiry,
    reference: params.reference || `QTE-${Date.now().toString().slice(-4)}`,
    notes:
      params.notes ||
      (params.customerAddress ? `Address: ${params.customerAddress}` : "Created via WhatsApp Bot"),
    lines: formattedLines,
  });

  return {
    quote: res.quote,
    contact,
  };
}

/**
 * Creates an Invoice with support for multi-line items
 */
export async function createInvoiceAction(
  ctx: AuthContext,
  params: {
    customerName: string;
    customerEmail?: string;
    customerAddress?: string;
    customerPhone?: string;
    lines?: LineItemInput[];
    description?: string;
    unitPrice?: number;
    quantity?: number;
    taxRatePercent?: number | string;
    currencyCode?: string;
    dueDate?: string;
    reference?: string;
    notes?: string;
  }
) {
  const org = await getOrganizationDetails(ctx);
  const contact = await resolveContact(ctx, {
    customerName: params.customerName,
    customerEmail: params.customerEmail,
    customerAddress: params.customerAddress,
    customerPhone: params.customerPhone,
  });

  const currency = params.currencyCode || org.defaultCurrency || "GBP";

  // Find default revenue account
  const accountsRes = await executeMcpTool(ctx, "list_accounts", { type: "revenue" });
  const accounts = accountsRes?.accounts || [];
  const account = accounts.find((a: any) => a.code === "4000") || accounts[0];

  const taxRateId = await resolveTaxRateId(ctx, params.taxRatePercent);

  let rawLines = params.lines;
  if (!rawLines || rawLines.length === 0) {
    if (params.description && params.unitPrice != null) {
      rawLines = [
        {
          description: params.description,
          quantity: params.quantity || 1,
          unitPrice: params.unitPrice,
        },
      ];
    } else {
      throw new Error("Invoice must have at least one line item with description and unit price.");
    }
  }

  const formattedLines = rawLines.map((l) => {
    const rawPrice = Number(l.unitPrice || 0);
    const centsPrice = Math.round(rawPrice * 100);
    return {
      description: l.description,
      quantity: Number(l.quantity || 1),
      unitPrice: centsPrice,
      ...(account?.id ? { accountId: account.id } : {}),
      ...(taxRateId ? { taxRateId } : {}),
    };
  });

  const today = new Date().toISOString().split("T")[0];
  const calculatedDue =
    params.dueDate ||
    new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];

  const res = await executeMcpTool(ctx, "create_invoice", {
    contactId: contact.id,
    currencyCode: currency,
    issueDate: today,
    dueDate: calculatedDue,
    reference: params.reference || `INV-${Date.now().toString().slice(-4)}`,
    notes:
      params.notes ||
      (params.customerAddress ? `Address: ${params.customerAddress}` : "Created via WhatsApp Bot"),
    lines: formattedLines,
  });

  return {
    invoice: res.invoice,
    contact,
  };
}

export async function getInvoicePdfAction(ctx: AuthContext, invoiceNumber: string) {
  const invoices = await listRecentInvoices(ctx, 50);
  const query = (invoiceNumber || "").trim().toLowerCase();
  const inv = invoices.find(
    (i: any) =>
      i.invoiceNumber?.toLowerCase() === query ||
      i.id?.toLowerCase() === query
  );

  if (!inv) {
    return { error: `Invoice "${invoiceNumber}" not found.` };
  }

  const pdfRes = await executeMcpTool(ctx, "get_invoice_pdf", { invoiceId: inv.id });
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  return {
    invoiceNumber: inv.invoiceNumber,
    downloadUrl: pdfRes?.downloadUrl,
    viewUrl: `${appUrl}/sales/${inv.id}`,
    customerName: inv.contact?.name || "Customer",
    total: `£${(inv.total / 100).toFixed(2)}`,
    status: inv.status,
  };
}

export async function getBankAccountsAction(ctx: AuthContext) {
  const result = await executeMcpTool(ctx, "list_accounts", { type: "asset" });
  const accounts = result?.accounts || [];
  return accounts.filter(
    (a: any) => a.subType === "bank" || a.name?.toLowerCase().includes("bank")
  );
}
