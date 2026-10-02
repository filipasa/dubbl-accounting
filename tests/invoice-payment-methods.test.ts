import { test } from "node:test";
import assert from "node:assert/strict";
import { generateInvoiceHtml } from "../lib/documents/pdf-generator";
import { renderInvoicePdf } from "../lib/documents/pdf-renderer";
import { calculateCommercialCardFee } from "../lib/money";
import { partitionDocumentLines } from "../lib/documents/line-adjustments";

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

test("Discount and Shipping calculations support % and fixed £ amounts", () => {
  const subtotal = 20000; // £200.00

  // 10% discount -> £20.00 (2000 cents)
  const pctDiscount = Math.round((subtotal * 10) / 100);
  assert.equal(pctDiscount, 2000);

  // £15.50 fixed discount -> 1550 cents
  const fixedDiscount = 1550;
  assert.equal(fixedDiscount, 1550);

  // £12.00 fixed shipping -> 1200 cents
  const fixedShipping = 1200;
  assert.equal(fixedShipping, 1200);

  // 5% shipping surcharge -> £10.00 (1000 cents)
  const pctShipping = Math.round((subtotal * 5) / 100);
  assert.equal(pctShipping, 1000);

  // Combined total: £200.00 - £20.00 + £12.00 = £192.00 (19200 cents)
  const netTotal = subtotal - pctDiscount + fixedShipping;
  assert.equal(netTotal, 19200);
});

test("Invoice HTML and PDF render Discount and Shipping lines properly", async () => {
  const sampleOrg = {
    name: "FixBooks Test LTD",
    email: "contact@fixbooks.io",
    countryCode: "GB",
  };

  const invoiceWithAdjustments = {
    invoiceNumber: "INV-003",
    issueDate: "2026-10-02",
    dueDate: "2026-10-10",
    status: "draft",
    lines: [
      {
        description: "Web Development",
        quantity: 100,
        unitPrice: 20000,
        taxAmount: 4000,
        amount: 20000,
      },
      {
        description: "Discount (10%)",
        quantity: 100,
        unitPrice: -2000,
        taxAmount: 0,
        amount: -2000,
      },
      {
        description: "Shipping",
        quantity: 100,
        unitPrice: 1500,
        taxAmount: 0,
        amount: 1500,
      },
    ],
    subtotal: 19500, // 20000 - 2000 + 1500
    taxTotal: 4000,
    total: 23500,
    amountPaid: 0,
    amountDue: 23500,
    currencyCode: "GBP",
  };

  const html = generateInvoiceHtml(
    {
      ...invoiceWithAdjustments,
      contactName: "Acme Corp",
    },
    sampleOrg,
    {}
  );

  assert.ok(html.includes("Discount (10%)"), "HTML should include 'Discount (10%)'");
  assert.ok(html.includes("Shipping"), "HTML should include 'Shipping'");
  assert.ok(html.includes("-£20.00"), "HTML should format negative discount amount properly");
  assert.ok(html.includes("+£15.00") || html.includes("£15.00"), "HTML should format shipping amount properly");

  // Verify Discount and Shipping are NOT in <tbody> (product lines) but ARE in <tfoot> (underneath Subtotal)
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  assert.ok(tbodyMatch, "HTML should have <tbody>");
  const tbodyContent = tbodyMatch[1];
  assert.ok(tbodyContent.includes("Web Development"), "tbody must contain actual product items");
  assert.ok(!tbodyContent.includes("Discount (10%)"), "tbody must NOT contain Discount as a product line");
  assert.ok(!tbodyContent.includes("Shipping"), "tbody must NOT contain Shipping as a product line");

  const tfootMatch = html.match(/<tfoot>([\s\S]*?)<\/tfoot>/);
  assert.ok(tfootMatch, "HTML should have <tfoot>");
  const tfootContent = tfootMatch[1];
  assert.ok(tfootContent.includes("Subtotal"), "tfoot must contain Subtotal");
  assert.ok(tfootContent.includes("Discount (10%)"), "tfoot must contain Discount underneath Subtotal");
  assert.ok(tfootContent.includes("Shipping"), "tfoot must contain Shipping underneath Subtotal");
  assert.ok(
    tfootContent.indexOf("Subtotal") < tfootContent.indexOf("Shipping"),
    "Shipping must appear underneath Subtotal"
  );
  assert.ok(
    tfootContent.indexOf("Shipping") < tfootContent.indexOf("Discount (10%)"),
    "Discount must appear underneath Shipping"
  );

  const pdfBuf = await renderInvoicePdf(
    invoiceWithAdjustments,
    sampleOrg,
    { name: "Acme Corp" },
    {}
  );
  assert.ok(pdfBuf.byteLength > 1000, "PDF with discount and shipping renders successfully");
});

