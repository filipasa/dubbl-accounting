import { test } from "node:test";
import assert from "node:assert/strict";
import { generateQuoteHtml } from "../lib/documents/pdf-generator";
import { renderInvoicePdf } from "../lib/documents/pdf-renderer";

const sampleOrg = {
  name: "Doors Delivered",
  registrationNumber: "14814854",
  address: "Unit A, 82 James Carter Road, Mildenhall, IP28 7DE",
  email: "sales@doorsdelivered.com",
  countryCode: "GB",
};

const sampleQuote = {
  documentNumber: "75295",
  issueDate: "2026-09-08",
  secondDate: "2026-09-23",
  contactName: "Sample Name",
  contactEmail: "sample@example.com",
  contactAddress: "United Kingdom (UK)",
  lines: [
    {
      description: "Frameless Hidden Door with Concealed Design",
      shortDescription: "Door Size: 1981 x 838\nHinge & Latch Finish: Matt Black",
      quantity: 800,
      unitPrice: 55495,
      taxAmount: 88792,
      amount: 443960,
      imageUrl: "/doors-thumbnail.png",
      taxRate: { name: "VAT", rate: 2000 },
    },
    {
      description: "Discounts",
      quantity: 100,
      unitPrice: -32900,
      taxAmount: 0,
      amount: -32900,
    },
    {
      description: "Delivery",
      quantity: 100,
      unitPrice: 15000,
      taxAmount: 0,
      amount: 15000,
    },
  ],
  subtotal: 443960,
  taxTotal: 88792,
  taxLabel: "VAT (20%)",
  total: 514852,
  currencyCode: "GBP",
};

const template = {
  layout: "quotation",
  logoUrl: "/doors-delivered-logo.png",
  accentColor: "#fe8f3d",
  bankDetails: "Account Name: LEGACY LINE VENTURES LTD\nAccount Number: 60269251\nSort Code: 23-11-85\nBank: Payrnet",
  notes: "This quotation is valid for 15 days from the issue date.",
};

test("generateQuoteHtml renders quotation layout matching example.pdf", () => {
  const html = generateQuoteHtml(sampleQuote, sampleOrg, template);

  assert.ok(html.includes("Quotation"), "Should render Quotation title");
  assert.ok(html.includes("Quotation From"), "Should render Quotation From section");
  assert.ok(html.includes("Quotation For"), "Should render Quotation For section");
  assert.ok(html.includes("Legacy line Ventures LTD T/N DOORS DELIVERED"), "Should render trade name");
  assert.ok(html.includes("Sample Name"), "Should render customer name");
  assert.ok(html.includes("sample@example.com"), "Should render customer email");
  assert.ok(html.includes("VAT Rate"), "Should render VAT Rate column");
  assert.ok(html.includes("Bank Details"), "Should render Bank Details section");
  assert.ok(html.includes("LEGACY LINE VENTURES LTD"), "Should render bank account name");
  assert.ok(html.includes("60269251"), "Should render bank account number");
  assert.ok(html.includes("Total (GBP)"), "Should render Total (GBP)");

  const deliveryIndex = html.indexOf(">Delivery</td>");
  const vatIndex = html.indexOf(">VAT</td>");
  assert.ok(deliveryIndex !== -1, "Should render Delivery row");
  assert.ok(vatIndex !== -1, "Should render VAT row");
  assert.ok(deliveryIndex < vatIndex, "Delivery should appear before VAT in quotation totals");
});

test("renderInvoicePdf renders PDF with quotation layout", async () => {
  const pdfBuffer = await renderInvoicePdf(
    {
      invoiceNumber: sampleQuote.documentNumber,
      issueDate: sampleQuote.issueDate,
      dueDate: sampleQuote.secondDate,
      lines: sampleQuote.lines,
      subtotal: sampleQuote.subtotal,
      taxTotal: sampleQuote.taxTotal,
      total: sampleQuote.total,
      currencyCode: sampleQuote.currencyCode,
    },
    sampleOrg,
    {
      name: sampleQuote.contactName,
      address: sampleQuote.contactAddress,
    },
    template,
    {
      title: "Quotation",
      numberLabel: "Quotation No #",
      partyLabel: "Quotation For",
    }
  );

  assert.ok(pdfBuffer instanceof ArrayBuffer, "Should return an ArrayBuffer");
  assert.ok(pdfBuffer.byteLength > 1000, "PDF buffer should contain valid bytes");
});
