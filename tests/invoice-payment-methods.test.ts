import { test } from "node:test";
import assert from "node:assert/strict";
import { generateInvoiceHtml } from "../lib/documents/pdf-generator";
import { renderInvoicePdf } from "../lib/documents/pdf-renderer";

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
