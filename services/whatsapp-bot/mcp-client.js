import { config } from "./config.js";

/**
 * Execute a tool on the Dubbl MCP Server
 */
export async function callMcpTool(name, args = {}) {
  const res = await fetch(config.dubblUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.dubblToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: {
        name,
        arguments: args,
      },
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`MCP Error ${res.status}: ${errorText}`);
  }

  const text = await res.text();
  for (const line of text.split("\n")) {
    if (line.startsWith("data: ")) {
      try {
        const payload = JSON.parse(line.slice(6));
        if (payload.result?.isError) {
          const errMsg = payload.result.content?.[0]?.text || "Unknown error";
          throw new Error(errMsg);
        }
        if (payload.result?.content?.[0]?.text) {
          return JSON.parse(payload.result.content[0].text);
        }
        return payload.result;
      } catch (err) {
        if (
          err.message.startsWith("MCP Error") ||
          err.message.includes("error")
        ) {
          throw err;
        }
      }
    }
  }

  throw new Error("Empty or unrecognized response from Dubbl MCP");
}

export async function getOrganization() {
  const result = await callMcpTool("get_organization");
  return result.organization;
}

export async function listContacts(search = "") {
  const args = { limit: 50 };
  if (search) args.search = search;
  const result = await callMcpTool("list_contacts", args);
  return result.contacts || [];
}

export async function listInvoices(limit = 5) {
  const result = await callMcpTool("list_invoices", { limit });
  return result.invoices || [];
}

export async function listQuotes(limit = 5) {
  const result = await callMcpTool("list_quotes", { limit });
  return result.quotes || [];
}

export async function listRevenueAccounts() {
  const result = await callMcpTool("list_accounts", { type: "revenue" });
  return result.accounts || [];
}

export async function listTaxRates() {
  const result = await callMcpTool("list_tax_rates");
  return result.taxRates || [];
}

/**
 * Resolves a tax rate UUID from percentage or rate name (e.g. 20, "20%", "standard")
 */
export async function resolveTaxRateId(taxRateInput) {
  if (taxRateInput == null || taxRateInput === "") return undefined;
  const taxRates = await listTaxRates();
  if (!taxRates || taxRates.length === 0) return undefined;

  const num = typeof taxRateInput === "number" ? taxRateInput : parseFloat(taxRateInput);
  if (!isNaN(num)) {
    const basisPoints = Math.round(num * 100);
    const match = taxRates.find((t) => t.rate === basisPoints && t.isActive !== false);
    if (match) return match.id;
  }

  const str = String(taxRateInput).toLowerCase();
  if (str.includes("20")) {
    const match = taxRates.find((t) => t.rate === 2000);
    if (match) return match.id;
  }
  if (str.includes("5")) {
    const match = taxRates.find((t) => t.rate === 500);
    if (match) return match.id;
  }
  if (str.includes("zero") || str === "0" || str.includes("0%")) {
    const match = taxRates.find((t) => t.rate === 0 && t.name.toLowerCase().includes("zero"));
    if (match) return match.id;
  }
  if (str.includes("exempt")) {
    const match = taxRates.find((t) => t.kind === "exempt");
    if (match) return match.id;
  }

  const byName = taxRates.find((t) => t.name.toLowerCase().includes(str));
  return byName?.id;
}

