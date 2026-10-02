import { test } from "node:test";
import assert from "node:assert/strict";
import { generateInvoiceHtml } from "../lib/documents/pdf-generator";
import { renderInvoicePdf } from "../lib/documents/pdf-renderer";
import { calculateCommercialCardFee } from "../lib/money";

function resolveStripeCheckoutConfig(methods: string[] | null | undefined) {
  if (methods && methods.length === 0) {
    throw new Error("Online payments are not enabled for this invoice");
  }

  const effective = methods && methods.length > 0 ? methods : ["pay_by_bank"];
  const hasPayByBank = effective.includes("pay_by_bank");
  const hasCard = effective.includes("card") || effective.includes("online") || effective.includes("stripe");

  if (!hasPayByBank && !hasCard) {
    throw new Error("No payment methods configured for this invoice");
  }

  const paymentMethodTypes: ("card" | "pay_by_bank")[] = [];
  if (hasCard) paymentMethodTypes.push("card");
  if (hasPayByBank) paymentMethodTypes.push("pay_by_bank");

  return {
    payment_method_types: paymentMethodTypes,
    ...(hasPayByBank ? { payment_method_options: { pay_by_bank: {} } } : {}),
  };
}

test("calculateCommercialCardFee calculates standard Stripe UK commercial card fee (1.9% + 20p)", () => {
  // £100.00 = 10,000 cents -> 10,000 * 0.019 + 20 = 210 (£2.10)
  assert.equal(calculateCommercialCardFee(10000, "GBP"), 210);

  // £500.00 = 50,000 cents -> 50,000 * 0.019 + 20 = 970 (£9.70)
  assert.equal(calculateCommercialCardFee(50000, "GBP"), 970);

  // £1,000.00 = 100,000 cents -> 100,000 * 0.019 + 20 = 1,920 (£19.20)
  assert.equal(calculateCommercialCardFee(100000, "GBP"), 1920);

  // £2,500.00 = 250,000 cents -> 250,000 * 0.019 + 20 = 4,770 (£47.70)
  assert.equal(calculateCommercialCardFee(250000, "GBP"), 4770);

  // Zero or negative amounts
  assert.equal(calculateCommercialCardFee(0, "GBP"), 0);
  assert.equal(calculateCommercialCardFee(-100, "GBP"), 0);
});

test("resolveStripeCheckoutConfig defaults to pay_by_bank when null or undefined", () => {
  const config = resolveStripeCheckoutConfig(undefined);
  assert.deepEqual(config.payment_method_types, ["pay_by_bank"]);
  assert.deepEqual(config.payment_method_options, { pay_by_bank: {} });

  const configNull = resolveStripeCheckoutConfig(null);
  assert.deepEqual(configNull.payment_method_types, ["pay_by_bank"]);
  assert.deepEqual(configNull.payment_method_options, { pay_by_bank: {} });
});

test("resolveStripeCheckoutConfig handles only Pay by Bank", () => {
  const config = resolveStripeCheckoutConfig(["pay_by_bank"]);
  assert.deepEqual(config.payment_method_types, ["pay_by_bank"]);
  assert.deepEqual(config.payment_method_options, { pay_by_bank: {} });
});

test("resolveStripeCheckoutConfig handles only Online payment (card)", () => {
  const config = resolveStripeCheckoutConfig(["card"]);
  assert.deepEqual(config.payment_method_types, ["card"]);
  assert.equal((config as any).payment_method_options, undefined);
});

test("resolveStripeCheckoutConfig handles both Pay by Bank and Online payment", () => {
  const config = resolveStripeCheckoutConfig(["pay_by_bank", "card"]);
  assert.ok(config.payment_method_types.includes("card"));
  assert.ok(config.payment_method_types.includes("pay_by_bank"));
  assert.equal(config.payment_method_types.length, 2);
  assert.deepEqual(config.payment_method_options, { pay_by_bank: {} });
});

test("resolveStripeCheckoutConfig rejects when paymentMethods is empty array []", () => {
  assert.throws(
    () => resolveStripeCheckoutConfig([]),
    /Online payments are not enabled for this invoice/
  );
});

test("PDF generation excludes payment link & QR when paymentUrl is undefined", async () => {
  const sampleOrg = {
    name: "FixBooks Test LTD",
    email: "contact@fixbooks.io",
    countryCode: "GB",
  };

  const sampleInvoice = {
    invoiceNumber: "INV-001",
    issueDate: "2026-10-02",
    dueDate: "2026-10-10",
    status: "draft",
    lines: [
      {
        description: "Consulting",
        quantity: 100,
        unitPrice: 10000,
        taxAmount: 2000,
        amount: 10000,
      },
    ],
    subtotal: 10000,
    taxTotal: 2000,
    total: 12000,
    amountPaid: 0,
    amountDue: 12000,
    currencyCode: "GBP",
  };

  const html = generateInvoiceHtml(
    {
      ...sampleInvoice,
      contactName: "Client A",
      paymentUrl: undefined,
    },
    sampleOrg,
    {}
  );

  assert.ok(!html.includes("Scan to pay:"), "Should not contain 'Scan to pay:' when paymentUrl is undefined");
  assert.ok(!html.includes("Pay Online:"), "Should not contain 'Pay Online:' when paymentUrl is undefined");

  const pdfBuf = await renderInvoicePdf(
    {
      ...sampleInvoice,
      paymentUrl: undefined,
    },
    sampleOrg,
    { name: "Client A" },
    {}
  );
  assert.ok(pdfBuf.byteLength > 1000, "PDF should render successfully without payment link");
});

test("Invoice HTML and PDF render Payment Processing Fee line item correctly", async () => {
  const sampleOrg = {
    name: "FixBooks Test LTD",
    email: "contact@fixbooks.io",
    countryCode: "GB",
  };

  const fee = calculateCommercialCardFee(12000, "GBP"); // 12000 * 0.019 + 20 = 248 (£2.48)
  assert.equal(fee, 248);

  const sampleInvoiceWithFee = {
    invoiceNumber: "INV-002",
    issueDate: "2026-10-02",
    dueDate: "2026-10-10",
    status: "draft",
    lines: [
      {
        description: "Services",
        quantity: 100,
        unitPrice: 10000,
        taxAmount: 2000,
        amount: 10000,
      },
      {
        description: "Payment Processing Fee",
        quantity: 100,
        unitPrice: fee,
        taxAmount: 0,
        amount: fee,
      },
    ],
    subtotal: 10000 + fee,
    taxTotal: 2000,
    total: 12000 + fee,
    amountPaid: 0,
    amountDue: 12000 + fee,
    currencyCode: "GBP",
    paymentUrl: "https://fixbooks.io/pay/testtoken123",
  };

  const html = generateInvoiceHtml(
    {
      ...sampleInvoiceWithFee,
      contactName: "Client B",
    },
    sampleOrg,
    {}
  );

  assert.ok(html.includes("Payment Processing Fee"), "HTML should include 'Payment Processing Fee'");
  assert.ok(html.includes("Scan to pay:"), "HTML should include QR section when paymentUrl is present");

  const pdfBuf = await renderInvoicePdf(
    sampleInvoiceWithFee,
    sampleOrg,
    { name: "Client B" },
    {}
  );
  assert.ok(pdfBuf.byteLength > 1000, "PDF with fee line renders successfully");
});
