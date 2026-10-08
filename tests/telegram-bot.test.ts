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

  const cfg = getTelegramConfig();
  assert.equal(cfg.botToken, "123456789:ABCdefGHIjklMNO");
  assert.equal(cfg.secretToken, "secret_12345");
  assert.deepEqual(cfg.allowedUsers, ["johndoe", "987654321", "alice"]);
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
});



