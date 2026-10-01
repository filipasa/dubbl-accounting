import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getTelegramConfig,
  getTelegramMe,
  getTelegramWebhookInfo,
} from "@/lib/integrations/telegram/client";
import { db } from "@/lib/db";
import { telegramMessageLog } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = getTelegramConfig();
  const isConfigured = Boolean(config.botToken);

  let botUser = null;
  let webhookInfo = null;

  if (isConfigured) {
    [botUser, webhookInfo] = await Promise.all([
      getTelegramMe(),
      getTelegramWebhookInfo(),
    ]);
  }

  const webhookUrl = `${config.appUrl}/api/v1/integrations/telegram/webhook`;

  // Fetch recent message logs
  let recentLogs: any[] = [];
  try {
    recentLogs = await db
      .select({
        id: telegramMessageLog.id,
        updateId: telegramMessageLog.updateId,
        messageId: telegramMessageLog.messageId,
        chatId: telegramMessageLog.chatId,
        senderUsername: telegramMessageLog.senderUsername,
        senderName: telegramMessageLog.senderName,
        direction: telegramMessageLog.direction,
        messageBody: telegramMessageLog.messageBody,
        status: telegramMessageLog.status,
        errorMessage: telegramMessageLog.errorMessage,
        createdAt: telegramMessageLog.createdAt,
      })
      .from(telegramMessageLog)
      .orderBy(desc(telegramMessageLog.createdAt))
      .limit(20);
  } catch (err) {
    console.warn("[Telegram Status] Failed to fetch message logs:", err);
  }

  return NextResponse.json({
    isConfigured,
    botUser,
    webhookInfo,
    webhookUrl,
    secretToken: config.secretToken,
    allowedUsers: config.allowedUsers,
    hasBotToken: Boolean(config.botToken),
    hasGeminiKey: Boolean(config.geminiApiKey),
    hasOpenAiKey: Boolean(config.openaiApiKey),
    recentLogs,
  });
}