function parseAddressString(rawAddress) {
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
 * Find or create a contact with email and address support
 */
export async function resolveContact({
  customerName,
  customerEmail,
  customerAddress,
  customerPhone,
}) {
  const contacts = await listContacts(customerName);
  let contact = contacts.find(
    (c) => c.name.toLowerCase() === customerName.toLowerCase()
  );

  if (!contact && contacts.length > 0) {
    contact = contacts.find((c) =>
      c.name.toLowerCase().includes(customerName.toLowerCase())
    );
  }

  const parsedAddr = customerAddress ? parseAddressString(customerAddress) : {};

  if (!contact) {
    const newContact = await callMcpTool("create_contact", {
      name: customerName,
      type: "customer",
      currencyCode: "GBP",
      ...(customerEmail ? { email: customerEmail } : {}),
      ...(customerPhone ? { phone: customerPhone } : {}),
      ...(parsedAddr.addressLine ? { addressLine: parsedAddr.addressLine } : {}),
      ...(parsedAddr.city ? { city: parsedAddr.city } : {}),
      ...(parsedAddr.postalCode ? { postalCode: parsedAddr.postalCode } : {}),
    });
    contact = newContact.contact;
  } else if (
    (customerEmail && !contact.email) ||
    (parsedAddr.addressLine && (!contact.addresses || !contact.addresses.billing))
  ) {
    await callMcpTool("update_contact", {
      contactId: contact.id,
      ...(customerEmail && !contact.email ? { email: customerEmail } : {}),
      ...(parsedAddr.addressLine ? { addressLine: parsedAddr.addressLine } : {}),
      ...(parsedAddr.city ? { city: parsedAddr.city } : {}),
      ...(parsedAddr.postalCode ? { postalCode: parsedAddr.postalCode } : {}),
    }).catch(() => {});
  }

  return contact;
}

/**
 * High-level helper to create a sales quote (estimate)
 */
export async function createQuote({
  customerName,
  customerEmail,
  customerAddress,
  customerPhone,
  lines = [],
  description,
  unitPrice,
  quantity = 1,
  taxRatePercent,
  currencyCode,
  expiryDate,
  reference,
  notes,
}) {
  const org = await getOrganization();
  const contact = await resolveContact({
    customerName,
    customerEmail,
    customerAddress,
    customerPhone,
  });

  const currency = currencyCode || org?.defaultCurrency || "GBP";
  const accounts = await listRevenueAccounts();
  const account = accounts.find((a) => a.code === "4000") || accounts[0];

  const taxRateId = await resolveTaxRateId(taxRatePercent);

  let normalizedLines = [];
  if (Array.isArray(lines) && lines.length > 0) {
    normalizedLines = lines;
  } else if (description) {
    normalizedLines = [{ description, unitPrice, quantity }];
  }

  if (normalizedLines.length === 0) {
    throw new Error("Quote must have at least one line item with description and unit price.");
  }

  // create_quote expects unitPrice in integer cents (e.g. 58000 for £580.00)
  const formattedLines = normalizedLines.map((l) => {
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
  const calculatedExpiry =
    expiryDate ||
    new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

  const res = await callMcpTool("create_quote", {
    contactId: contact.id,
    currencyCode: currency,
    issueDate: today,
    expiryDate: calculatedExpiry,
    reference: reference || `QTE-${Date.now().toString().slice(-4)}`,
    notes: notes || (customerAddress ? `Address: ${customerAddress}` : "Created via WhatsApp Bot"),
    lines: formattedLines,
  });

  return {
    quote: res.quote,
    contact,
  };
}

/**
 * High-level helper to create an invoice with contact auto-resolution and multi-line support
 */
export async function createInvoice({
  customerName,
  customerEmail,
  customerAddress,
  customerPhone,
  lines = [],
  description,
  unitPrice,
  quantity = 1,
  taxRatePercent,
  currencyCode,
  dueDate,
  reference,
  notes,
}) {
  const org = await getOrganization();
  const contact = await resolveContact({
    customerName,
    customerEmail,
    customerAddress,
    customerPhone,
  });

  const currency = currencyCode || org?.defaultCurrency || "GBP";
  const accounts = await listRevenueAccounts();
  const account = accounts.find((a) => a.code === "4000") || accounts[0];

  const taxRateId = await resolveTaxRateId(taxRatePercent);

  let normalizedLines = [];
  if (Array.isArray(lines) && lines.length > 0) {
    normalizedLines = lines;
  } else if (description) {
    normalizedLines = [{ description, unitPrice, quantity }];
  }

  if (normalizedLines.length === 0) {
    throw new Error("Invoice must have at least one line item with description and unit price.");
  }

  // create_invoice expects decimal unitPrice (e.g. 580 for £580.00)
  const formattedLines = normalizedLines.map((l) => ({
    description: l.description,
    quantity: Number(l.quantity || 1),
    unitPrice: Number(l.unitPrice || 0),
    ...(account?.id ? { accountId: account.id } : {}),
    ...(taxRateId ? { taxRateId } : {}),
  }));

  const today = new Date().toISOString().split("T")[0];
  const calculatedDueDate =
    dueDate ||
    new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

  const res = await callMcpTool("create_invoice", {
    contactId: contact.id,
    currencyCode: currency,
    issueDate: today,
    dueDate: calculatedDueDate,
    reference: reference || `WA-${Date.now().toString().slice(-4)}`,
    notes: notes || (customerAddress ? `Address: ${customerAddress}` : "Created via WhatsApp Bot"),
    lines: formattedLines,
  });

  return {
    invoice: res.invoice,
    contact,
  };
}
