import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createMcpServer } from "@/lib/mcp/server";
import { resolveToken } from "@/lib/mcp/auth";
import { db } from "@/lib/db";
import { organization, member } from "@/lib/db/schema";
import { isNull } from "drizzle-orm";
import type { AuthContext } from "@/lib/api/auth-context";
import { getWhatsAppConfig } from "./client";

function sanitizeNotes(notes?: string | null): string | undefined {
  if (!notes) return undefined;
  const cleaned = notes
    .replace(/created\s+via\s+([a-z0-9_-]+\s+)?bot/gi, "")
    .replace(/created\s+via\s+(whatsapp|telegram)/gi, "")
    .replace(/(whatsapp|telegram)\s+bot/gi, "")
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

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
 * Resolves a tax rate UUID from percentage or rate name (e.g. 20, "20%", "VAT", "standard").
 * For sales invoices and quotes, prefers sales/both tax rates and never picks purchase-only
 * reverse-charge rates unless reverse charge was explicitly requested.
 */
export async function resolveTaxRateId(
  ctx: AuthContext,
  taxRateInput?: number | string | null,
  documentType: "sales" | "purchase" = "sales"
): Promise<string | undefined> {
  if (taxRateInput == null || taxRateInput === "") return undefined;
  const taxRates = await listAllTaxRates(ctx);
  if (!taxRates || taxRates.length === 0) return undefined;

  const activeRates = taxRates.filter((t: any) => t.isActive !== false);
  const relevantRates = activeRates.filter((t: any) =>
    documentType === "sales" ? t.type !== "purchase" : t.type !== "sales"
  );
  const pool = relevantRates.length > 0 ? relevantRates : activeRates;

  const str = String(taxRateInput).trim().toLowerCase();
  const isExplicitReverseCharge = str.includes("reverse");

  // 1. Direct name match if string provided
  if (str) {
    const exactName = pool.find((t: any) => t.name?.toLowerCase() === str);
    if (exactName) return exactName.id;
  }

  // 2. Parse number if present (e.g. 20, "20", "20%")
  const num = typeof taxRateInput === "number" ? taxRateInput : parseFloat(taxRateInput);
  if (!isNaN(num)) {
    const basisPoints = Math.round(num * 100);
    const matchingRates = pool.filter((t: any) => t.rate === basisPoints);

    if (matchingRates.length > 0) {
      // Filter out reverse charge unless explicitly requested
      const nonReverse = matchingRates.filter((t: any) =>
        isExplicitReverseCharge ? true : t.kind !== "reverse_charge" && !t.name?.toLowerCase().includes("reverse")
      );
      const candidates = nonReverse.length > 0 ? nonReverse : matchingRates;

      // Priority:
      // a) Name includes "vat" (if input includes "vat" or standard UK)
      if (str.includes("vat")) {
        const vatMatch = candidates.find((t: any) => t.name?.toLowerCase().includes("vat"));
        if (vatMatch) return vatMatch.id;
      }
      // b) Default rate
      const defaultMatch = candidates.find((t: any) => t.isDefault);
      if (defaultMatch) return defaultMatch.id;
      // c) Standard kind
      const standardMatch = candidates.find((t: any) => t.kind === "standard");
      if (standardMatch) return standardMatch.id;

      return candidates[0].id;
    }
  }

  // 3. Fallback name/keyword match
  if (str.includes("zero") || str === "0" || str.includes("0%")) {
    const match = pool.find(
      (t: any) => t.rate === 0 && (t.name?.toLowerCase().includes("zero") || t.kind === "zero")
    );
    if (match) return match.id;
  }
  if (str.includes("exempt")) {
    const match = pool.find((t: any) => t.kind === "exempt" || t.name?.toLowerCase().includes("exempt"));
    if (match) return match.id;
  }
  if (str.includes("vat")) {
    const match = pool.find(
      (t: any) =>
        t.name?.toLowerCase().includes("vat") &&
        (isExplicitReverseCharge ? true : t.kind !== "reverse_charge")
    );
    if (match) return match.id;
  }

  const byName = pool.find((t: any) => {
    if (!isExplicitReverseCharge && (t.kind === "reverse_charge" || t.name?.toLowerCase().includes("reverse"))) {
      return false;
    }
    return t.name?.toLowerCase().includes(str);
  });
  return byName?.id;
}

/**
 * Normalizes user-supplied date strings (DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD) to ISO YYYY-MM-DD.
 */
export function normalizeDateInput(dateStr?: string | null): string | undefined {
  if (!dateStr) return undefined;
  const trimmed = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const ukMatch = /^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})$/.exec(trimmed);
  if (ukMatch) {
    const day = ukMatch[1].padStart(2, "0");
    const month = ukMatch[2].padStart(2, "0");
    const year = ukMatch[3];
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split("T")[0];
  }
  return undefined;
}

