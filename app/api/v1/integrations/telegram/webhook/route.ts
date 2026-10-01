import { NextRequest, NextResponse } from "next/server";
import {
  getTelegramConfig,
  verifyTelegramSecretToken,
} from "@/lib/integrations/telegram/client";
import { processIncomingTelegramUpdate } from "@/lib/integrations/telegram/handler";
import type { TelegramUpdate } from "@/lib/integrations/telegram/types";

/**
 * POST /api/v1/integrations/telegram/webhook
 * Receives incoming updates from Telegram Bot API
 */
export async function POST(request: NextRequest) {
  const config = getTelegramConfig();

  // Validate secret token if configured
  const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
  if (!verifyTelegramSecretToken(secretHeader, config.secretToken)) {
    console.warn("[Telegram Webhook] Invalid or missing secret token header.");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = await request.json();
  } catch (err) {
    console.error("[Telegram Webhook] Failed to parse JSON update:", err);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    await processIncomingTelegramUpdate(update);
  } catch (err) {
    console.error("[Telegram Webhook] Error processing update:", err);
  }

  // Telegram expects 200 OK acknowledgment
  return NextResponse.json({ ok: true });
}
