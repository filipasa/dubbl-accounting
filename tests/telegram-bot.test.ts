import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verifyTelegramSecretToken,
  getTelegramConfig,
} from "../lib/integrations/telegram/client";
import { POST as webhookPostHandler } from "../app/api/v1/integrations/telegram/webhook/route";
import { NextRequest } from "next/server";

test("verifyTelegramSecretToken passes when secret is empty", () => {
  assert.equal(verifyTelegramSecretToken("any_token", ""), true);
  assert.equal(verifyTelegramSecretToken(null, ""), true);
});

test("verifyTelegramSecretToken validates matching secret token", () => {
  const secret = "my_custom_telegram_secret_9988";
  assert.equal(verifyTelegramSecretToken(secret, secret), true);
});

test("verifyTelegramSecretToken rejects mismatched or missing secret token", () => {
  const secret = "my_custom_telegram_secret_9988";
  assert.equal(verifyTelegramSecretToken("wrong_token", secret), false);
  assert.equal(verifyTelegramSecretToken(null, secret), false);
  assert.equal(verifyTelegramSecretToken("", secret), false);
});

test("getTelegramConfig parses and normalizes environment variables", () => {
  process.env.TELEGRAM_BOT_TOKEN = "123456789:ABCdefGHIjklMNO";
  process.env.TELEGRAM_SECRET_TOKEN = "secret_12345";
  process.env.TELEGRAM_ALLOWED_USERS = " @JohnDoe, 987654321, @Alice ";
  process.env.NEXT_PUBLIC_APP_URL = "https://dubbl-accounting.vercel.app";

  const cfg = getTelegramConfig();
  assert.equal(cfg.botToken, "123456789:ABCdefGHIjklMNO");
  assert.equal(cfg.secretToken, "secret_12345");
  assert.deepEqual(cfg.allowedUsers, ["johndoe", "987654321", "alice"]);
  assert.equal(cfg.appUrl, "https://fixbooks.io");

  // Also verify www.fixbooks.io normalizes to https://fixbooks.io
  process.env.NEXT_PUBLIC_APP_URL = "https://www.fixbooks.io";
  const cfg2 = getTelegramConfig();
  assert.equal(cfg2.appUrl, "https://fixbooks.io");
});

test("Webhook POST handler rejects unauthorized request without matching secret token", async () => {
  process.env.TELEGRAM_SECRET_TOKEN = "test_webhook_secret_abc";

  const req = new NextRequest("http://localhost:3000/api/v1/integrations/telegram/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-telegram-bot-api-secret-token": "wrong_secret",
    },
    body: JSON.stringify({ update_id: 1001, message: { text: "/help" } }),
  });

  const res = await webhookPostHandler(req);
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.error, "Unauthorized");
});

test("handleTelegramCommand renders help with send and edit capabilities", async () => {
  const { handleTelegramCommand } = await import("../lib/integrations/telegram/handler");
  const dummyCtx = { userId: "test-user", organizationId: "test-org", role: "owner" as const };

  const help = await handleTelegramCommand(dummyCtx, "/help");
  assert.ok(help.includes("/sendinvoice"), "Help includes /sendinvoice");
  assert.ok(help.includes("/sendquote"), "Help includes /sendquote");
  assert.ok(help.includes("Edit invoice"), "Help includes edit invoice example");
  assert.ok(help.includes("Edit quote"), "Help includes edit quote example");
});

test("handleTelegramCommand /sendinvoice and /sendquote validate required parameters", async () => {
  const { handleTelegramCommand } = await import("../lib/integrations/telegram/handler");
  const dummyCtx = { userId: "test-user", organizationId: "test-org", role: "owner" as const };

  const sendInvUsage = await handleTelegramCommand(dummyCtx, "/sendinvoice");
  assert.ok(sendInvUsage.includes("Usage:"), "Should return usage for /sendinvoice without arguments");

  const sendQuoteUsage = await handleTelegramCommand(dummyCtx, "/sendquote");
  assert.ok(sendQuoteUsage.includes("Usage:"), "Should return usage for /sendquote without arguments");
});

test("handleTelegramCommand renders help with bank reconciliation commands", async () => {
  const { handleTelegramCommand } = await import("../lib/integrations/telegram/handler");
  const dummyCtx = { userId: "test-user", organizationId: "test-org", role: "owner" as const };

  const help = await handleTelegramCommand(dummyCtx, "/help");
  assert.ok(help.includes("/reconcile"), "Help includes /reconcile");
  assert.ok(help.includes("/reconcile report"), "Help includes /reconcile report");
  assert.ok(help.includes("Reconcile transaction"), "Help includes reconcile transaction example");
  assert.ok(help.includes("Categorize transaction"), "Help includes categorize transaction example");
});

test("handleTelegramCommand renders help with bill commands", async () => {
  const { handleTelegramCommand } = await import("../lib/integrations/telegram/handler");
  const dummyCtx = { userId: "test-user", organizationId: "test-org", role: "owner" as const };

  const help = await handleTelegramCommand(dummyCtx, "/help");
  assert.ok(help.includes("/bills"), "Help includes /bills");
  assert.ok(help.includes("/bill"), "Help includes /bill");
  assert.ok(help.includes("Screwfix"), "Help includes bill example");
});

