import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sendWhatsAppTextMessage } from "@/lib/integrations/whatsapp/client";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { phoneNumber?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { phoneNumber, message } = body;
  if (!phoneNumber) {
    return NextResponse.json(
      { error: "Phone number is required (with country code, e.g. 447950869980)" },
      { status: 400 }
    );
  }

  const testText =
    message ||
    "👋 *Hello from Fixbooks!*\n\nYour Meta WhatsApp Cloud API integration is connected and working! You can now send bookkeeping commands like `!help` or text in natural language to create quotes and invoices.";

  try {
    const result = await sendWhatsAppTextMessage({
      to: phoneNumber,
      text: testText,
    });

    const messageId = result.messages?.[0]?.id || "sent";
    const recipient = result.contacts?.[0]?.wa_id || phoneNumber;

    return NextResponse.json({
      success: true,
      messageId,
      recipient,
    });
  } catch (err: any) {
    console.error("[WhatsApp Test Message] Failed:", err);
    return NextResponse.json(
      { error: err.message || "Failed to send test WhatsApp message" },
      { status: 500 }
    );
  }
}
