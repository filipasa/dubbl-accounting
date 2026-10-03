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