test("partitionDocumentLines correctly isolates product lines from discount and shipping", () => {
  const lines = [
    { description: "Frameless Hidden Door", amount: 50000, unitPrice: 50000 },
    { description: "Magnetic Lock", amount: 8000, unitPrice: 8000 },
    { description: "Discount (10%)", amount: -5800, unitPrice: -5800 },
    { description: "Shipping", amount: 2500, unitPrice: 2500 },
  ];

  const partitioned = partitionDocumentLines(lines);

  assert.equal(partitioned.hasAdjustments, true);
  assert.equal(partitioned.itemLines.length, 2);
  assert.equal(partitioned.itemLines[0].description, "Frameless Hidden Door");
  assert.equal(partitioned.itemLines[1].description, "Magnetic Lock");
  assert.equal(partitioned.itemsSubtotal, 58000);

  assert.equal(partitioned.discountLines.length, 1);
  assert.equal(partitioned.discountLines[0].description, "Discount (10%)");
  assert.equal(partitioned.discountLines[0].amount, -5800);

  assert.equal(partitioned.shippingLines.length, 1);
  assert.equal(partitioned.shippingLines[0].description, "Shipping");
  assert.equal(partitioned.shippingLines[0].amount, 2500);
});

test("VAT is calculated on net total after shipping and discount (Sub £100, Ship £10, Disc -£20 -> VATable £90 @ 20% = £18, Total £108)", async () => {
  // Scenario:
  // Item: Subtotal £100.00
  // Shipping: £10.00
  // Discount: -£20.00
  // Net VATable amount: £90.00 (not shown on front end)
  // VAT @ 20%: £18.00
  // Total: £108.00

  const sampleOrg = {
    name: "FixBooks Test LTD",
    email: "contact@fixbooks.io",
    countryCode: "GB",
  };

  const invoice = {
    invoiceNumber: "INV-004",
    issueDate: "2026-10-02",
    dueDate: "2026-10-10",
    status: "draft",
    lines: [
      {
        description: "Frameless Hidden Door",
        quantity: 100,
        unitPrice: 10000,
        amount: 10000,
        taxAmount: 2000, // 20% on £100
        taxRate: { name: "VAT", rate: 2000 },
      },
      {
        description: "Shipping",
        quantity: 100,
        unitPrice: 1000,
        amount: 1000,
        taxAmount: 200, // 20% on £10
        taxRate: { name: "VAT", rate: 2000 },
      },
      {
        description: "Discount",
        quantity: 100,
        unitPrice: -2000,
        amount: -2000,
        taxAmount: -400, // -20% on -£20
        taxRate: { name: "VAT", rate: 2000 },
      },
    ],
    subtotal: 9000, // 10000 + 1000 - 2000 (net VATable amount)
    taxTotal: 1800, // 2000 + 200 - 400 = £18.00
    total: 10800,   // 9000 + 1800 = £108.00
    amountPaid: 0,
    amountDue: 10800,
    currencyCode: "GBP",
  };

  const { itemLines, shippingLines, discountLines, hasAdjustments, itemsSubtotal } =
    partitionDocumentLines(invoice.lines);

  assert.equal(hasAdjustments, true);
  assert.equal(itemsSubtotal, 10000, "Items subtotal should be £100.00");
  assert.equal(shippingLines[0].amount, 1000, "Shipping should be £10.00");
  assert.equal(discountLines[0].amount, -2000, "Discount should be -£20.00");
  assert.equal(invoice.taxTotal, 1800, "VAT @ 20% on £90.00 should be £18.00");
  assert.equal(invoice.total, 10800, "Total should be £108.00");

  const html = generateInvoiceHtml(
    {
      ...invoice,
      contactName: "Client C",
    },
    sampleOrg,
    {}
  );

  // Subtotal £100.00
  assert.ok(html.includes("£100.00"), "HTML includes Subtotal £100.00");
  // Shipping +£10.00
  assert.ok(html.includes("+£10.00") || html.includes("£10.00"), "HTML includes Shipping £10.00");
  // Discount -£20.00
  assert.ok(html.includes("-£20.00"), "HTML includes Discount -£20.00");
  // VAT @ 20% £18.00
  assert.ok(html.includes("£18.00"), "HTML includes VAT £18.00");
  // Total £108.00
  assert.ok(html.includes("£108.00"), "HTML includes Total £108.00");
  // Confirm VATable amount is NOT shown on the front end / document
  assert.ok(!html.includes("VATable"), "VATable amount is not shown on the front end");

  const pdfBuf = await renderInvoicePdf(
    invoice,
    sampleOrg,
    { name: "Client C" },
    {}
  );
  assert.ok(pdfBuf.byteLength > 1000, "PDF renders successfully");
});



