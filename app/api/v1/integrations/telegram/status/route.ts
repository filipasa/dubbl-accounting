import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getTelegramConfig,
  getTelegramMe,
  getTelegramWebhookInfo,
  setTelegramWebhook,
} from "@/lib/integrations/telegram/client";
import { db } from "@/lib/db";
import { telegramMessageLog, botConversationLink } from "@/lib/db/schema";
import { desc, eq, and } from "drizzle-orm";

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
  let autoSynced = false;

  // Silent self-healing: automatically register/update webhook if missing or mismatched
  if (isConfigured && (!webhookInfo?.url || webhookInfo.url !== webhookUrl)) {
    try {
      const syncResult = await setTelegramWebhook({
        url: webhookUrl,
        secretToken: config.secretToken,
      });
      if (syncResult.ok) {
        autoSynced = true;
        webhookInfo = await getTelegramWebhookInfo();
        console.log(`[Telegram Auto-Sync] Automatically synced webhook to: ${webhookUrl}`);
      }
    } catch (syncErr) {
      console.warn("[Telegram Auto-Sync] Failed to auto-register webhook:", syncErr);
    }
  }

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

  // Fetch current user's personal Telegram link
  let userLink: {
    id: string;
    chatId: string;
    username: string | null;
    displayName: string | null;
    createdAt: Date;
  } | null = null;
  try {
    const link = await db.query.botConversationLink.findFirst({
      where: and(
        eq(botConversationLink.platform, "telegram"),
        eq(botConversationLink.userId, session.user.id)
      ),
    });
    if (link) {
      userLink = {
        id: link.id,
        chatId: link.chatId,
        username: link.platformUsername,
        displayName: link.displayName,
        createdAt: link.createdAt,
      };
    }
  } catch (err) {
    console.warn("[Telegram Status] Failed to fetch user link:", err);
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
    autoSynced,
    userLink,
    recentLogs,
  });
}
