import crypto from "crypto";
import type {
  TelegramConfig,
  TelegramSendMessageResult,
  TelegramWebhookInfo,
  TelegramUser,
} from "./types";

export function getTelegramConfig(): TelegramConfig {
  const allowedUsersRaw =
    process.env.TELEGRAM_ALLOWED_USERS || process.env.ALLOWED_TELEGRAM_USERS || "";
  const allowedUsers = allowedUsersRaw
    .split(",")
    .map((u) => u.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean);

  let appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

  if (appUrl.startsWith("http://fixbooks.io") || appUrl.startsWith("https://fixbooks.io")) {
    appUrl = "https://www.fixbooks.io";
  }

  return {
    botToken: (process.env.TELEGRAM_BOT_TOKEN || "").trim(),
    secretToken: (process.env.TELEGRAM_SECRET_TOKEN || "fixbooks_tg_secret").trim(),
    allowedUsers,
    geminiApiKey:
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GOOGLE_GENAI_API_KEY ||
      "",
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    fixbooksToken:
      process.env.TELEGRAM_FIXBOOKS_TOKEN ||
      process.env.WHATSAPP_FIXBOOKS_TOKEN ||
      process.env.FIXBOOKS_TOKEN ||
      process.env.DUBBL_TOKEN ||
      "",
    appUrl,
  };
}

/**
 * Validates Telegram secret token header against configured secret
 */
export function verifyTelegramSecretToken(
  receivedToken: string | null,
  configuredSecretToken?: string
): boolean {
  if (!configuredSecretToken) {
    return true;
  }
  if (!receivedToken) {
    return false;
  }

  try {
    const receivedBuf = Buffer.from(receivedToken);
    const configuredBuf = Buffer.from(configuredSecretToken);
    if (receivedBuf.length !== configuredBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(receivedBuf, configuredBuf);
  } catch {
    return false;
  }
}

/**
 * Dispatches message to Telegram Bot API
 */
export async function sendTelegramMessage({
  chatId,
  text,
  parseMode = "HTML",
  replyToMessageId,
}: {
  chatId: string | number;
  text: string;
  parseMode?: "HTML" | "Markdown" | undefined;
  replyToMessageId?: number;
}): Promise<TelegramSendMessageResult> {
  const config = getTelegramConfig();

  if (!config.botToken) {
    throw new Error(
      "Telegram credentials missing. Please configure TELEGRAM_BOT_TOKEN."
    );
  }

  const maxChars = 4000;
  const chunks: string[] = [];

  if (text.length <= maxChars) {
    chunks.push(text);
  } else {
    let current = "";
    for (const paragraph of text.split("\n\n")) {
      if ((current + "\n\n" + paragraph).length > maxChars) {
        if (current) chunks.push(current.trim());
        current = paragraph;
      } else {
        current = current ? `${current}\n\n${paragraph}` : paragraph;
      }
    }
    if (current) chunks.push(current.trim());
  }

  let lastResult: TelegramSendMessageResult = { ok: false };

  for (const chunk of chunks) {
    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: chunk,
    };

    if (parseMode) {
      body.parse_mode = parseMode;
    }

    if (replyToMessageId) {
      body.reply_to_message_id = replyToMessageId;
    }

    let res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // If parse mode failed (e.g. invalid HTML/Markdown), retry as plain text
    if (!res.ok && parseMode) {
      delete body.parse_mode;
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const errMsg =
        errJson?.description ||
        `Telegram Bot API error ${res.status}: ${res.statusText}`;
      throw new Error(errMsg);
    }

    lastResult = (await res.json()) as TelegramSendMessageResult;
  }

  return lastResult;
}

/**
 * Registers webhook with Telegram Bot API
 */
export async function setTelegramWebhook({
  url,
  secretToken,
}: {
  url: string;
  secretToken?: string;
}): Promise<{ ok: boolean; description?: string }> {
  const config = getTelegramConfig();

  if (!config.botToken) {
    throw new Error("Telegram bot token not configured.");
  }

  const apiUrl = `https://api.telegram.org/bot${config.botToken}/setWebhook`;
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      secret_token: secretToken || config.secretToken,
      allowed_updates: ["message"],
      drop_pending_updates: false,
    }),
  });

  return (await res.json()) as { ok: boolean; description?: string };
}

/**
 * Retrieves current webhook status from Telegram
 */
export async function getTelegramWebhookInfo(): Promise<TelegramWebhookInfo | null> {
  const config = getTelegramConfig();
  if (!config.botToken) return null;

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${config.botToken}/getWebhookInfo`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.result as TelegramWebhookInfo;
  } catch {
    return null;
  }
}

/**
 * Retrieves bot profile information (username, first name)
 */
export async function getTelegramMe(): Promise<TelegramUser | null> {
  const config = getTelegramConfig();
  if (!config.botToken) return null;

  try {
    const res = await fetch(`https://api.telegram.org/bot${config.botToken}/getMe`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.result as TelegramUser;
  } catch {
    return null;
  }
}
