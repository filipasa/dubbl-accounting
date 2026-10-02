import { test } from "node:test";
import assert from "node:assert/strict";
import { generateInvoiceHtml, generateDocumentHtml } from "../lib/documents/pdf-generator";
import { renderInvoicePdf } from "../lib/documents/pdf-renderer";

const sampleOrg = {
  name: "Acme Doors Ltd",
  address: "123 High Street, London",
  email: "info@acmedoors.co.uk",
  phone: "020 1234 5678",
  countryCode: "GB",
};

const sampleInvoice = {
  invoiceNumber: "INV-00100",
  issueDate: "2026-08-09",
  dueDate: "2026-09-08",
  status: "sent",
  contactName: "ILIE Sula",
  contactEmail: "zamos.construction@gmail.com",
  contactAddress: "25 Sandover, Northampton, NN4 0TS",
  lines: [
    {
      description: "Concealed Omega Primed Door Set",
      quantity: 100,
      unitPrice: 48750,
      taxAmount: 9750,
      amount: 48750,
    },
  ],
  subtotal: 48750,
  taxTotal: 9750,
  taxLabel: "VAT (20%)",
  total: 58500,
  currencyCode: "GBP",
};

test("generateInvoiceHtml includes logo img tag when logoUrl is present", () => {
  const logoUrl = "https://example.com/brand-logo.png";
  const html = generateInvoiceHtml(
    sampleInvoice,
    sampleOrg,
    {
      logoUrl,
      accentColor: "#eb8b05",
    }
  );

  assert.ok(html.includes(`src="${logoUrl}"`), "HTML should contain logo src");
  assert.ok(html.includes(`alt="Logo"`), "HTML should contain alt='Logo'");
});

test("generateInvoiceHtml does not render logo img tag when logoUrl is absent or empty", () => {
  const html = generateInvoiceHtml(
    sampleInvoice,
    sampleOrg,
    {
      logoUrl: null,
      accentColor: "#eb8b05",
    }
  );

  assert.ok(!html.includes(`alt="Logo"`), "HTML should not contain alt='Logo'");
});

test("generateDocumentHtml includes logo img tag for quotes and credit notes", () => {
  const logoUrl = "https://example.com/company-logo.png";
  const docData = {
    documentNumber: "QTE-00042",
    issueDate: "2026-08-09",
    secondDate: "2026-09-08",
    status: "draft",
    contactName: "ILIE Sula",
    lines: [
      {
        description: "Omega Door Set",
        quantity: 100,
        unitPrice: 48750,
        taxAmount: 9750,
        amount: 48750,
      },
    ],
    subtotal: 48750,
    taxTotal: 9750,
    taxLabel: "VAT (20%)",
    total: 58500,
    currencyCode: "GBP",
  };

  const html = generateDocumentHtml(
    "quote",
    docData,
    sampleOrg,
    { logoUrl, accentColor: "#eb8b05" }
  );

  assert.ok(html.includes(`src="${logoUrl}"`), "Quote HTML should contain logo src");
  assert.ok(html.includes("Quote QTE-00042"), "Should render Quote heading and title");
});

test("renderInvoicePdf renders PDF successfully with and without logo", async () => {
  const samplePdfData = {
    invoiceNumber: "INV-00100",
    issueDate: "2026-08-09",
    dueDate: "2026-09-08",
    lines: [
      {
        description: "Concealed Omega Primed Door Set",
        quantity: 100,
        unitPrice: 48750,
        taxAmount: 9750,
        amount: 48750,
      },
    ],
    subtotal: 48750,
    taxTotal: 9750,
    taxLabel: "VAT (20%)",
    total: 58500,
    currencyCode: "GBP",
  };

  // 1. Without logo
  const pdfNoLogo = await renderInvoicePdf(
    samplePdfData,
    sampleOrg,
    { name: "ILIE Sula" },
    { accentColor: "#eb8b05" }
  );
  assert.ok(pdfNoLogo.byteLength > 1000, "PDF buffer without logo should be non-empty");

  // 2. With base64 data URI logo
  // 1x1 transparent png
  const dataUriLogo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const pdfWithLogo = await renderInvoicePdf(
    samplePdfData,
    sampleOrg,
    { name: "ILIE Sula" },
    { logoUrl: dataUriLogo, accentColor: "#eb8b05" }
  );
  assert.ok(pdfWithLogo.byteLength > 1000, "PDF buffer with logo should be non-empty");
});
