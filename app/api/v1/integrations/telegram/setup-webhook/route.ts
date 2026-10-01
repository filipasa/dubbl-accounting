import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getTelegramConfig,
  setTelegramWebhook,
} from "@/lib/integrations/telegram/client";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = getTelegramConfig();
  if (!config.botToken) {
    return NextResponse.json(
      { error: "TELEGRAM_BOT_TOKEN is not configured." },
      { status: 400 }
    );
  }

  let body: { webhookUrl?: string; secretToken?: string } = {};
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    body = {};
  }

  const targetUrl =
    body.webhookUrl || `${config.appUrl}/api/v1/integrations/telegram/webhook`;
  const secretToken = body.secretToken || config.secretToken;

  try {
    const result = await setTelegramWebhook({
      url: targetUrl,
      secretToken,
    });

    if (!result.ok) {
      throw new Error(result.description || "Telegram API rejected webhook registration.");
    }

    return NextResponse.json({
      success: true,
      url: targetUrl,
      result,
    });
  } catch (err: any) {
    console.error("[Telegram Setup Webhook] Error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to set Telegram webhook" },
      { status: 500 }
    );
  }
}
