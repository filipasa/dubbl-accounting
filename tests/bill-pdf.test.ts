import { test } from "node:test";
import assert from "node:assert/strict";
import { generateBillHtml } from "../lib/documents/pdf-generator";
import { renderInvoicePdf } from "../lib/documents/pdf-renderer";

const sampleOrg = {
  name: "Doors Delivered",
  registrationNumber: "14814854",
  address: "Unit A, 82 James Carter Road, Mildenhall, IP28 7DE",
  email: "accounts@doorsdelivered.com",
  countryCode: "GB",
};

const sampleBill = {
  documentNumber: "BILL-00001",
  issueDate: "2026-09-08",
  secondDate: "2026-10-08",
  contactName: "Timber Supplier Ltd",
  contactEmail: "billing@timbersupplier.co.uk",
  contactAddress: "Unit 4 Industrial Estate, London",
  lines: [
    {
      description: "Hardwood Door Blanks",
      quantity: 500,
      unitPrice: 12000,
      taxAmount: 12000,
      amount: 60000,
      taxRate: { name: "VAT (20%)", rate: 2000 },
    },
  ],
  subtotal: 60000,
  taxTotal: 12000,
  taxLabel: "VAT (20%)",
  total: 72000,
  amountPaid: 0,
  amountDue: 72000,
  currencyCode: "GBP",
  reference: "PO-00012",
  notes: "Standard 30 day terms.",
};

test("generateBillHtml renders bill HTML correctly", () => {
  const html = generateBillHtml(sampleBill, sampleOrg, {});

  assert.ok(html.includes("Bill BILL-00001"), "Should render Bill title with bill number");
  assert.ok(html.includes("Bill number"), "Should render Bill number label");
  assert.ok(html.includes("Supplier"), "Should render Supplier label");
  assert.ok(html.includes("Timber Supplier Ltd"), "Should render supplier contact name");
  assert.ok(html.includes("Hardwood Door Blanks"), "Should render line item description");
  assert.ok(html.includes("Date due"), "Should render Date due label");
  assert.ok(html.includes("Amount due"), "Should render Amount due");
});

test("renderInvoicePdf generates valid PDF buffer with bill labels", async () => {
  const pdfBuffer = await renderInvoicePdf(
    {
      invoiceNumber: sampleBill.documentNumber,
      issueDate: sampleBill.issueDate,
      dueDate: sampleBill.secondDate,
      lines: sampleBill.lines,
      subtotal: sampleBill.subtotal,
      taxTotal: sampleBill.taxTotal,
      taxLabel: sampleBill.taxLabel,
      total: sampleBill.total,
      amountPaid: sampleBill.amountPaid,
      amountDue: sampleBill.amountDue,
      currencyCode: sampleBill.currencyCode,
      reference: sampleBill.reference,
      notes: sampleBill.notes,
    },
    sampleOrg,
    {
      name: sampleBill.contactName,
      email: sampleBill.contactEmail,
      address: sampleBill.contactAddress,
    },
    {},
    {
      title: "Bill",
      numberLabel: "Bill number",
      partyLabel: "Supplier",
      amountLabel: "Amount due",
      taxLabel: sampleBill.taxLabel,
      dateLabel: "Date due",
      summaryNoun: "due",
    }
  );

  assert.ok(pdfBuffer instanceof ArrayBuffer, "Should return an ArrayBuffer");
  assert.ok(pdfBuffer.byteLength > 1000, "PDF buffer should contain valid bytes");
  const bytes = new Uint8Array(pdfBuffer);
  const header = Buffer.from(bytes.subarray(0, 5)).toString("utf-8");
  assert.equal(header, "%PDF-", "PDF buffer should start with %PDF- header");
});
