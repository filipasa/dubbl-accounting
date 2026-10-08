import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createMcpServer } from "@/lib/mcp/server";
import { resolveToken } from "@/lib/mcp/auth";
import { db } from "@/lib/db";
import {
  organization,
  member,
  invoice,
  invoiceLine,
  quote,
  quoteLine,
  portalAccessToken,
  documentTemplate,
  bankAccount,
  bankTransaction,
  bankReconciliation,
  bill,
  billLine,
  chartAccount,
} from "@/lib/db/schema";
import { isNull, eq, and, or, ilike, desc, asc, inArray, sql } from "drizzle-orm";
import { notDeleted } from "@/lib/db/soft-delete";
import { formatMoney } from "@/lib/money";
import { buildSenderSnapshot, buildRecipientSnapshot } from "@/lib/documents/snapshots";
import { resolveTaxLabel } from "@/lib/tax/tax-label";
import { sendDocumentEmail } from "@/lib/email/document-sender";
import { renderDocumentEmailHtml } from "@/lib/email/render-document-email";
import {
  createInvoiceJournalEntry,
  createBillJournalEntry,
  createCogsJournalEntry,
  assertBaseRateAvailable,
} from "@/lib/api/journal-automation";
import { suggestAccounts } from "@/lib/banking/account-suggestions";
import { randomBytes } from "crypto";
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

export async function listRecentBills(ctx: AuthContext, limit = 5) {
  const result = await executeMcpTool(ctx, "list_bills", { limit });
  return result?.bills || [];
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
 * Finds or creates a customer or supplier contact
 */
export async function resolveContact(
  ctx: AuthContext,
  params: {
    customerName: string;
    customerEmail?: string;
    customerAddress?: string;
    customerPhone?: string;
    type?: "customer" | "supplier" | "both";
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
      type: params.type || "customer",
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

  // If supplier contact needed and existing contact is only a customer, upgrade to both
  if (params.type === "supplier" && found.type === "customer") {
    await executeMcpTool(ctx, "update_contact", {
      contactId: found.id,
      type: "both",
    }).catch(() => {});
    found.type = "both";
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
  shortDescription?: string | null;
  quantity?: number;
  unitPrice: number;
  imageUrl?: string | null;
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
    shortDescription?: string | null;
    unitPrice?: number;
    quantity?: number;
    taxRatePercent?: number | string;
    currencyCode?: string;
    issueDate?: string;
    expiryDate?: string;
    quoteNumber?: string;
    reference?: string;
    notes?: string;
    shipping?: number | string;
    imageUrl?: string | null;
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
          shortDescription: params.shortDescription || null,
          quantity: params.quantity || 1,
          unitPrice: params.unitPrice,
          imageUrl: params.imageUrl || null,
        },
      ];
    } else {
      throw new Error("Quote must have at least one line item with description and unit price.");
    }
  }

  const formattedLines: any[] = rawLines.map((l) => {
    const rawPrice = Number(l.unitPrice || 0);
    // Integer cents/pence for create_quote MCP tool
    const centsPrice = Math.round(rawPrice * 100);
    return {
      description: l.description,
      ...(l.shortDescription ? { shortDescription: l.shortDescription } : {}),
      ...(l.imageUrl ? { imageUrl: l.imageUrl } : {}),
      quantity: Number(l.quantity || 1),
      unitPrice: centsPrice,
      ...(account?.id ? { accountId: account.id } : {}),
      ...(taxRateId ? { taxRateId } : {}),
    };
  });

  if (params.shipping != null && Number(params.shipping) > 0) {
    const hasShippingLine = formattedLines.some((l) =>
      l.description.toLowerCase().startsWith("shipping") ||
      l.description.toLowerCase().startsWith("delivery")
    );
    if (!hasShippingLine) {
      formattedLines.push({
        description: "Shipping",
        quantity: 1,
        unitPrice: Math.round(Number(params.shipping) * 100),
        ...(account?.id ? { accountId: account.id } : {}),
        ...(taxRateId ? { taxRateId } : {}),
      });
    }
  }

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

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.fixbooks.io";
  const token = await getOrCreatePortalToken(ctx.organizationId, contact.id);
  const portalUrl = token ? `${baseUrl}/portal/${token.token}/quotes` : undefined;
  const viewUrl = `${baseUrl}/sales/quotes/${res.quote.id}`;
  const pdfUrl = token
    ? `${baseUrl}/api/v1/portal/${token.token}/quotes/${res.quote.id}/pdf`
    : `${baseUrl}/api/v1/quotes/${res.quote.id}/pdf?format=pdf`;

  return {
    quote: res.quote,
    contact,
    portalUrl,
    viewUrl,
    pdfUrl,
    downloadUrl: pdfUrl,
  };
}

export async function getOrCreatePortalToken(organizationId: string, contactId: string | null) {
  if (!contactId) return null;
  let token = await db.query.portalAccessToken.findFirst({
    where: and(
      eq(portalAccessToken.organizationId, organizationId),
      eq(portalAccessToken.contactId, contactId),
      isNull(portalAccessToken.revokedAt)
    ),
  });
  if (!token) {
    const [created] = await db
      .insert(portalAccessToken)
      .values({
        organizationId,
        contactId,
        token: randomBytes(32).toString("hex"),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })
      .returning();
    token = created;
  }
  return token;
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
    shortDescription?: string | null;
    unitPrice?: number;
    quantity?: number;
    taxRatePercent?: number | string;
    currencyCode?: string;
    issueDate?: string;
    dueDate?: string;
    invoiceNumber?: string;
    reference?: string;
    notes?: string;
    shipping?: number | string;
    imageUrl?: string | null;
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
          shortDescription: params.shortDescription || null,
          quantity: params.quantity || 1,
          unitPrice: params.unitPrice,
          imageUrl: params.imageUrl || null,
        },
      ];
    } else {
      throw new Error("Invoice must have at least one line item with description and unit price.");
    }
  }

  // create_invoice MCP tool expects unitPrice in decimal (pounds), not integer pence
  const formattedLines: any[] = rawLines.map((l) => {
    const rawPrice = Number(l.unitPrice || 0);
    return {
      description: l.description,
      ...(l.shortDescription ? { shortDescription: l.shortDescription } : {}),
      ...(l.imageUrl ? { imageUrl: l.imageUrl } : {}),
      quantity: Number(l.quantity || 1),
      unitPrice: rawPrice,
      ...(account?.id ? { accountId: account.id } : {}),
      ...(taxRateId ? { taxRateId } : {}),
    };
  });

  if (params.shipping != null && Number(params.shipping) > 0) {
    const hasShippingLine = formattedLines.some((l) =>
      l.description.toLowerCase().startsWith("shipping") ||
      l.description.toLowerCase().startsWith("delivery")
    );
    if (!hasShippingLine) {
      formattedLines.push({
        description: "Shipping",
        quantity: 1,
        unitPrice: Number(params.shipping),
        ...(account?.id ? { accountId: account.id } : {}),
        ...(taxRateId ? { taxRateId } : {}),
      });
    }
  }

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

/**
 * Creates a Supplier / Vendor Bill with support for multi-line items
 */
