import crypto from "crypto";
import type { WhatsAppConfig, WhatsAppSendResult } from "./types";

export function getWhatsAppConfig(): WhatsAppConfig {
  const allowedNumbersRaw =
    process.env.WHATSAPP_ALLOWED_NUMBERS || process.env.ALLOWED_NUMBERS || "";
  const allowedNumbers = allowedNumbersRaw
    .split(",")
    .map((n) => n.trim().replace(/[^0-9]/g, ""))
    .filter(Boolean);

  let appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.NODE_ENV === "production" || process.env.VERCEL
      ? "https://www.fixbooks.io"
      : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

  if (
    appUrl.includes("fixbooks.io") ||
    appUrl.includes("dubbl-accounting.vercel.app")
  ) {
    appUrl = "https://www.fixbooks.io";
  }

  return {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
    phoneNumberId: (process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim(),
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "fixbooks_wa_verify_token",
    appSecret: process.env.WHATSAPP_APP_SECRET || "",
    allowedNumbers,
    geminiApiKey:
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GOOGLE_GENAI_API_KEY ||
      "",
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    fixbooksToken:
      process.env.WHATSAPP_FIXBOOKS_TOKEN ||
      process.env.FIXBOOKS_TOKEN ||
      process.env.DUBBL_TOKEN ||
      "",
    fixbooksUrl: `${appUrl}/api/mcp`,
    appUrl,
  };
}

/**
 * Validates Meta x-hub-signature-256 header against the raw webhook body
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret?: string
): boolean {
  if (!appSecret) {
    // If app secret is not configured, pass signature check
    return true;
  }

  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const expectedSignature = signatureHeader.slice(7);
  const hmac = crypto.createHmac("sha256", appSecret);
  const calculatedSignature = hmac.update(rawBody, "utf8").digest("hex");

  try {
    const expectedBuf = Buffer.from(expectedSignature, "hex");
    const calculatedBuf = Buffer.from(calculatedSignature, "hex");
    if (expectedBuf.length !== calculatedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(expectedBuf, calculatedBuf);
  } catch {
    return false;
  }
}

/**
 * Converts rich HTML into WhatsApp-native markdown formatting and strips all HTML tags.
 */
export function htmlToWhatsAppMarkdown(text: string): string {
  if (!text) return "";
  let formatted = text
    .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, "\n*$1*\n")
    .replace(/<(b|strong)>(.*?)<\/(b|strong)>/gi, "*$2*")
    .replace(/<(i|em)>(.*?)<\/(i|em)>/gi, "_$2_")
    .replace(/<(s|strike|del)>(.*?)<\/(s|strike|del)>/gi, "~$2~")
    .replace(/<code>(.*?)<\/code>/gi, "`$1`")
    .replace(/<pre>(.*?)<\/pre>/gi, "```$1```")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<\/div>/gi, "\n")
    .replace(/<div[^>]*>/gi, "")
    .replace(/<hr\s*\/?>/gi, "\n---\n");

  formatted = formatted.replace(/<\/?[a-z0-9_-]+(?:\s+[^>]*?)?>/gi, "");
  return formatted.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Sends a text message to a WhatsApp user via Meta Cloud API
 */
export async function sendWhatsAppTextMessage({
  to,
  text,
  previewUrl = false,
}: {
  to: string;
  text: string;
  previewUrl?: boolean;
}): Promise<WhatsAppSendResult> {
  const config = getWhatsAppConfig();

  if (!config.accessToken || !config.phoneNumberId) {
    throw new Error(
      "WhatsApp credentials missing. Please configure WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID."
    );
  }

  // Format recipient number (strip non-digits, leading +, etc.)
  const recipient = to.replace(/[^0-9]/g, "");
  if (!recipient) {
    throw new Error(`Invalid recipient phone number: ${to}`);
  }

  const cleanedText = htmlToWhatsAppMarkdown(text);
  const maxChars = 4000;
  const chunks: string[] = [];
  if (cleanedText.length <= maxChars) {
    chunks.push(cleanedText);
  } else {
    let remaining = cleanedText;
    while (remaining.length > 0) {
      chunks.push(remaining.slice(0, maxChars));
      remaining = remaining.slice(maxChars);
    }
  }

  let lastResult: WhatsAppSendResult = {
    messaging_product: "whatsapp",
    contacts: [{ input: recipient, wa_id: recipient }],
    messages: [],
  };

  for (const chunk of chunks) {
    const url = `https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "text",
        text: {
          preview_url: previewUrl,
          body: chunk,
        },
      }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const errMsg =
        errJson?.error?.message ||
        `Meta Graph API error ${res.status}: ${res.statusText}`;
      throw new Error(errMsg);
    }

    lastResult = (await res.json()) as WhatsAppSendResult;
  }

  return lastResult;
}

/**
 * Marks an incoming WhatsApp message as read
 */
export async function markWhatsAppMessageRead(messageId: string): Promise<boolean> {
  const config = getWhatsAppConfig();

  if (!config.accessToken || !config.phoneNumberId || !messageId) {
    return false;
  }

  try {
    const url = `https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      }),
    });

    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Retrieves WhatsApp business phone number profile from Meta Graph API
 */
export async function getWhatsAppBusinessProfile(): Promise<{
  displayPhoneNumber?: string;
  verifiedName?: string;
  qualityRating?: string;
} | null> {
  const config = getWhatsAppConfig();

  if (!config.accessToken || !config.phoneNumberId) {
    return null;
  }

  try {
    const url = `https://graph.facebook.com/v21.0/${config.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
      },
    });

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    return {
      displayPhoneNumber: data.display_phone_number,
      verifiedName: data.verified_name,
      qualityRating: data.quality_rating,
    };
  } catch {
    return null;
  }
}
