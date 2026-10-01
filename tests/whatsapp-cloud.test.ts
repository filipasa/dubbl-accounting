import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import {
  verifyWebhookSignature,
  getWhatsAppConfig,
} from "../lib/integrations/whatsapp/client";
import { GET as webhookGetHandler } from "../app/api/v1/integrations/whatsapp/webhook/route";
import { NextRequest } from "next/server";

test("verifyWebhookSignature passes when appSecret is empty", () => {
  const body = JSON.stringify({ hello: "world" });
  assert.equal(verifyWebhookSignature(body, "sha256=abcdef", ""), true);
  assert.equal(verifyWebhookSignature(body, null, undefined), true);
});

test("verifyWebhookSignature correctly validates valid HMAC-SHA256 signature", () => {
  const appSecret = "meta_test_secret_123456";
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "123", changes: [] }],
  });

  const hmac = crypto.createHmac("sha256", appSecret);
  const signature = "sha256=" + hmac.update(body, "utf8").digest("hex");

  assert.equal(verifyWebhookSignature(body, signature, appSecret), true);
});

test("verifyWebhookSignature rejects tampered body or invalid signature", () => {
  const appSecret = "meta_test_secret_123456";
  const body = JSON.stringify({ action: "approve" });

  const hmac = crypto.createHmac("sha256", appSecret);
  const signature = "sha256=" + hmac.update(body, "utf8").digest("hex");

  // Tampered body
  assert.equal(
    verifyWebhookSignature(body + "tampered", signature, appSecret),
    false
  );

  // Wrong secret
  assert.equal(
    verifyWebhookSignature(body, signature, "wrong_secret"),
    false
  );

  // Missing sha256= prefix
  assert.equal(
    verifyWebhookSignature(body, "invalidsignature", appSecret),
    false
  );
});

test("Webhook GET handler successfully verifies Meta challenge handshake", async () => {
  process.env.WHATSAPP_VERIFY_TOKEN = "fixbooks_wa_test_token_99";

  const challenge = "987654321_challenge_code";
  const req = new NextRequest(
    `http://localhost:3000/api/v1/integrations/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=fixbooks_wa_test_token_99&hub.challenge=${challenge}`
  );

  const res = await webhookGetHandler(req);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.equal(text, challenge);
  assert.equal(res.headers.get("content-type"), "text/plain");
});

test("Webhook GET handler rejects invalid verify token with 403", async () => {
  process.env.WHATSAPP_VERIFY_TOKEN = "fixbooks_wa_test_token_99";

  const req = new NextRequest(
    `http://localhost:3000/api/v1/integrations/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=12345`
  );

  const res = await webhookGetHandler(req);
  assert.equal(res.status, 403);
  const text = await res.text();
  assert.match(text, /Forbidden/i);
});

test("getWhatsAppConfig parses environment variables properly", () => {
  process.env.WHATSAPP_PHONE_NUMBER_ID = " 10987654321 ";
  process.env.WHATSAPP_VERIFY_TOKEN = "custom_token_123";
  process.env.WHATSAPP_ALLOWED_NUMBERS = " +44 7950 869980, 447908065832 ";

  const cfg = getWhatsAppConfig();
  assert.equal(cfg.phoneNumberId, "10987654321");
  assert.equal(cfg.verifyToken, "custom_token_123");
  assert.deepEqual(cfg.allowedNumbers, ["447950869980", "447908065832"]);
});