export async function createBillAction(
  ctx: AuthContext,
  params: {
    supplierName: string;
    supplierEmail?: string;
    supplierAddress?: string;
    supplierPhone?: string;
    lines?: LineItemInput[];
    description?: string;
    unitPrice?: number;
    quantity?: number;
    taxRatePercent?: number | string;
    currencyCode?: string;
    issueDate?: string;
    dueDate?: string;
    billNumber?: string;
    reference?: string;
    notes?: string;
    accountCodeOrName?: string;
  }
) {
  const rawSupplierName =
    params.supplierName ||
    (params as any).vendorName ||
    (params as any).customerName;
  if (!rawSupplierName || !rawSupplierName.trim()) {
    throw new Error("Supplier name is required to create a bill.");
  }

  const org = await getOrganizationDetails(ctx);
  const contact = await resolveContact(ctx, {
    customerName: rawSupplierName,
    customerEmail: params.supplierEmail,
    customerAddress: params.supplierAddress,
    customerPhone: params.supplierPhone,
    type: "supplier",
  });

  const currency = params.currencyCode || org.defaultCurrency || "GBP";

  // Resolve default expense account
  let accountId: string | undefined = contact?.defaultExpenseAccountId || undefined;

  const accountsRes = await executeMcpTool(ctx, "list_accounts", { type: "expense" });
  const accounts: any[] = accountsRes?.accounts || [];

  if (!accountId && params.accountCodeOrName) {
    const search = params.accountCodeOrName.trim().toLowerCase();
    const foundAcc = accounts.find(
      (a: any) =>
        a.code?.toLowerCase() === search ||
        a.name?.toLowerCase() === search ||
        a.name?.toLowerCase().includes(search)
    );
    if (foundAcc) accountId = foundAcc.id;
  }

  if (!accountId && accounts.length > 0) {
    const defaultAcc =
      accounts.find((a: any) => a.code === "5000") || // Cost of Goods Sold / Materials
      accounts.find((a: any) => a.code === "6000") || // General Expenses
      accounts.find((a: any) => a.code?.startsWith("5")) ||
      accounts.find((a: any) => a.code?.startsWith("6")) ||
      accounts[0];
    if (defaultAcc) accountId = defaultAcc.id;
  }

  const taxRateId =
    contact?.defaultTaxRateId && params.taxRatePercent == null
      ? contact.defaultTaxRateId
      : await resolveTaxRateId(ctx, params.taxRatePercent, "purchase");

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
      throw new Error("Bill must have at least one line item with description and unit price.");
    }
  }

  // create_bill MCP tool expects unitPrice in decimal (pounds), not integer pence
  const formattedLines = rawLines.map((l) => {
    const rawPrice = Number(l.unitPrice || 0);
    return {
      description: l.description,
      quantity: Number(l.quantity || 1),
      unitPrice: rawPrice,
      ...(accountId ? { accountId } : {}),
      ...(taxRateId ? { taxRateId } : {}),
    };
  });

  const issueDate =
    normalizeDateInput(params.issueDate) ||
    new Date().toISOString().split("T")[0];
  const calculatedDue =
    normalizeDateInput(params.dueDate) ||
    new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

  const reference = (params.reference || params.billNumber || "").trim() || undefined;

  const res = await executeMcpTool(ctx, "create_bill", {
    contactId: contact.id,
    currencyCode: currency,
    issueDate,
    dueDate: calculatedDue,
    ...(reference ? { reference } : {}),
    notes: sanitizeNotes(params.notes) || undefined,
    lines: formattedLines,
  });

  return {
    bill: res.bill,
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

  return {
    invoiceNumber: inv.invoiceNumber,
    downloadUrl: pdfRes?.downloadUrl,
    customerName: inv.contact?.name || "Customer",
    total: `£${(inv.total / 100).toFixed(2)}`,
    status: inv.status,
  };
}

