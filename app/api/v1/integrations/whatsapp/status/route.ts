import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getWhatsAppConfig } from "@/lib/integrations/whatsapp/client";
import { db } from "@/lib/db";
import { whatsappMessageLog } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = getWhatsAppConfig();
  const isConfigured = Boolean(config.accessToken && config.phoneNumberId);

  const webhookUrl = `${config.appUrl}/api/v1/integrations/whatsapp/webhook`;

  // Fetch recent message logs
  let recentLogs: any[] = [];
  try {
    recentLogs = await db
      .select({
        id: whatsappMessageLog.id,
        messageId: whatsappMessageLog.messageId,
        senderPhone: whatsappMessageLog.senderPhone,
        recipientPhone: whatsappMessageLog.recipientPhone,
        direction: whatsappMessageLog.direction,
        messageBody: whatsappMessageLog.messageBody,
        status: whatsappMessageLog.status,
        errorMessage: whatsappMessageLog.errorMessage,
        createdAt: whatsappMessageLog.createdAt,
      })
      .from(whatsappMessageLog)
      .orderBy(desc(whatsappMessageLog.createdAt))
      .limit(20);
  } catch (err) {
    console.warn("[WhatsApp Status] Failed to fetch message logs:", err);
  }

  return NextResponse.json({
    isConfigured,
    phoneNumberId: config.phoneNumberId ? `${config.phoneNumberId.slice(0, 4)}••••${config.phoneNumberId.slice(-4)}` : null,
    verifyToken: config.verifyToken,
    webhookUrl,
    allowedNumbers: config.allowedNumbers,
    hasAccessToken: Boolean(config.accessToken),
    hasPhoneNumberId: Boolean(config.phoneNumberId),
    hasAppSecret: Boolean(config.appSecret),
    hasGeminiKey: Boolean(config.geminiApiKey),
    hasOpenAiKey: Boolean(config.openaiApiKey),
    recentLogs,
  });
}