test("handleTelegramCommand /bill validates usage and arguments", async () => {
  const { handleTelegramCommand } = await import("../lib/integrations/telegram/handler");
  const dummyCtx = { userId: "test-user", organizationId: "test-org", role: "owner" as const };

  const billUsage = await handleTelegramCommand(dummyCtx, "/bill");
  assert.ok(billUsage.includes("Usage:"), "Should return usage for /bill without arguments");

  const invalidSegments = await handleTelegramCommand(dummyCtx, "/bill ScrewfixOnly");
  assert.ok(invalidSegments.includes("Please separate"), "Should prompt for comma-separated arguments");

  const invalidAmount = await handleTelegramCommand(dummyCtx, "/bill Screwfix, abc, Tools");
  assert.ok(invalidAmount.includes("Invalid amount"), "Should reject non-numeric amount");
});

test("handleTelegramCommand renders help with quote creation and link commands", async () => {
  const { handleTelegramCommand } = await import("../lib/integrations/telegram/handler");
  const dummyCtx = { userId: "test-user", organizationId: "test-org", role: "owner" as const };

  const help = await handleTelegramCommand(dummyCtx, "/help");
  assert.ok(help.includes("/quotes"), "Help includes /quotes");
  assert.ok(help.includes("/quote"), "Help includes /quote");
  assert.ok(help.includes("/quotelink"), "Help includes /quotelink");
  assert.ok(help.includes("Frameless Door"), "Help includes quote example");
});

test("handleTelegramCommand /quote and /quotelink validate usage and arguments", async () => {
  const { handleTelegramCommand } = await import("../lib/integrations/telegram/handler");
  const dummyCtx = { userId: "test-user", organizationId: "test-org", role: "owner" as const };

  const quoteUsage = await handleTelegramCommand(dummyCtx, "/quote");
  assert.ok(quoteUsage.includes("Quote Commands:"), "Should return usage for /quote without arguments");
  assert.ok(quoteUsage.includes("&lt;Customer&gt;"), "Should explain create quote format");
  assert.ok(quoteUsage.includes("/quotelink"), "Should explain quote link format");

  const quoteLinkUsage = await handleTelegramCommand(dummyCtx, "/quotelink");
  assert.ok(quoteLinkUsage.includes("Usage:"), "Should return usage for /quotelink without arguments");

  const invalidSegments = await handleTelegramCommand(dummyCtx, "/quote John Doe,");
  assert.ok(invalidSegments.includes("Please separate"), "Should prompt for comma-separated arguments");

  const invalidAmount = await handleTelegramCommand(dummyCtx, "/quote John Doe, notanumber, Door");
  assert.ok(invalidAmount.includes("Invalid amount"), "Should reject non-numeric amount");
});

test("create_quote and create_invoice tool definitions include shortDescription and shipping", async () => {
  // Read handler file content to verify schema integrity
  const fs = await import("fs");
  const path = await import("path");
  const handlerContent = fs.readFileSync(path.join(process.cwd(), "lib/integrations/telegram/handler.ts"), "utf-8");

  assert.ok(handlerContent.includes('"create_quote"'), "Contains create_quote tool");
  assert.ok(handlerContent.includes('"create_invoice"'), "Contains create_invoice tool");
  assert.ok(handlerContent.includes("shortDescription:"), "Contains shortDescription in line items");
  assert.ok(handlerContent.includes("shipping:"), "Contains shipping parameter in tool schema");
  assert.ok(handlerContent.includes("PRODUCT NAME vs SHORT DESCRIPTION"), "Contains prompt instructions for product name and short description separation");
  assert.ok(handlerContent.includes("QUOTE & INVOICE LINKS & PDF DOWNLOADS"), "Contains prompt instructions for quote links");
  assert.ok(handlerContent.includes("SENDING INVOICES & QUOTES TO CUSTOMER EMAIL"), "Contains prompt instructions for quote sending");
  assert.ok(handlerContent.includes("CONVERSATION CONTEXT & MULTI-TURN MEMORY"), "Contains prompt instructions for multi-turn memory");
  assert.ok(handlerContent.includes("INVENTORY PRODUCT MATCHING & CATALOG CREATION"), "Contains prompt instructions for inventory matching and catalog creation");
  assert.ok(handlerContent.includes("Matched existing catalog product"), "Contains prompt instructions for reporting matched catalog product");
});

test("findInvoiceByNumber, findQuoteByNumber, and findBillByNumber safely handle document numbers without Postgres UUID errors", async () => {
  const { findInvoiceByNumber, findQuoteByNumber, findBillByNumber } = await import(
    "../lib/integrations/whatsapp/executor"
  );
  const dummyCtx = { userId: "test-user", organizationId: "00000000-0000-0000-0000-000000000001", role: "owner" as const };

  const quoteResult = await findQuoteByNumber(dummyCtx, "QTE-00008");
  assert.strictEqual(quoteResult, null, "Should safely return null when quote not found in dummy org without throwing UUID error");

  const invResult = await findInvoiceByNumber(dummyCtx, "INV-00017");
  assert.strictEqual(invResult, null, "Should safely return null when invoice not found in dummy org without throwing UUID error");

  const billResult = await findBillByNumber(dummyCtx, "BILL-00001");
  assert.strictEqual(billResult, null, "Should safely return null when bill not found in dummy org without throwing UUID error");
});