export async function getQuoteLinkAction(ctx: AuthContext, quoteNumberOrId: string) {
  const q = await findQuoteByNumber(ctx, quoteNumberOrId);
  if (!q) {
    return { error: `Quote "${quoteNumberOrId}" not found.` };
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.fixbooks.io";
  const token = await getOrCreatePortalToken(ctx.organizationId, q.contactId);
  const portalUrl = token ? `${baseUrl}/portal/${token.token}/quotes` : undefined;
  const viewUrl = `${baseUrl}/sales/quotes/${q.id}`;
  const pdfUrl = token
    ? `${baseUrl}/api/v1/portal/${token.token}/quotes/${q.id}/pdf`
    : `${baseUrl}/api/v1/quotes/${q.id}/pdf?format=pdf`;
  const totalFormatted = `£${(q.total / 100).toFixed(2)}`;

  return {
    quoteNumber: q.quoteNumber,
    customerName: q.contact?.name || "Customer",
    total: totalFormatted,
    status: q.status,
    expiryDate: q.expiryDate,
    portalUrl,
    viewUrl,
    pdfUrl,
    downloadUrl: pdfUrl,
  };
}

export const getQuotePdfAction = getQuoteLinkAction;

export async function getBankAccountsAction(ctx: AuthContext) {
  const bankAccounts = await db.query.bankAccount.findMany({
    where: and(
      eq(bankAccount.organizationId, ctx.organizationId),
      notDeleted(bankAccount.deletedAt)
    ),
    orderBy: asc(bankAccount.accountName),
  });

  if (bankAccounts.length > 0) {
    return bankAccounts.map((b) => ({
      id: b.id,
      name: b.accountName,
      code: b.accountNumber || b.accountType,
      currency: b.currencyCode,
      balance: b.balance,
      accountType: b.accountType,
    }));
  }

  const result = await executeMcpTool(ctx, "list_accounts", { type: "asset" });
  const accounts = result?.accounts || [];
  return accounts.filter(
    (a: any) => a.subType === "bank" || a.name?.toLowerCase().includes("bank")
  );
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(str: string): boolean {
  return UUID_REGEX.test(str.trim());
}

/**
 * Finds an invoice by invoiceNumber or UUID within the current organization.
 */
export async function findInvoiceByNumber(ctx: AuthContext, invoiceNumberOrId: string) {
  const query = (invoiceNumberOrId || "").trim();
  if (!query) return null;

  try {
    const isId = isUuid(query);
    const found = await db.query.invoice.findFirst({
      where: and(
        isId ? eq(invoice.id, query) : ilike(invoice.invoiceNumber, query),
        eq(invoice.organizationId, ctx.organizationId),
        notDeleted(invoice.deletedAt)
      ),
      with: {
        lines: { with: { taxRate: true } },
        contact: true,
      },
    });
    if (found) return found;

    // Fallback: check recent invoices in case query was e.g. "17" instead of "INV-00017"
    const recent = await db.query.invoice.findMany({
      where: and(
        eq(invoice.organizationId, ctx.organizationId),
        notDeleted(invoice.deletedAt)
      ),
      with: {
        lines: { with: { taxRate: true } },
        contact: true,
      },
      orderBy: desc(invoice.createdAt),
      limit: 50,
    });

    const digitsOnly = query.replace(/[^0-9]/g, "");
    const queryNum = digitsOnly ? parseInt(digitsOnly, 10) : null;

    return (
      recent.find((i) => {
        const invNum = (i.invoiceNumber || "").toLowerCase();
        const qClean = query.toLowerCase();
        if (invNum === qClean) return true;
        if (i.id.toLowerCase() === qClean) return true;
        if (queryNum !== null) {
          const itemDigits = invNum.replace(/[^0-9]/g, "");
          if (itemDigits && parseInt(itemDigits, 10) === queryNum) return true;
        }
        return false;
      }) || null
    );
  } catch (err) {
    console.warn("[Bot Invoice Finder] Error finding invoice:", err);
    return null;
  }
}

/**
 * Finds a quote by quoteNumber or UUID within the current organization.
 */
export async function findQuoteByNumber(ctx: AuthContext, quoteNumberOrId: string) {
  const query = (quoteNumberOrId || "").trim();
  if (!query) return null;

  try {
    const isId = isUuid(query);
    const found = await db.query.quote.findFirst({
      where: and(
        isId ? eq(quote.id, query) : ilike(quote.quoteNumber, query),
        eq(quote.organizationId, ctx.organizationId),
        notDeleted(quote.deletedAt)
      ),
      with: {
        lines: { with: { taxRate: true } },
        contact: true,
      },
    });
    if (found) return found;

    const recent = await db.query.quote.findMany({
      where: and(
        eq(quote.organizationId, ctx.organizationId),
        notDeleted(quote.deletedAt)
      ),
      with: {
        lines: { with: { taxRate: true } },
        contact: true,
      },
      orderBy: desc(quote.createdAt),
      limit: 50,
    });

    const digitsOnly = query.replace(/[^0-9]/g, "");
    const queryNum = digitsOnly ? parseInt(digitsOnly, 10) : null;

    return (
      recent.find((q) => {
        const qNum = (q.quoteNumber || "").toLowerCase();
        const qClean = query.toLowerCase();
        if (qNum === qClean) return true;
        if (q.id.toLowerCase() === qClean) return true;
        if (queryNum !== null) {
          const itemDigits = qNum.replace(/[^0-9]/g, "");
          if (itemDigits && parseInt(itemDigits, 10) === queryNum) return true;
        }
        return false;
      }) || null
    );
  } catch (err) {
    console.warn("[Bot Quote Finder] Error finding quote:", err);
    return null;
  }
}

/**
 * Updates an existing draft invoice
 */
export async function updateInvoiceAction(
  ctx: AuthContext,
  params: {
    invoiceNumber: string;
    customerName?: string;
    customerEmail?: string;
    customerAddress?: string;
    customerPhone?: string;
    lines?: LineItemInput[];
    description?: string;
    unitPrice?: number;
    quantity?: number;
    taxRatePercent?: number | string;
    issueDate?: string;
    dueDate?: string;
    reference?: string;
    notes?: string;
    shipping?: number | string;
    shortDescription?: string | null;
    imageUrl?: string | null;
  }
) {
  const inv = await findInvoiceByNumber(ctx, params.invoiceNumber);
  if (!inv) {
    return { error: `Invoice "${params.invoiceNumber}" not found.` };
  }

  if (inv.status !== "draft") {
    return {
      error: `Only draft invoices can be edited. Invoice ${inv.invoiceNumber} is currently in "${inv.status}" status.`,
    };
  }

  let contactId: string | undefined;
  if (params.customerName) {
    const contact = await resolveContact(ctx, {
      customerName: params.customerName,
      customerEmail: params.customerEmail,
      customerAddress: params.customerAddress,
      customerPhone: params.customerPhone,
    });
    contactId = contact.id;
  }

  let rawLines = params.lines;
  if (!rawLines && params.description && params.unitPrice != null) {
    rawLines = [
      {
        description: params.description,
        shortDescription: params.shortDescription || null,
        quantity: params.quantity || 1,
        unitPrice: params.unitPrice,
        imageUrl: params.imageUrl || null,
      },
    ];
  }

  let formattedLines: any[] | undefined;
  if (rawLines && rawLines.length > 0) {
    const taxRateId = await resolveTaxRateId(ctx, params.taxRatePercent);
    const accountsRes = await executeMcpTool(ctx, "list_accounts", { type: "revenue" });
    const accounts = accountsRes?.accounts || [];
    const account = accounts.find((a: any) => a.code === "4000") || accounts[0];

    formattedLines = rawLines.map((l) => ({
      description: l.description,
      ...(l.shortDescription ? { shortDescription: l.shortDescription } : {}),
      ...(l.imageUrl ? { imageUrl: l.imageUrl } : {}),
      quantity: Number(l.quantity || 1),
      unitPrice: Number(l.unitPrice || 0), // decimal pounds
      ...(account?.id ? { accountId: account.id } : {}),
      ...(taxRateId ? { taxRateId } : {}),
    }));

    if (params.shipping != null && Number(params.shipping) > 0) {
      const hasShippingLine = formattedLines.some((l) =>
        l.description.toLowerCase().startsWith("shipping") ||
        l.description.toLowerCase().startsWith("delivery")
      );
      if (!hasShippingLine) {
        formattedLines.push({
          description: "Shipping",
          quantity: 1,
          unitPrice: Number(params.shipping),
          ...(account?.id ? { accountId: account.id } : {}),
          ...(taxRateId ? { taxRateId } : {}),
        });
      }
    }
  }

  const patch: Record<string, any> = {
    invoiceId: inv.id,
  };
  if (contactId) patch.contactId = contactId;
  if (params.issueDate) {
    const norm = normalizeDateInput(params.issueDate);
    if (norm) patch.issueDate = norm;
  }
  if (params.dueDate) {
    const norm = normalizeDateInput(params.dueDate);
    if (norm) patch.dueDate = norm;
  }
  if (params.reference !== undefined) patch.reference = params.reference.trim();
  if (params.notes !== undefined) patch.notes = sanitizeNotes(params.notes) || null;
  if (formattedLines) patch.lines = formattedLines;

  await executeMcpTool(ctx, "update_invoice", patch);

  const updatedInv = await findInvoiceByNumber(ctx, inv.id);
  const totalFormatted = ((updatedInv?.total || 0) / 100).toFixed(2);
  const subtotalFormatted = ((updatedInv?.subtotal || 0) / 100).toFixed(2);
  const taxFormatted = ((updatedInv?.taxTotal || 0) / 100).toFixed(2);

  return {
    success: true,
    invoice: updatedInv,
    invoiceNumber: updatedInv?.invoiceNumber,
    customerName: updatedInv?.contact?.name || "Customer",
    subtotal: `${updatedInv?.currencyCode || "GBP"} ${subtotalFormatted}`,
    taxTotal: `${updatedInv?.currencyCode || "GBP"} ${taxFormatted}`,
    total: `${updatedInv?.currencyCode || "GBP"} ${totalFormatted}`,
    dueDate: updatedInv?.dueDate,
    status: updatedInv?.status,
    lineCount: updatedInv?.lines?.length || 0,
  };
}

/**
 * Updates an existing draft quote
 */
export async function updateQuoteAction(
  ctx: AuthContext,
  params: {
    quoteNumber: string;
    customerName?: string;
    customerEmail?: string;
    customerAddress?: string;
    customerPhone?: string;
    lines?: LineItemInput[];
    description?: string;
    unitPrice?: number;
    quantity?: number;
    taxRatePercent?: number | string;
    issueDate?: string;
    expiryDate?: string;
    reference?: string;
    notes?: string;
    shipping?: number | string;
    shortDescription?: string | null;
    imageUrl?: string | null;
  }
) {
  const q = await findQuoteByNumber(ctx, params.quoteNumber);
  if (!q) {
    return { error: `Quote "${params.quoteNumber}" not found.` };
  }

  if (q.status !== "draft") {
    return {
      error: `Only draft quotes can be edited. Quote ${q.quoteNumber} is currently in "${q.status}" status.`,
    };
  }

  let contactId: string | undefined;
  if (params.customerName) {
    const contact = await resolveContact(ctx, {
      customerName: params.customerName,
      customerEmail: params.customerEmail,
      customerAddress: params.customerAddress,
      customerPhone: params.customerPhone,
    });
    contactId = contact.id;
  }

  let rawLines = params.lines;
  if (!rawLines && params.description && params.unitPrice != null) {
    rawLines = [
      {
        description: params.description,
        shortDescription: params.shortDescription || null,
        quantity: params.quantity || 1,
        unitPrice: params.unitPrice,
        imageUrl: params.imageUrl || null,
      },
    ];
  }

  let formattedLines: any[] | undefined;
  if (rawLines && rawLines.length > 0) {
    const taxRateId = await resolveTaxRateId(ctx, params.taxRatePercent);
    const accountsRes = await executeMcpTool(ctx, "list_accounts", { type: "revenue" });
    const accounts = accountsRes?.accounts || [];
    const account = accounts.find((a: any) => a.code === "4000") || accounts[0];

    formattedLines = rawLines.map((l) => ({
      description: l.description,
      ...(l.shortDescription ? { shortDescription: l.shortDescription } : {}),
      ...(l.imageUrl ? { imageUrl: l.imageUrl } : {}),
      quantity: Number(l.quantity || 1),
      unitPrice: Number(l.unitPrice || 0), // decimal pounds
      ...(account?.id ? { accountId: account.id } : {}),
      ...(taxRateId ? { taxRateId } : {}),
    }));

    if (params.shipping != null && Number(params.shipping) > 0) {
      const hasShippingLine = formattedLines.some((l) =>
        l.description.toLowerCase().startsWith("shipping") ||
        l.description.toLowerCase().startsWith("delivery")
      );
      if (!hasShippingLine) {
        formattedLines.push({
          description: "Shipping",
          quantity: 1,
          unitPrice: Number(params.shipping),
          ...(account?.id ? { accountId: account.id } : {}),
          ...(taxRateId ? { taxRateId } : {}),
        });
      }
    }
  }

  const patch: Record<string, any> = {
    quoteId: q.id,
  };
  if (contactId) patch.contactId = contactId;
  if (params.issueDate) {
    const norm = normalizeDateInput(params.issueDate);
    if (norm) patch.issueDate = norm;
  }
  if (params.expiryDate) {
    const norm = normalizeDateInput(params.expiryDate);
    if (norm) patch.expiryDate = norm;
  }
  if (params.reference !== undefined) patch.reference = params.reference.trim();
  if (params.notes !== undefined) patch.notes = sanitizeNotes(params.notes) || null;
  if (formattedLines) patch.lines = formattedLines;

  await executeMcpTool(ctx, "update_quote", patch);

  const updatedQ = await findQuoteByNumber(ctx, q.id);
  const totalFormatted = ((updatedQ?.total || 0) / 100).toFixed(2);
  const subtotalFormatted = ((updatedQ?.subtotal || 0) / 100).toFixed(2);
  const taxFormatted = ((updatedQ?.taxTotal || 0) / 100).toFixed(2);

  return {
    success: true,
    quote: updatedQ,
    quoteNumber: updatedQ?.quoteNumber,
    customerName: updatedQ?.contact?.name || "Customer",
    subtotal: `${updatedQ?.currencyCode || "GBP"} ${subtotalFormatted}`,
    taxTotal: `${updatedQ?.currencyCode || "GBP"} ${taxFormatted}`,
    total: `${updatedQ?.currencyCode || "GBP"} ${totalFormatted}`,
    expiryDate: updatedQ?.expiryDate,
    status: updatedQ?.status,
    lineCount: updatedQ?.lines?.length || 0,
  };
}

/**
 * Sends an invoice to customer's email with PDF attached and payment link.
 */
export async function sendInvoiceEmailAction(
  ctx: AuthContext,
  params: {
    invoiceNumber: string;
    recipientEmail?: string;
    personalMessage?: string;
    subject?: string;
  }
) {
  const inv = await findInvoiceByNumber(ctx, params.invoiceNumber);
  if (!inv) {
    return { error: `Invoice "${params.invoiceNumber}" not found.` };
  }

  if (inv.status === "void") {
    return { error: `Cannot send void invoice ${inv.invoiceNumber}.` };
  }

  const email = (params.recipientEmail || inv.contact?.email || "").trim();
  if (!email || !email.includes("@")) {
    return {
      error: `No email address found for customer ${inv.contact?.name || "Customer"}. Please specify an email address, e.g. "Send invoice ${inv.invoiceNumber} to name@example.com".`,
    };
  }

  // Pre-check base exchange rate if foreign currency
  try {
    await assertBaseRateAvailable(ctx.organizationId, inv.currencyCode, inv.issueDate);
  } catch (e: any) {
    return { error: `Exchange rate error: ${e.message || String(e)}` };
  }

  // Ensure payment link token exists
  let paymentLinkToken = inv.paymentLinkToken;
  if (!paymentLinkToken) {
    paymentLinkToken = randomBytes(24).toString("hex");
    await db
      .update(invoice)
      .set({ paymentLinkToken, updatedAt: new Date() })
      .where(eq(invoice.id, inv.id));
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.fixbooks.io";
  const paymentUrl = `${baseUrl}/pay/${paymentLinkToken}`;

  const org = await db.query.organization.findFirst({
    where: eq(organization.id, ctx.organizationId),
  });

  const totalFormatted = formatMoney(inv.total, inv.currencyCode);
  const templateProps = {
    organizationName: org?.name || "Fixbooks Business",
    contactName: inv.contact?.name || "Customer",
    documentType: "Invoice",
    documentNumber: inv.invoiceNumber,
    personalMessage: params.personalMessage || undefined,
    amountFormatted: totalFormatted,
    dueDateFormatted: inv.dueDate || undefined,
    issueDateFormatted: inv.issueDate || undefined,
    viewUrl: paymentUrl,
    buttonLabel: "Pay invoice",
  };

  const html = await renderDocumentEmailHtml(templateProps);

  let pdfBuffer: Buffer | undefined;
  try {
    const { renderInvoicePdf } = await import("@/lib/documents/pdf-renderer");
    const template = await db.query.documentTemplate.findFirst({
      where: and(
        eq(documentTemplate.organizationId, ctx.organizationId),
        eq(documentTemplate.type, "invoice"),
        eq(documentTemplate.isDefault, true),
        notDeleted(documentTemplate.deletedAt)
      ),
    });
    const orgInfo = (inv.senderSnapshot as any) || (await buildSenderSnapshot(ctx.organizationId));
    const contactInfo = (inv.recipientSnapshot as any) || (inv.contact ? buildRecipientSnapshot(inv.contact) : { name: "Unknown" });

    const buf = await renderInvoicePdf(
      {
        invoiceNumber: inv.invoiceNumber,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        dateFormat: org?.dateFormat || null,
        currencyCode: inv.currencyCode || org?.defaultCurrency || "GBP",
        lines: inv.lines.map((l: any) => ({
          description: l.description,
          shortDescription: l.shortDescription,
          imageUrl: l.imageUrl,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          taxAmount: l.taxAmount,
          amount: l.amount,
          taxRate: l.taxRate ? { name: l.taxRate.name, rate: l.taxRate.rate } : null,
        })),
        subtotal: inv.subtotal,
        taxTotal: inv.taxTotal,
        taxLabel: resolveTaxLabel(inv.lines, inv.taxTotal),
        total: inv.total,
        amountPaid: inv.amountPaid,
        amountDue: inv.amountDue,
        reference: inv.reference,
        notes: inv.notes,
        paymentUrl,
      },
      orgInfo,
      contactInfo,
      template || {}
    );
    pdfBuffer = Buffer.from(buf);
  } catch (pdfErr) {
    console.error("[Bot Invoice Send] Failed to render PDF:", pdfErr);
  }

  const subject = params.subject || `Invoice ${inv.invoiceNumber} from ${org?.name || "Fixbooks"}`;

  await sendDocumentEmail({
    orgId: ctx.organizationId,
    userId: ctx.userId,
    documentType: "invoice",
    documentId: inv.id,
    recipientEmail: email,
    subject,
    body: html,
    attachPdf: true,
    pdfBuffer,
    pdfFilename: `invoice-${inv.invoiceNumber}.pdf`,
    replyTo: org?.contactEmail || undefined,
  });

  // If in draft status, post journal entries and update status to sent
  if (inv.status === "draft") {
    const senderSnapshot = await buildSenderSnapshot(ctx.organizationId);
    const recipientSnapshot = inv.contact
      ? buildRecipientSnapshot(inv.contact)
      : { name: "Unknown", email, address: null, taxNumber: null };
    const stockLines = inv.lines.filter((l: any) => l.inventoryItemId);

    await db.transaction(async (tx) => {
      let entry: any = null;
      try {
        entry = await createInvoiceJournalEntry(
          { organizationId: ctx.organizationId, userId: ctx.userId },
          {
            invoiceNumber: inv.invoiceNumber,
            total: inv.total,
            taxTotal: inv.taxTotal,
            subtotal: inv.subtotal,
            lines: inv.lines.map((l: any) => ({
              accountId: l.accountId,
              amount: l.amount,
              taxAmount: l.taxAmount,
            })),
            date: inv.issueDate,
            currencyCode: inv.currencyCode,
          },
          tx
        );
      } catch (e) {
        console.warn("[Bot Invoice Send] Journal entry warning:", e);
      }

      if (stockLines.length > 0) {
        try {
          await createCogsJournalEntry(
            { organizationId: ctx.organizationId, userId: ctx.userId },
            {
              reference: inv.invoiceNumber,
              date: inv.issueDate,
              currencyCode: inv.currencyCode,
              lines: stockLines.map((l: any) => ({
                inventoryItemId: l.inventoryItemId as string,
                quantity: l.quantity,
                warehouseId: l.warehouseId,
              })),
            },
            tx
          );
        } catch (e) {
          console.warn("[Bot Invoice Send] COGS journal entry warning:", e);
        }
      }

      await tx
        .update(invoice)
        .set({
          status: "sent",
          sentAt: new Date(),
          journalEntryId: entry?.id || null,
          senderSnapshot,
          recipientSnapshot,
          paymentLinkToken,
          paymentMethods: inv.paymentMethods && inv.paymentMethods.length > 0 ? inv.paymentMethods : ["pay_by_bank"],
          updatedAt: new Date(),
        })
        .where(eq(invoice.id, inv.id));
    });
  }

  return {
    success: true,
    invoiceNumber: inv.invoiceNumber,
    customerName: inv.contact?.name || "Customer",
    recipientEmail: email,
    total: totalFormatted,
    status: "sent",
    paymentLink: paymentUrl,
  };
}

/**
 * Sends a quote to customer's email with PDF attached.
 */
export async function sendQuoteEmailAction(
  ctx: AuthContext,
  params: {
    quoteNumber: string;
    recipientEmail?: string;
    personalMessage?: string;
    subject?: string;
  }
) {
  const q = await findQuoteByNumber(ctx, params.quoteNumber);
  if (!q) {
    return { error: `Quote "${params.quoteNumber}" not found.` };
  }

  if (q.status === "declined") {
    return { error: `Cannot send declined quote ${q.quoteNumber}.` };
  }

  const email = (params.recipientEmail || q.contact?.email || "").trim();
  if (!email || !email.includes("@")) {
    return {
      error: `No email address found for customer ${q.contact?.name || "Customer"}. Please specify an email address, e.g. "Send quote ${q.quoteNumber} to name@example.com".`,
    };
  }

  const token = await getOrCreatePortalToken(ctx.organizationId, q.contactId);

  const org = await db.query.organization.findFirst({
    where: eq(organization.id, ctx.organizationId),
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.fixbooks.io";
  const portalUrl = token ? `${baseUrl}/portal/${token.token}/quotes` : undefined;
  const totalFormatted = formatMoney(q.total, q.currencyCode);

  const templateProps = {
    organizationName: org?.name || "Fixbooks Business",
    contactName: q.contact?.name || "Customer",
    documentType: "Quote",
    documentNumber: q.quoteNumber || "Quote",
    personalMessage: params.personalMessage || undefined,
    amountFormatted: totalFormatted,
    dueDateFormatted: q.expiryDate || undefined,
    issueDateFormatted: q.issueDate || undefined,
    viewUrl: portalUrl,
    buttonLabel: portalUrl ? "View quote" : undefined,
  };

  const html = await renderDocumentEmailHtml(templateProps);

  let pdfBuffer: Buffer | undefined;
  try {
    const { renderInvoicePdf } = await import("@/lib/documents/pdf-renderer");
    const template = await db.query.documentTemplate.findFirst({
      where: and(
        eq(documentTemplate.organizationId, ctx.organizationId),
        eq(documentTemplate.type, "quote"),
        eq(documentTemplate.isDefault, true),
        notDeleted(documentTemplate.deletedAt)
      ),
    });
    const orgInfo = await buildSenderSnapshot(ctx.organizationId);
    const contactInfo = q.contact ? buildRecipientSnapshot(q.contact) : { name: "Unknown" };
    const taxLabel = resolveTaxLabel(q.lines, q.taxTotal);

    const buf = await renderInvoicePdf(
      {
        invoiceNumber: q.quoteNumber || "Quote",
        issueDate: q.issueDate,
        dueDate: q.expiryDate || q.issueDate,
        dateFormat: org?.dateFormat || null,
        lines: q.lines.map((l: any) => ({
          description: l.description,
          shortDescription: l.shortDescription,
          imageUrl: l.imageUrl,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          taxAmount: l.taxAmount,
          amount: l.amount,
          taxRate: l.taxRate ? { name: l.taxRate.name, rate: l.taxRate.rate } : null,
        })),
        subtotal: q.subtotal,
        taxTotal: q.taxTotal,
        taxLabel,
        total: q.total,
        currencyCode: q.currencyCode || org?.defaultCurrency || "GBP",
        reference: q.reference,
        notes: q.notes,
      },
      orgInfo,
      contactInfo,
      template || {},
      {
        title: "Quote",
        numberLabel: "Quote number",
        partyLabel: "Quote for",
        amountLabel: "Total",
        taxLabel: taxLabel ?? undefined,
        dateLabel: q.expiryDate ? "Valid until" : null,
        summaryNoun: q.expiryDate ? "valid until" : null,
      }
    );
    pdfBuffer = Buffer.from(buf);
  } catch (pdfErr) {
    console.error("[Bot Quote Send] Failed to render PDF:", pdfErr);
  }

  const subject = params.subject || `Quote ${q.quoteNumber} from ${org?.name || "Fixbooks"}`;

  await sendDocumentEmail({
    orgId: ctx.organizationId,
    userId: ctx.userId,
    documentType: "quote",
    documentId: q.id,
    recipientEmail: email,
    subject,
    body: html,
    attachPdf: true,
    pdfBuffer,
    pdfFilename: `quote-${q.quoteNumber}.pdf`,
    replyTo: org?.contactEmail || undefined,
  });

  if (q.status === "draft") {
    await db
      .update(quote)
      .set({
        status: "sent",
        sentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(quote.id, q.id));
  }

  return {
    success: true,
    quoteNumber: q.quoteNumber,
    customerName: q.contact?.name || "Customer",
    recipientEmail: email,
    total: totalFormatted,
    status: "sent",
  };
}

/**
 * Finds a bank transaction by ID (full UUID or short prefix) or description search
 * scoped to the organization's bank accounts.
 */
export async function findBankTransaction(
  ctx: AuthContext,
  queryOrId: string
): Promise<{ transaction: any; account: any } | null> {
  const query = (queryOrId || "").trim();
  if (!query) return null;

  try {
    const orgBankAccounts = await db.query.bankAccount.findMany({
      where: and(
        eq(bankAccount.organizationId, ctx.organizationId),
        notDeleted(bankAccount.deletedAt)
      ),
    });
    if (orgBankAccounts.length === 0) return null;
    const bankAccountIds = orgBankAccounts.map((b) => b.id);

    const cleanQuery = query.toLowerCase().replace(/^tx-/, "");

    // 1. Exact UUID match
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanQuery);
    if (isUuid) {
      const tx = await db.query.bankTransaction.findFirst({
        where: and(
          eq(bankTransaction.id, cleanQuery),
          inArray(bankTransaction.bankAccountId, bankAccountIds)
        ),
      });
      if (tx) {
        const acct = orgBankAccounts.find((a) => a.id === tx.bankAccountId);
        return { transaction: tx, account: acct };
      }
    }

    // 2. Fetch recent transactions across bank accounts (last 200)
    const txs = await db.query.bankTransaction.findMany({
      where: inArray(bankTransaction.bankAccountId, bankAccountIds),
      orderBy: desc(bankTransaction.date),
      limit: 200,
    });

    // 3. Prefix match (e.g. 6ab9e4fc)
    const byPrefix = txs.find((t) => t.id.toLowerCase().startsWith(cleanQuery));
    if (byPrefix) {
      const acct = orgBankAccounts.find((a) => a.id === byPrefix.bankAccountId);
      return { transaction: byPrefix, account: acct };
    }

    // 4. Reference match
    const byRef = txs.find((t) => t.reference && t.reference.toLowerCase() === query.toLowerCase());
    if (byRef) {
      const acct = orgBankAccounts.find((a) => a.id === byRef.bankAccountId);
      return { transaction: byRef, account: acct };
    }

    // 5. Description contains
    const byDesc = txs.find(
      (t) =>
        t.description.toLowerCase().includes(query.toLowerCase()) ||
        (t.reference && t.reference.toLowerCase().includes(query.toLowerCase()))
    );
    if (byDesc) {
      const acct = orgBankAccounts.find((a) => a.id === byDesc.bankAccountId);
      return { transaction: byDesc, account: acct };
    }

    return null;
  } catch (err) {
    console.warn("[Bot Bank Tx] Query warning:", err);
    return null;
  }
}

/**
 * Finds a supplier bill by billNumber or UUID within the current organization.
 */
export async function findBillByNumber(ctx: AuthContext, billNumberOrId: string) {
  const query = (billNumberOrId || "").trim();
  if (!query) return null;

  try {
    const isId = isUuid(query);
    const found = await db.query.bill.findFirst({
      where: and(
        isId ? eq(bill.id, query) : ilike(bill.billNumber, query),
        eq(bill.organizationId, ctx.organizationId),
        notDeleted(bill.deletedAt)
      ),
      with: {
        contact: true,
        lines: true,
      },
    });
    if (found) return found;

    const recent = await db.query.bill.findMany({
      where: and(
        eq(bill.organizationId, ctx.organizationId),
        notDeleted(bill.deletedAt)
      ),
      with: {
        contact: true,
        lines: true,
      },
      orderBy: desc(bill.createdAt),
      limit: 50,
    });

    const digitsOnly = query.replace(/[^0-9]/g, "");
    const queryNum = digitsOnly ? parseInt(digitsOnly, 10) : null;

    return (
      recent.find((b) => {
        const bNum = (b.billNumber || "").toLowerCase();
        const qClean = query.toLowerCase();
        if (bNum === qClean) return true;
        if (b.id.toLowerCase() === qClean) return true;
        if (queryNum !== null) {
          const itemDigits = bNum.replace(/[^0-9]/g, "");
          if (itemDigits && parseInt(itemDigits, 10) === queryNum) return true;
        }
        return false;
      }) || null
    );
  } catch (err) {
    console.warn("[Bot Bill Finder] Error finding bill:", err);
    return null;
  }
}

/**
 * Finds a chart of accounts account by code or name within the current organization.
 */
export async function findChartAccount(ctx: AuthContext, codeOrName: string) {
  const query = (codeOrName || "").trim();
  if (!query) return null;

  try {
    // Direct code match (e.g. "5000", "4000")
    const byCode = await db.query.chartAccount.findFirst({
      where: and(
        eq(chartAccount.organizationId, ctx.organizationId),
        eq(chartAccount.code, query),
        eq(chartAccount.isActive, true)
      ),
    });
    if (byCode) return byCode;

    const accounts = await db.query.chartAccount.findMany({
      where: and(
        eq(chartAccount.organizationId, ctx.organizationId),
        eq(chartAccount.isActive, true)
      ),
    });

    const queryLower = query.toLowerCase();
    // Exact name match
    const exactName = accounts.find((a) => a.name.toLowerCase() === queryLower);
    if (exactName) return exactName;

    // Substring match
    const partialName = accounts.find(
      (a) =>
        a.name.toLowerCase().includes(queryLower) ||
        (a.subType && a.subType.toLowerCase().includes(queryLower))
    );
    if (partialName) return partialName;

    return null;
  } catch (err) {
    console.warn("[Bot Chart Account] Query warning:", err);
    return null;
  }
}

/**
 * Lists unreconciled bank transactions for the organization with suggested matches.
 */
export async function listUnreconciledBankTransactionsAction(
  ctx: AuthContext,
  options?: {
    bankAccountId?: string;
    bankAccountName?: string;
    limit?: number;
  }
) {
  try {
    const limit = options?.limit || 10;
    const orgBankAccounts = await db.query.bankAccount.findMany({
      where: and(
        eq(bankAccount.organizationId, ctx.organizationId),
        notDeleted(bankAccount.deletedAt)
      ),
      orderBy: asc(bankAccount.accountName),
    });

    if (orgBankAccounts.length === 0) {
      return {
        bankAccounts: [],
        transactions: [],
        totalUnreconciled: 0,
        formattedMessage: "🏦 No bank accounts registered in this organization.",
      };
    }

    // Filter bank accounts if bankAccountId or bankAccountName is specified
    let targetAccounts = orgBankAccounts;
    if (options?.bankAccountId) {
      targetAccounts = orgBankAccounts.filter((b) => b.id === options.bankAccountId);
    } else if (options?.bankAccountName) {
      const q = options.bankAccountName.toLowerCase();
      const matched = orgBankAccounts.filter((b) => b.accountName.toLowerCase().includes(q));
      if (matched.length > 0) targetAccounts = matched;
    }
    const targetIds = targetAccounts.map((b) => b.id);

    // Get unreconciled counts per bank account
    const countRows = await db
      .select({
        bankAccountId: bankTransaction.bankAccountId,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(bankTransaction)
      .where(
        and(
          inArray(bankTransaction.bankAccountId, orgBankAccounts.map((b) => b.id)),
          eq(bankTransaction.status, "unreconciled")
        )
      )
      .groupBy(bankTransaction.bankAccountId);

    const countsMap = new Map<string, number>();
    countRows.forEach((r) => countsMap.set(r.bankAccountId, Number(r.count)));

    const totalUnreconciled = countRows.reduce((sum, r) => sum + Number(r.count), 0);

    // Fetch unreconciled transactions for target bank accounts
    const txRows = await db.query.bankTransaction.findMany({
      where: and(
        inArray(bankTransaction.bankAccountId, targetIds),
        eq(bankTransaction.status, "unreconciled")
      ),
      orderBy: desc(bankTransaction.date),
      limit,
    });

    // Pre-fetch open invoices and bills to quickly compute high-confidence suggested matches
    const openInvoices = await db.query.invoice.findMany({
      where: and(
        eq(invoice.organizationId, ctx.organizationId),
        notDeleted(invoice.deletedAt),
        inArray(invoice.status, ["draft", "sent", "partial", "overdue"])
      ),
      with: { contact: true },
      limit: 50,
    });

    const openBills = await db.query.bill.findMany({
      where: and(
        eq(bill.organizationId, ctx.organizationId),
        notDeleted(bill.deletedAt),
        inArray(bill.status, ["draft", "received", "partial", "overdue"])
      ),
      with: { contact: true },
      limit: 50,
    });

    const transactionsWithSuggestions = [];

    for (const t of txRows) {
      const acct = orgBankAccounts.find((b) => b.id === t.bankAccountId);
      const shortId = t.id.slice(0, 8);
      const isIncome = t.amount > 0;
      const absAmount = Math.abs(t.amount);

      let suggestedMatchText: string | null = null;
      let suggestedReconcileCmd: string | null = null;

      if (isIncome) {
        // Find matching invoice by exact amount or contact
        const match = openInvoices.find(
          (inv) =>
            inv.amountDue === t.amount ||
            inv.total === t.amount ||
            (inv.contact?.name && t.description.toLowerCase().includes(inv.contact.name.toLowerCase()))
        );
        if (match) {
          suggestedMatchText = `Invoice <b>${match.invoiceNumber}</b> (${match.contact?.name || "Customer"}, £${(match.total / 100).toFixed(2)})`;
          suggestedReconcileCmd = `/reconcile ${shortId} ${match.invoiceNumber}`;
        }
      } else {
        // Find matching bill by exact amount or supplier
        const match = openBills.find(
          (b) =>
            b.amountDue === absAmount ||
            b.total === absAmount ||
            (b.contact?.name && t.description.toLowerCase().includes(b.contact.name.toLowerCase()))
        );
        if (match) {
          suggestedMatchText = `Bill <b>${match.billNumber}</b> (${match.contact?.name || "Supplier"}, £${(match.total / 100).toFixed(2)})`;
          suggestedReconcileCmd = `/reconcile ${shortId} ${match.billNumber}`;
        }
      }

      // Fallback: check historical account suggestions if no document match found
      if (!suggestedMatchText) {
        try {
          const acctSuggestions = await suggestAccounts(t.bankAccountId, t.description, 1);
          if (acctSuggestions.length > 0 && acctSuggestions[0].confidence >= 50) {
            const sug = acctSuggestions[0];
            suggestedMatchText = `Category <b>${sug.accountCode} ${sug.accountName}</b> (${sug.confidence}% match)`;
            suggestedReconcileCmd = `/reconcile ${shortId} ${sug.accountCode}`;
          }
        } catch (e) {
          // Non-blocking
        }
      }

      transactionsWithSuggestions.push({
        ...t,
        shortId,
        accountName: acct?.accountName || "Bank",
        currencyCode: t.currencyCode || acct?.currencyCode || "GBP",
        isIncome,
        suggestedMatchText,
        suggestedReconcileCmd,
      });
    }

    // Build formatted message
    let msg = `🏦 <b>Bank Accounts Overview</b>\n\n`;
    for (const ba of orgBankAccounts) {
      const unrec = countsMap.get(ba.id) || 0;
      const balFormatted = `£${((ba.balance || 0) / 100).toFixed(2)}`;
      msg += `• <b>${ba.accountName}</b> (${ba.currencyCode}): ${balFormatted} — <b>${unrec} unreconciled</b>\n`;
    }

    if (transactionsWithSuggestions.length === 0) {
      msg += `\n🎉 <b>All caught up!</b> No unreconciled bank transactions found.`;
      return {
        bankAccounts: orgBankAccounts,
        transactions: [],
        totalUnreconciled,
        formattedMessage: msg,
      };
    }

    msg += `\n📋 <b>Unreconciled Transactions (Latest ${transactionsWithSuggestions.length})</b>:\n\n`;

    const numberEmojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

    transactionsWithSuggestions.forEach((tx, idx) => {
      const emoji = numberEmojis[idx] || `•`;
      const signEmoji = tx.isIncome ? "🟢 +" : "🔴 -";
      const amtFormatted = `£${(Math.abs(tx.amount) / 100).toFixed(2)}`;
      const dateFormatted = new Date(tx.date).toLocaleDateString("en-GB");

      msg += `${emoji} <b>[${tx.shortId}]</b> ${dateFormatted} • <b>${tx.accountName}</b>\n`;
      msg += `   ${signEmoji}${amtFormatted} — <i>${tx.description}</i>\n`;
      if (tx.reference) {
        msg += `   <i>Ref:</i> <code>${tx.reference}</code>\n`;
      }
      if (tx.suggestedMatchText) {
        msg += `   💡 <i>Suggested Match:</i> ${tx.suggestedMatchText}\n`;
        if (tx.suggestedReconcileCmd) {
          msg += `   👉 <code>${tx.suggestedReconcileCmd}</code>\n`;
        }
      } else {
        msg += `   👉 To reconcile: <code>/reconcile ${tx.shortId} &lt;INV-# / BILL-# / Account&gt;</code>\n`;
      }
      msg += `\n`;
    });

    msg += `💡 <b>Quick Commands & Natural Language:</b>\n`;
    msg += `• <code>/reconcile &lt;tx_id&gt; &lt;INV-# / BILL-# / Account&gt;</code>\n`;
    msg += `• <code>/reconcile report [bank]</code> — View reconciliation proof & balances\n`;
    msg += `• <i>Or say:</i> "Match ${transactionsWithSuggestions[0]?.shortId} with INV-00017" or "Categorize ${transactionsWithSuggestions[0]?.shortId} as Cost of Goods Sold"`;

    return {
      bankAccounts: orgBankAccounts,
      transactions: transactionsWithSuggestions,
      totalUnreconciled,
      formattedMessage: msg.trim(),
    };
  } catch (err: any) {
    console.warn("[Bot Reconcile] listUnreconciled error:", err);
    return {
      bankAccounts: [],
      transactions: [],
      totalUnreconciled: 0,
      formattedMessage: "⚠️ Database service is temporarily unavailable. Please try again shortly.",
    };
  }
}

/**
 * Gets candidate matches for a specific bank transaction.
 */
export async function getReconciliationSuggestionsAction(
  ctx: AuthContext,
  params: { transactionId: string }
) {
  const foundTx = await findBankTransaction(ctx, params.transactionId);
  if (!foundTx) {
    return {
      transaction: null,
      suggestions: null,
      formattedMessage: `⚠️ Bank transaction "<code>${params.transactionId}</code>" not found. Type <b>/reconcile</b> to see available transactions.`,
    };
  }

  const { transaction: tx, account } = foundTx;
  const shortId = tx.id.slice(0, 8);

  const res = await executeMcpTool(ctx, "get_match_suggestions", {
    transactionId: tx.id,
  });

  const candidates = res?.suggestedMatches || [];
  const existingCandidates = res?.existingCandidates || [];
  const suggestedAccounts = res?.suggestedAccounts || [];

  let msg = `🔍 <b>Reconciliation Matches for [${shortId}]</b>\n\n`;
  msg += `• <b>Bank Account:</b> ${account.accountName}\n`;
  msg += `• <b>Date:</b> ${new Date(tx.date).toLocaleDateString("en-GB")}\n`;
  msg += `• <b>Description:</b> <i>${tx.description}</i>\n`;
  if (tx.reference) msg += `• <b>Reference:</b> <code>${tx.reference}</code>\n`;
  msg += `• <b>Amount:</b> ${tx.amount > 0 ? "🟢 +" : "🔴 -"}£${(Math.abs(tx.amount) / 100).toFixed(2)}\n\n`;

  if (candidates.length === 0 && existingCandidates.length === 0 && suggestedAccounts.length === 0) {
    msg += `ℹ️ No automatic match candidates found for this transaction.\n\n`;
    msg += `👉 You can categorize it manually: <code>/reconcile ${shortId} &lt;Account Code or Name&gt;</code>`;
    return {
      transaction: tx,
      suggestions: res,
      formattedMessage: msg,
    };
  }

  if (candidates.length > 0) {
    msg += `<b>Matching Invoices / Bills:</b>\n`;
    for (const c of candidates) {
      const typeLabel = c.candidate.type === "invoice" ? "Invoice" : "Bill";
      const amtStr = `£${(Math.abs(c.candidate.amount) / 100).toFixed(2)}`;
      msg += `• ${typeLabel} <b>${c.candidate.reference || c.candidate.description}</b> (${amtStr}) — <b>${c.confidence}% match</b>\n`;
      msg += `  👉 <code>/reconcile ${shortId} ${c.candidate.reference || c.candidate.id}</code>\n`;
    }
    msg += `\n`;
  }

  if (suggestedAccounts.length > 0) {
    msg += `<b>Suggested Categories:</b>\n`;
    for (const a of suggestedAccounts.slice(0, 3)) {
      msg += `• <code>${a.accountCode}</code> <b>${a.accountName}</b> (${a.confidence}% match)\n`;
      msg += `  👉 <code>/reconcile ${shortId} ${a.accountCode}</code>\n`;
    }
    msg += `\n`;
  }

  return {
    transaction: tx,
    suggestions: res,
    formattedMessage: msg.trim(),
  };
}

/**
 * Reconciles a bank transaction by matching with an invoice, bill, or chart account.
 */
export async function reconcileBankTransactionAction(
  ctx: AuthContext,
  params: {
    transactionId: string;
    invoiceNumber?: string;
    billNumber?: string;
    accountCodeOrName?: string;
    target?: string;
    memo?: string;
  }
) {
  const foundTx = await findBankTransaction(ctx, params.transactionId);
  if (!foundTx) {
    return {
      success: false,
      error: `Bank transaction "${params.transactionId}" not found. Type /reconcile to view recent transactions.`,
      formattedMessage: `⚠️ Bank transaction "<code>${params.transactionId}</code>" not found. Type <b>/reconcile</b> to see available transactions.`,
    };
  }

  const { transaction: tx, account } = foundTx;

  if (tx.status === "reconciled") {
    return {
      success: false,
      error: `Bank transaction "${tx.id.slice(0, 8)}" is already reconciled.`,
      formattedMessage: `ℹ️ Transaction <b>${tx.id.slice(0, 8)}</b> is already reconciled.`,
    };
  }

  let rawTarget = (params.target || "").trim();
  let invoiceQuery = (params.invoiceNumber || "").trim();
  let billQuery = (params.billNumber || "").trim();
  let accountQuery = (params.accountCodeOrName || "").trim();

  // If generic target supplied, classify whether it is an invoice, bill, or account
  if (rawTarget && !invoiceQuery && !billQuery && !accountQuery) {
    if (/^inv/i.test(rawTarget) || (tx.amount > 0 && /^\d+$/.test(rawTarget) && rawTarget.length >= 4)) {
      invoiceQuery = rawTarget;
    } else if (/^bill/i.test(rawTarget) || (tx.amount < 0 && /^bill/i.test(rawTarget))) {
      billQuery = rawTarget;
    } else if (/^\d{3,5}$/.test(rawTarget)) {
      // numeric 4-digit code e.g. 5000, 4000, 7000
      accountQuery = rawTarget;
    } else {
      // Check if target matches invoice
      const maybeInv = await findInvoiceByNumber(ctx, rawTarget);
      if (maybeInv) {
        invoiceQuery = rawTarget;
      } else {
        const maybeBill = await findBillByNumber(ctx, rawTarget);
        if (maybeBill) {
          billQuery = rawTarget;
        } else {
          accountQuery = rawTarget;
        }
      }
    }
  }

  // If no target specified at all, try auto-matching using suggestions
  if (!invoiceQuery && !billQuery && !accountQuery) {
    try {
      const suggestionsRes = await executeMcpTool(ctx, "get_match_suggestions", {
        transactionId: tx.id,
      });
      const topMatch = suggestionsRes?.suggestedMatches?.[0];
      if (topMatch && topMatch.confidence >= 60) {
        if (topMatch.candidate.type === "invoice") {
          invoiceQuery = topMatch.candidate.id;
        } else if (topMatch.candidate.type === "bill") {
          billQuery = topMatch.candidate.id;
        }
      } else if (suggestionsRes?.suggestedAccounts?.[0]?.confidence >= 60) {
        accountQuery = suggestionsRes.suggestedAccounts[0].accountCode;
      }
    } catch (e) {
      // proceed
    }
  }

  // If STILL no target, prompt user with options
  if (!invoiceQuery && !billQuery && !accountQuery) {
    const suggestionsRes = await executeMcpTool(ctx, "get_match_suggestions", {
      transactionId: tx.id,
    });
    const candidates = suggestionsRes?.suggestedMatches || [];
    const acctCandidates = suggestionsRes?.suggestedAccounts || [];

    let msg = `🤔 <b>Reconciliation Options for [${tx.id.slice(0, 8)}]</b>\n\n`;
    msg += `• <b>Description:</b> ${tx.description}\n`;
    msg += `• <b>Amount:</b> ${tx.amount > 0 ? "🟢 +" : "🔴 -"}£${(Math.abs(tx.amount) / 100).toFixed(2)}\n\n`;

    if (candidates.length > 0) {
      msg += `<b>Matching Documents Found:</b>\n`;
      for (const c of candidates) {
        msg += `• ${c.candidate.type.toUpperCase()}: <b>${c.candidate.description}</b> (£${(Math.abs(c.candidate.amount) / 100).toFixed(2)}) — ${c.confidence}% match\n`;
        msg += `  👉 <code>/reconcile ${tx.id.slice(0, 8)} ${c.candidate.reference || c.candidate.id}</code>\n`;
      }
      msg += `\n`;
    }

    if (acctCandidates.length > 0) {
      msg += `<b>Suggested Categories:</b>\n`;
      for (const a of acctCandidates.slice(0, 3)) {
        msg += `• <code>${a.accountCode}</code> <b>${a.accountName}</b> (${a.confidence}% match)\n`;
        msg += `  👉 <code>/reconcile ${tx.id.slice(0, 8)} ${a.accountCode}</code>\n`;
      }
      msg += `\n`;
    }

    msg += `Please specify what to reconcile with, e.g.:\n<code>/reconcile ${tx.id.slice(0, 8)} &lt;INV-# / BILL-# / Account&gt;</code>`;

    return {
      success: false,
      error: "No target specified. Suggested options provided.",
      formattedMessage: msg,
    };
  }

  // 1. MATCH TO INVOICE
  if (invoiceQuery) {
    const inv = await findInvoiceByNumber(ctx, invoiceQuery);
    if (!inv) {
      return {
        success: false,
        error: `Invoice "${invoiceQuery}" not found.`,
        formattedMessage: `⚠️ Invoice "<b>${invoiceQuery}</b>" not found. Please check the invoice number.`,
      };
    }

    // If invoice is in draft, activate it so settlement succeeds
    if (inv.status === "draft") {
      try {
        await createInvoiceJournalEntry(
          { organizationId: ctx.organizationId, userId: ctx.userId },
          {
            invoiceNumber: inv.invoiceNumber,
            total: inv.total,
            taxTotal: inv.taxTotal,
            subtotal: inv.subtotal,
            lines: inv.lines.map((l: any) => ({
              accountId: l.accountId,
              amount: l.amount,
              taxAmount: l.taxAmount,
            })),
            date: inv.issueDate,
            currencyCode: inv.currencyCode,
          }
        );
        await db
          .update(invoice)
          .set({ status: "sent", updatedAt: new Date() })
          .where(eq(invoice.id, inv.id));
      } catch (err) {
        console.warn("[Bot Reconcile] Auto-posting draft invoice journal warning:", err);
      }
    }

    const amountToApply = Math.min(Math.abs(tx.amount), inv.amountDue > 0 ? inv.amountDue : Math.abs(tx.amount));

    const matchRes = await executeMcpTool(ctx, "match_to_invoice", {
      transactionId: tx.id,
      invoiceId: inv.id,
      amount: amountToApply,
    });

    if (matchRes?.error) {
      return {
        success: false,
        error: matchRes.error,
        formattedMessage: `⚠️ Failed to match invoice: ${matchRes.error}`,
      };
    }

    const remainingDue = Math.max(0, inv.amountDue - amountToApply);
    const newStatus = (matchRes?.invoiceStatus || (remainingDue === 0 ? "paid" : "partial")).toUpperCase();
    const paymentNum = matchRes?.payment?.paymentNumber || "Recorded";

    const msg =
      `✅ <b>Bank Transaction Reconciled!</b>\n\n` +
      `• <b>Transaction:</b> <i>${tx.description}</i>\n` +
      `• <b>Amount:</b> 🟢 +£${(Math.abs(tx.amount) / 100).toFixed(2)} (${account.accountName})\n` +
      `• <b>Matched To:</b> Invoice <b>${inv.invoiceNumber}</b> (${inv.contact?.name || "Customer"})\n` +
      `• <b>Payment Recorded:</b> <code>${paymentNum}</code>\n` +
      `• <b>Invoice Status:</b> <b>${newStatus}</b>\n` +
      `• <b>Remaining Balance:</b> £${(remainingDue / 100).toFixed(2)}\n` +
      `• <b>Accounting Ledger:</b> Posted DR Bank (${account.accountName}) / CR Accounts Receivable\n\n` +
      `🎉 <i>Transaction is now marked as Reconciled.</i>`;

    return {
      success: true,
      actionType: "invoice" as const,
      transaction: tx,
      matchedEntity: inv,
      formattedMessage: msg,
    };
  }

  // 2. MATCH TO BILL
  if (billQuery) {
    const foundBill = await findBillByNumber(ctx, billQuery);
    if (!foundBill) {
      return {
        success: false,
        error: `Bill "${billQuery}" not found.`,
        formattedMessage: `⚠️ Bill "<b>${billQuery}</b>" not found. Please check the bill number.`,
      };
    }

    // If bill is in draft, activate it so settlement succeeds
    if (foundBill.status === "draft") {
      try {
        await createBillJournalEntry(
          { organizationId: ctx.organizationId, userId: ctx.userId },
          {
            billNumber: foundBill.billNumber,
            total: foundBill.total,
            taxTotal: foundBill.taxTotal,
            lines: foundBill.lines.map((l: any) => ({
              accountId: l.accountId,
              amount: l.amount,
              taxAmount: l.taxAmount,
            })),
            date: foundBill.issueDate,
            currencyCode: foundBill.currencyCode,
          }
        );
        await db
          .update(bill)
          .set({ status: "received", updatedAt: new Date() })
          .where(eq(bill.id, foundBill.id));
      } catch (err) {
        console.warn("[Bot Reconcile] Auto-posting draft bill journal warning:", err);
      }
    }

    const amountToApply = Math.min(Math.abs(tx.amount), foundBill.amountDue > 0 ? foundBill.amountDue : Math.abs(tx.amount));

    const matchRes = await executeMcpTool(ctx, "match_to_bill", {
      transactionId: tx.id,
      billId: foundBill.id,
      amount: amountToApply,
    });

    if (matchRes?.error) {
      return {
        success: false,
        error: matchRes.error,
        formattedMessage: `⚠️ Failed to match bill: ${matchRes.error}`,
      };
    }

    const remainingDue = Math.max(0, foundBill.amountDue - amountToApply);
    const newStatus = (matchRes?.billStatus || (remainingDue === 0 ? "paid" : "partial")).toUpperCase();
    const paymentNum = matchRes?.payment?.paymentNumber || "Recorded";

    const msg =
      `✅ <b>Bank Transaction Reconciled!</b>\n\n` +
      `• <b>Transaction:</b> <i>${tx.description}</i>\n` +
      `• <b>Amount:</b> 🔴 -£${(Math.abs(tx.amount) / 100).toFixed(2)} (${account.accountName})\n` +
      `• <b>Matched To:</b> Bill <b>${foundBill.billNumber}</b> (${foundBill.contact?.name || "Supplier"})\n` +
      `• <b>Payment Recorded:</b> <code>${paymentNum}</code>\n` +
      `• <b>Bill Status:</b> <b>${newStatus}</b>\n` +
      `• <b>Remaining Balance:</b> £${(remainingDue / 100).toFixed(2)}\n` +
      `• <b>Accounting Ledger:</b> Posted DR Accounts Payable / CR Bank (${account.accountName})\n\n` +
      `🎉 <i>Transaction is now marked as Reconciled.</i>`;

    return {
      success: true,
      actionType: "bill" as const,
      transaction: tx,
      matchedEntity: foundBill,
      formattedMessage: msg,
    };
  }

  // 3. CATEGORIZE TO CHART ACCOUNT
  if (accountQuery) {
    const acct = await findChartAccount(ctx, accountQuery);
    if (!acct) {
      return {
        success: false,
        error: `Chart of accounts category "${accountQuery}" not found.`,
        formattedMessage: `⚠️ Category "<b>${accountQuery}</b>" not found. You can enter an account code (e.g. <code>5000</code>) or name (e.g. <code>Cost of Goods Sold</code>).`,
      };
    }

    const catRes = await executeMcpTool(ctx, "categorize_bank_transaction", {
      transactionId: tx.id,
      accountId: acct.id,
      memo: params.memo || tx.description,
    });

    if (catRes?.error) {
      return {
        success: false,
        error: catRes.error,
        formattedMessage: `⚠️ Failed to categorize transaction: ${catRes.error}`,
      };
    }

    const isIncome = tx.amount > 0;
    const debitCredit = isIncome
      ? `DR Bank (${account.accountName}) / CR ${acct.name} (${acct.code})`
      : `DR ${acct.name} (${acct.code}) / CR Bank (${account.accountName})`;

    const msg =
      `✅ <b>Bank Transaction Reconciled & Categorized!</b>\n\n` +
      `• <b>Transaction:</b> <i>${tx.description}</i>\n` +
      `• <b>Amount:</b> ${isIncome ? "🟢 +" : "🔴 -"}£${(Math.abs(tx.amount) / 100).toFixed(2)} (${account.accountName})\n` +
      `• <b>Category:</b> <b>${acct.code} — ${acct.name}</b> (${acct.type})\n` +
      `• <b>Double Entry:</b> <code>${debitCredit}</code>\n` +
      `• <b>Status:</b> <b>RECONCILED</b>\n\n` +
      `🎉 <i>Posted to general ledger and reconciled successfully.</i>`;

    return {
      success: true,
      actionType: "account" as const,
      transaction: tx,
      matchedEntity: acct,
      formattedMessage: msg,
    };
  }

  return {
    success: false,
    error: "Unable to reconcile transaction.",
    formattedMessage: "⚠️ Unable to determine reconciliation target. Type <b>/reconcile</b> to see suggestions.",
  };
}

/**
 * Generates reconciliation proof report for bank accounts.
 */
export async function getReconciliationReportAction(
  ctx: AuthContext,
  params?: {
    bankAccountId?: string;
    bankAccountName?: string;
  }
) {
  let orgBankAccounts: any[] = [];
  try {
    orgBankAccounts = await db.query.bankAccount.findMany({
      where: and(
        eq(bankAccount.organizationId, ctx.organizationId),
        notDeleted(bankAccount.deletedAt)
      ),
      orderBy: asc(bankAccount.accountName),
    });
  } catch (err: any) {
    console.warn("[Bot Reconcile Report] Error fetching bank accounts:", err);
    return {
      reports: [],
      formattedMessage: "⚠️ Database service is temporarily unavailable. Please try again shortly.",
    };
  }

  if (orgBankAccounts.length === 0) {
    return {
      reports: [],
      formattedMessage: "🏦 No bank accounts registered in this organization.",
    };
  }

  let targetAccounts = orgBankAccounts;
  if (params?.bankAccountId) {
    targetAccounts = orgBankAccounts.filter((b) => b.id === params.bankAccountId);
  } else if (params?.bankAccountName) {
    const q = params.bankAccountName.toLowerCase();
    const matched = orgBankAccounts.filter((b) => b.accountName.toLowerCase().includes(q));
    if (matched.length > 0) targetAccounts = matched;
  }

  const reports: any[] = [];
  let msg = `📊 <b>Bank Reconciliation Report</b>\n\n`;

  for (const ba of targetAccounts) {
    try {
      const rep = await executeMcpTool(ctx, "reconciliation_report", {
        bankAccountId: ba.id,
      });

      const stmtEnd = rep?.statementEndBalance ?? ba.balance;
      const glBal = rep?.glBalance ?? stmtEnd;
      const diff = rep?.difference ?? 0;
      const isBalanced = rep?.isBalanced ?? diff === 0;

      reports.push({
        bankAccount: ba,
        report: rep,
      });

      const stmtEndFormatted = `£${(stmtEnd / 100).toFixed(2)}`;
      const glBalFormatted = `£${(glBal / 100).toFixed(2)}`;
      const diffFormatted = `£${(Math.abs(diff) / 100).toFixed(2)}`;

      msg += `🏦 <b>${ba.accountName}</b> (${ba.currencyCode})\n`;
      msg += `• <b>Statement Closing Balance:</b> ${stmtEndFormatted}\n`;
      msg += `• <b>General Ledger Balance:</b> ${glBalFormatted}\n`;
      msg += `• <b>Variance:</b> ${isBalanced ? "£0.00 (Balanced ✅)" : `${diffFormatted} ⚠️`}\n`;
      msg += `• <b>Reconciled Lines:</b> ${rep?.reconciled?.count || 0}\n`;
      msg += `• <b>Unreconciled Lines:</b> ${rep?.unreconciled?.count || 0}\n\n`;
    } catch (err: any) {
      msg += `🏦 <b>${ba.accountName}</b>: ${err?.message || "Report unavailable"}\n\n`;
    }
  }

  msg += `💡 Type <code>/reconcile</code> to review unreconciled statement lines.`;

  return {
    reports,
    formattedMessage: msg.trim(),
  };
}

