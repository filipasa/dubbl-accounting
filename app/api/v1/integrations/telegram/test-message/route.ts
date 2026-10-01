import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sendTelegramMessage } from "@/lib/integrations/telegram/client";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { chatId?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { chatId, message } = body;
  if (!chatId) {
    return NextResponse.json(
      { error: "Chat ID is required (e.g. 123456789 or @username for channels)" },
      { status: 400 }
    );
  }

  const testText =
    message ||
    "👋 <b>Hello from Fixbooks!</b>\n\nYour Telegram Bot integration is connected and working! You can now send bookkeeping commands like <code>/help</code>, <code>/quotes</code>, <code>/invoices</code>, or text in natural language to manage your accounts.";

  try {
    const result = await sendTelegramMessage({
      chatId,
      text: testText,
      parseMode: "HTML",
    });

    return NextResponse.json({
      success: true,
      messageId: result.result?.message_id,
      chatId: result.result?.chat?.id,
    });
  } catch (err: any) {
    console.error("[Telegram Test Message] Failed:", err);
    let errorMessage = err.message || "Failed to send test Telegram message";
    if (
      errorMessage.includes("Forbidden") ||
      errorMessage.includes("can't initiate conversation") ||
      errorMessage.includes("bot can't initiate")
    ) {
      errorMessage =
        "Telegram Privacy Restriction: Bots cannot initiate conversations with users. Please open Telegram, search for your bot, and tap 'Start' (or send /start). Then try sending this test message again.";
    }
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