test("sanitizePortalUrls strips hallucinated /api and /api/v1 prefix from customer portal URLs while keeping PDF links intact", async () => {
  const { sanitizePortalUrls } = await import(
    "../lib/integrations/whatsapp/executor"
  );

  const quotePortal = "https://fixbooks.io/api/v1/portal/207b05089bc83c7ad3ba0986bf8eea4d28f0943f46ebf84070ce563d4620cb5b/quotes";
  assert.strictEqual(
    sanitizePortalUrls(quotePortal),
    "https://fixbooks.io/portal/207b05089bc83c7ad3ba0986bf8eea4d28f0943f46ebf84070ce563d4620cb5b/quotes"
  );

  const quotePortalOldApi = "https://fixbooks.io/api/portal/token-abc-123/quotes";
  assert.strictEqual(
    sanitizePortalUrls(quotePortalOldApi),
    "https://fixbooks.io/portal/token-abc-123/quotes"
  );

  const invoicePortal = "https://fixbooks.io/api/v1/portal/token-abc-123/invoices";
  assert.strictEqual(
    sanitizePortalUrls(invoicePortal),
    "https://fixbooks.io/portal/token-abc-123/invoices"
  );

  const rootPortal = "https://fixbooks.io/api/v1/portal/token-abc-123";
  assert.strictEqual(
    sanitizePortalUrls(rootPortal),
    "https://fixbooks.io/portal/token-abc-123"
  );

  const htmlMsg = `<a href="https://fixbooks.io/api/v1/portal/token123/quotes">Customer Portal Link</a>`;
  assert.strictEqual(
    sanitizePortalUrls(htmlMsg),
    `<a href="https://fixbooks.io/portal/token123/quotes">Customer Portal Link</a>`
  );

  // PDF download links should NOT be modified
  const quotePdf = "https://fixbooks.io/api/v1/portal/207b05089bc83c7ad3ba0986bf8eea4d28f0943f46ebf84070ce563d4620cb5b/quotes/c8144081-ce03-4f1a-b337-ad1e905d45d9/pdf";
  assert.strictEqual(
    sanitizePortalUrls(quotePdf),
    quotePdf
  );

  const invoicePdf = "https://fixbooks.io/api/portal/token-abc-123/invoices/inv-123/pdf";
  assert.strictEqual(
    sanitizePortalUrls(invoicePdf),
    invoicePdf
  );

  const statementPdf = "https://fixbooks.io/api/portal/token-abc-123/statements/pdf";
  assert.strictEqual(
    sanitizePortalUrls(statementPdf),
    statementPdf
  );
});

test("parseDiscountAdjustment parses percentage and fixed discounts correctly", async () => {
  const { parseDiscountAdjustment } = await import(
    "../lib/integrations/whatsapp/executor"
  );

  // 5% of £568.33 (56833 cents)
  const d1 = parseDiscountAdjustment("5%", 56833);
  assert.notStrictEqual(d1, null);
  assert.strictEqual(d1?.description, "Discount (5%)");
  assert.strictEqual(d1?.amountCents, 2842);
  assert.strictEqual(d1?.amountPounds, 28.42);

  // 10% of 10000 cents (£100.00)
  const d2 = parseDiscountAdjustment("10%", 10000);
  assert.notStrictEqual(d2, null);
  assert.strictEqual(d2?.description, "Discount (10%)");
  assert.strictEqual(d2?.amountCents, 1000);
  assert.strictEqual(d2?.amountPounds, 10);

  // String with words like "5% discount"
  const d3 = parseDiscountAdjustment("5% discount", 56833);
  assert.notStrictEqual(d3, null);
  assert.strictEqual(d3?.description, "Discount (5%)");
  assert.strictEqual(d3?.amountCents, 2842);

  // Fixed amount "£25"
  const d4 = parseDiscountAdjustment("£25", 56833);
  assert.notStrictEqual(d4, null);
  assert.strictEqual(d4?.description, "Discount");
  assert.strictEqual(d4?.amountCents, 2500);
  assert.strictEqual(d4?.amountPounds, 25);

  // Fixed amount number
  const d5 = parseDiscountAdjustment(50, 56833);
  assert.notStrictEqual(d5, null);
  assert.strictEqual(d5?.description, "Discount");
  assert.strictEqual(d5?.amountCents, 5000);
  assert.strictEqual(d5?.amountPounds, 50);

  // Invalid or zero
  assert.strictEqual(parseDiscountAdjustment(null, 56833), null);
  assert.strictEqual(parseDiscountAdjustment(undefined, 56833), null);
  assert.strictEqual(parseDiscountAdjustment("0%", 56833), null);
  assert.strictEqual(parseDiscountAdjustment(0, 56833), null);
});





