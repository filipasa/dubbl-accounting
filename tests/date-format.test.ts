import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatDate,
  setGlobalDateFormat,
  getGlobalDateFormat,
  DEFAULT_DATE_FORMAT,
} from "../lib/date";

test("formatDate defaults to DD/MM/YYYY", () => {
  setGlobalDateFormat("DD/MM/YYYY");
  assert.equal(formatDate("2026-08-09"), "09/08/2026");
  assert.equal(formatDate("2026-12-31"), "31/12/2026");
});

test("formatDate supports standard presets", () => {
  const d = "2026-08-09";
  assert.equal(formatDate(d, "DD/MM/YYYY"), "09/08/2026");
  assert.equal(formatDate(d, "D MMM YYYY"), "9 Aug 2026");
  assert.equal(formatDate(d, "D MMMM YYYY"), "9 August 2026");
  assert.equal(formatDate(d, "YYYY-MM-DD"), "2026-08-09");
  assert.equal(formatDate(d, "MM/DD/YYYY"), "08/09/2026");
  assert.equal(formatDate(d, "MMM D, YYYY"), "Aug 9, 2026");
});

test("formatDate handles Date objects and UK date strings", () => {
  const dt = new Date(2026, 7, 9); // August 9, 2026
  assert.equal(formatDate(dt, "DD/MM/YYYY"), "09/08/2026");
  assert.equal(formatDate("09/08/2026", "D MMM YYYY"), "9 Aug 2026");
});

test("formatDate handles null/undefined gracefully", () => {
  assert.equal(formatDate(null), "—");
  assert.equal(formatDate(undefined), "—");
  assert.equal(formatDate("", null, "N/A"), "N/A");
});

test("setGlobalDateFormat updates global format", () => {
  setGlobalDateFormat("D MMM YYYY");
  assert.equal(getGlobalDateFormat(), "D MMM YYYY");
  assert.equal(formatDate("2026-08-09"), "9 Aug 2026");
  // Reset back to default
  setGlobalDateFormat(DEFAULT_DATE_FORMAT);
});

test("pdf-generator formats dates using dateFormat", async () => {
  const { generateInvoiceHtml } = await import("../lib/documents/pdf-generator");
  const html = generateInvoiceHtml(
    {
      invoiceNumber: "INV-001",
      issueDate: "2026-08-09",
      dueDate: "2026-09-08",
      dateFormat: "D MMM YYYY",
      status: "sent",
      contactName: "John Doe",
      lines: [
        {
          description: "Widget",
          quantity: 100,
          unitPrice: 1000,
          taxAmount: 200,
          amount: 1000,
        },
      ],
      subtotal: 1000,
      taxTotal: 200,
      total: 1200,
      currencyCode: "GBP",
    },
    { name: "My Business", defaultCurrency: "GBP" } as any,
    {}
  );
  assert.ok(html.includes("9 Aug 2026"));
  assert.ok(html.includes("8 Sep 2026"));
});

