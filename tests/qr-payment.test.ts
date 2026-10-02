import { test } from "node:test";
import assert from "node:assert/strict";
import { generateQrCodePngBuffer, generateQrCodePngDataUri } from "../lib/documents/qr-code";
import { generateInvoiceHtml } from "../lib/documents/pdf-generator";
import { renderInvoicePdf } from "../lib/documents/pdf-renderer";

const sampleOrg = {
  name: "Zamos Construction LTD",
  address: "25 Sandover, Northampton, NN4 0TS, United Kingdom",
  email: "zamos.construction@gmail.com",
  phone: "07469457949",
  countryCode: "GB",
};

const sampleInvoice = {
  invoiceNumber: "INV-146233",
  issueDate: "2026-08-09",
  dueDate: "2026-08-09",
  status: "sent",
  contactName: "ILIE Sula",
  contactEmail: "zamos.construction@gmail.com",
  contactAddress: "25 Sandover, Northampton, NN4 0TS",
  lines: [
    {
      description: "Concealed Omega Primed Door Set - 686x1981",
      quantity: 100,
      unitPrice: 48750,
      taxAmount: 9750,
      amount: 48750,
    },
    {
      description: "Shipping",
      quantity: 100,
      unitPrice: 8333,
      taxAmount: 1667,
      amount: 8333,
    },
  ],
  subtotal: 57083,
  taxTotal: 11417,
  taxLabel: "VAT (20%)",
  total: 68500,
  amountPaid: 0,
  amountDue: 68500,
  currencyCode: "GBP",
};

test("generateQrCodePngBuffer generates valid PNG with magic signature", () => {
  const url = "https://www.fixbooks.io/pay/test123456789";
  const buf = generateQrCodePngBuffer(url);

  assert.ok(buf instanceof Buffer, "Should return a Buffer");
  assert.ok(buf.length > 100, "PNG buffer should be non-empty");

  // PNG magic number: 89 50 4E 47 0D 0A 1A 0A
  const expectedMagic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual(buf.subarray(0, 8), expectedMagic, "Must have PNG signature");
});

test("generateQrCodePngDataUri produces valid data:image/png;base64 URI", () => {
  const url = "https://www.fixbooks.io/pay/test123456789";
  const uri = generateQrCodePngDataUri(url);

  assert.ok(uri.startsWith("data:image/png;base64,"), "Must start with data:image/png;base64,");
  const base64Data = uri.replace("data:image/png;base64,", "");
  const buf = Buffer.from(base64Data, "base64");
  const expectedMagic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual(buf.subarray(0, 8), expectedMagic, "Decoded base64 must be a valid PNG");
});

test("generateInvoiceHtml displays 'Scan to pay:' and 'Pay Online:' when paymentUrl is present and amountDue > 0", () => {
  const paymentUrl = "https://www.fixbooks.io/pay/token-146233";
  const html = generateInvoiceHtml(
    {
      ...sampleInvoice,
      paymentUrl,
    },
    sampleOrg,
    {}
  );

  assert.ok(html.includes("Scan to pay:"), "HTML should include 'Scan to pay:' header");
  assert.ok(html.includes('alt="Scan to pay QR code"'), "HTML should include QR code image");
  assert.ok(html.includes("Pay Online:"), "HTML should include 'Pay Online:'");
  assert.ok(html.includes(`href="${paymentUrl}"`), "HTML should include clickable link to paymentUrl");
});

test("generateInvoiceHtml omits 'Scan to pay:' when invoice is fully paid (amountDue = 0)", () => {
  const paymentUrl = "https://www.fixbooks.io/pay/token-146233";
  const html = generateInvoiceHtml(
    {
      ...sampleInvoice,
      amountDue: 0,
      paymentUrl,
    },
    sampleOrg,
    {}
  );

  assert.ok(!html.includes("Scan to pay:"), "HTML should NOT include 'Scan to pay:' when paid");
  assert.ok(!html.includes('alt="Scan to pay QR code"'), "HTML should NOT include QR code when paid");
});

test("renderInvoicePdf generates PDF ArrayBuffer with QR code successfully", async () => {
  const paymentUrl = "https://www.fixbooks.io/pay/token-146233";
  const pdfBuffer = await renderInvoicePdf(
    {
      ...sampleInvoice,
      paymentUrl,
    },
    sampleOrg,
    {
      name: sampleInvoice.contactName,
      email: sampleInvoice.contactEmail,
      address: sampleInvoice.contactAddress,
    },
    {}
  );

  assert.ok(pdfBuffer instanceof ArrayBuffer, "Should return an ArrayBuffer");
  assert.ok(pdfBuffer.byteLength > 1000, "PDF buffer should be non-trivial");

  // Check PDF magic signature: %PDF-
  const header = Buffer.from(pdfBuffer).subarray(0, 5).toString("ascii");
  assert.equal(header, "%PDF-", "Generated buffer must have PDF magic signature");
});

test("authConfig allows /pay and /api/pay as public routes without login", async () => {
  const { authConfig } = await import("../lib/auth.config");
  const authorized = authConfig.callbacks?.authorized;
  assert.ok(typeof authorized === "function", "authorized callback must be defined");

  // Simulate unauthenticated request to /pay/token123
  const unauthPayReq = {
    auth: null,
    request: {
      nextUrl: new URL("https://www.fixbooks.io/pay/token123"),
      headers: new Headers(),
    },
  };
  const isPayAllowed = authorized(unauthPayReq as any);
  assert.equal(isPayAllowed, true, "Unauthenticated user should be allowed to access /pay/[token]");

  // Simulate unauthenticated request to /api/pay/token123
  const unauthApiPayReq = {
    auth: null,
    request: {
      nextUrl: new URL("https://www.fixbooks.io/api/pay/token123"),
      headers: new Headers(),
    },
  };
  const isApiPayAllowed = authorized(unauthApiPayReq as any);
  assert.equal(isApiPayAllowed, true, "Unauthenticated user should be allowed to access /api/pay/[token]");
});

