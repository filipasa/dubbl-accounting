import { NextRequest, NextResponse } from "next/server";
import {
  getWhatsAppConfig,
  verifyWebhookSignature,
} from "@/lib/integrations/whatsapp/client";
import { processIncomingWhatsAppMessage } from "@/lib/integrations/whatsapp/handler";
import type { WhatsAppWebhookPayload } from "@/lib/integrations/whatsapp/types";

/**
 * GET /api/v1/integrations/whatsapp/webhook
 * Handles Meta's webhook verification handshake during setup in Developer Portal.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const config = getWhatsAppConfig();

  if (mode === "subscribe" && token === config.verifyToken) {
    console.log("[WhatsApp Webhook] Verification successful for Meta challenge.");
    return new Response(challenge || "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  console.warn(
    `[WhatsApp Webhook] Verification failed. Received token: "${token}", expected: "${config.verifyToken}"`
  );
  return new Response("Forbidden: Verification token mismatch", { status: 403 });
}

/**
 * POST /api/v1/integrations/whatsapp/webhook
 * Receives incoming WhatsApp messages and notifications from Meta WhatsApp Cloud API.
 */
export async function POST(request: NextRequest) {
  const config = getWhatsAppConfig();

  // Read raw body for HMAC verification
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  // Verify HMAC signature if appSecret is configured
  if (!verifyWebhookSignature(rawBody, signature, config.appSecret)) {
    console.error("[WhatsApp Webhook] Invalid HMAC signature.");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error("[WhatsApp Webhook] Malformed JSON payload:", err);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (payload.object !== "whatsapp_business_account") {
    // Acknowledge non-business account payloads
    return NextResponse.json({ status: "ignored" }, { status: 200 });
  }

  const entries = payload.entry || [];
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value) continue;

      // Process inbound messages
      const messages = value.messages || [];
      for (const msg of messages) {
        const from = msg.from;
        const messageId = msg.id;

        let text = "";
        if (msg.type === "text" && msg.text?.body) {
          text = msg.text.body;
        } else if (msg.type === "interactive") {
          text =
            msg.interactive?.button_reply?.title ||
            msg.interactive?.list_reply?.title ||
            "";
        } else {
          // Unsupported message type (image, audio, document)
          console.log(`[WhatsApp Webhook] Received unsupported message type: ${msg.type}`);
          text = "help";
        }

        if (from && text) {
          try {
            await processIncomingWhatsAppMessage({
              from,
              text,
              messageId,
              rawPayload: msg as unknown as Record<string, unknown>,
            });
          } catch (procErr) {
            console.error(`[WhatsApp Webhook] Error processing message from ${from}:`, procErr);
          }
        }
      }
    }
  }

  // Meta requires a 200 OK response within 20 seconds, otherwise it retries
  return NextResponse.json({ status: "success" }, { status: 200 });
}