/**
 * Intelligently cleans customer name when both individual and company are provided.
 */
export function cleanCustomerName(name: string): string {
  if (!name) return "Customer";
  if (name.includes(",") || name.includes("\n")) {
    const parts = name.split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean);
    const companyPart = parts.find((p) =>
      /\b(ltd|limited|llc|inc|corp|corporation|plc|group|holdings|services|construction|builders)\b/i.test(p)
    );
    const personPart = parts.find((p) => p !== companyPart);
    if (companyPart && personPart) {
      return `${companyPart} (${personPart})`;
    }
    if (companyPart) return companyPart;
  }
  return name.trim();
}

/**
 * Robust address parser handling UK & international street, city, postal code, and country.
 */
export function parseAddressString(rawAddress: string): {
  addressLine?: string;
  city?: string;
  postalCode?: string;
  country?: string;
} {
  if (!rawAddress) return {};
  let parts = rawAddress
    .split(/[\r\n,]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) return {};

  let country: string | undefined;
  let postalCode: string | undefined;
  let city: string | undefined;

  // 1. Check for Country at the end of the address
  const lastPart = parts[parts.length - 1];
  const isCountry =
    /^(united kingdom(\s*\(uk\))?|uk|great britain|england|scotland|wales|northern ireland|united states(\s*\(usa\))?|usa|us|ireland|france|germany|spain|italy|australia|canada)$/i.test(
      lastPart
    );
  if (isCountry && parts.length > 1) {
    country = lastPart.replace(/\s*\(uk\)/i, "").replace(/\s*\(usa\)/i, "").trim();
    if (/^uk$/i.test(country)) country = "United Kingdom";
    if (/^us$/i.test(country)) country = "United States";
    parts = parts.slice(0, parts.length - 1);
  }

  // 2. Check for UK Postcode or postal code pattern
  const ukPostcodeRegex = /^[A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2}$/i;
  const genericPostalRegex = /^[A-Z0-9]{2,4}\s*[A-Z0-9]{2,4}$/i;

  let postCodeIdx = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (ukPostcodeRegex.test(parts[i]) || genericPostalRegex.test(parts[i])) {
      postCodeIdx = i;
      postalCode = parts[i];
      break;
    }
  }

  if (postCodeIdx !== -1) {
    const beforePostCode = parts.slice(0, postCodeIdx);
    const afterPostCode = parts.slice(postCodeIdx + 1);
    parts = [...beforePostCode, ...afterPostCode];
  }

  // 3. What remains in parts:
  let addressLine: string | undefined;
  if (parts.length === 1) {
    if (!postalCode) {
      addressLine = parts[0];
    } else {
      if (/\d/.test(parts[0])) {
        addressLine = parts[0];
      } else {
        city = parts[0];
      }
    }
  } else if (parts.length >= 2) {
    city = parts[parts.length - 1];
    addressLine = parts.slice(0, parts.length - 1).join(", ");
  }

  return {
    ...(addressLine ? { addressLine } : {}),
    ...(city ? { city } : {}),
    ...(postalCode ? { postalCode } : {}),
    ...(country ? { country } : {}),
  };
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
  const effectiveName = cleanCustomerName(params.customerName);
  const contacts = await listAllContacts(ctx, effectiveName);
  let found = contacts.find(
    (c: any) =>
      c.name?.toLowerCase() === effectiveName.toLowerCase() ||
      c.name?.toLowerCase() === params.customerName.toLowerCase()
  );

  if (!found && contacts.length > 0) {
    found = contacts.find((c: any) =>
      c.name?.toLowerCase().includes(effectiveName.toLowerCase())
    );
  }

  const parsedAddr = params.customerAddress ? parseAddressString(params.customerAddress) : {};

  if (!found) {
    const newContactRes = await executeMcpTool(ctx, "create_contact", {
      name: effectiveName,
      type: "customer",
      currencyCode: "GBP",
      ...(params.customerEmail ? { email: params.customerEmail } : {}),
      ...(params.customerPhone ? { phone: params.customerPhone } : {}),
      ...(parsedAddr.addressLine ? { addressLine: parsedAddr.addressLine } : {}),
      ...(parsedAddr.city ? { city: parsedAddr.city } : {}),
      ...(parsedAddr.postalCode ? { postalCode: parsedAddr.postalCode } : {}),
      ...(parsedAddr.country ? { country: parsedAddr.country } : {}),
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
      ...(parsedAddr.country ? { country: parsedAddr.country } : {}),
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
    issueDate?: string;
    expiryDate?: string;
    quoteNumber?: string;
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
    // Integer cents/pence for create_quote MCP tool
    const centsPrice = Math.round(rawPrice * 100);
    return {
      description: l.description,
      quantity: Number(l.quantity || 1),
      unitPrice: centsPrice,
      ...(account?.id ? { accountId: account.id } : {}),
      ...(taxRateId ? { taxRateId } : {}),
    };
  });

  const issueDate =
    normalizeDateInput(params.issueDate) ||
    new Date().toISOString().split("T")[0];
  const calculatedExpiry =
    normalizeDateInput(params.expiryDate) ||
    new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

  const res = await executeMcpTool(ctx, "create_quote", {
    contactId: contact.id,
    currencyCode: currency,
    issueDate,
    expiryDate: calculatedExpiry,
    ...(params.quoteNumber ? { quoteNumber: params.quoteNumber.trim() } : {}),
    ...(params.reference ? { reference: params.reference.trim() } : {}),
    notes: sanitizeNotes(params.notes) || undefined,
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
    issueDate?: string;
    dueDate?: string;
    invoiceNumber?: string;
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

  // create_invoice MCP tool expects unitPrice in decimal (pounds), not integer pence
  const formattedLines = rawLines.map((l) => {
    const rawPrice = Number(l.unitPrice || 0);
    return {
      description: l.description,
      quantity: Number(l.quantity || 1),
      unitPrice: rawPrice,
      ...(account?.id ? { accountId: account.id } : {}),
      ...(taxRateId ? { taxRateId } : {}),
    };
  });

  const issueDate =
    normalizeDateInput(params.issueDate) ||
    new Date().toISOString().split("T")[0];
  const calculatedDue =
    normalizeDateInput(params.dueDate) ||
    new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];

  const res = await executeMcpTool(ctx, "create_invoice", {
    contactId: contact.id,
    currencyCode: currency,
    issueDate,
    dueDate: calculatedDue,
    ...(params.invoiceNumber ? { invoiceNumber: params.invoiceNumber.trim() } : {}),
    ...(params.reference
      ? { reference: params.reference.trim() }
      : params.invoiceNumber
      ? { reference: params.invoiceNumber.trim() }
      : {}),
    notes: sanitizeNotes(params.notes) || undefined,
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
