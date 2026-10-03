import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api/auth-context";
import { handleError } from "@/lib/api/response";
import {
  getUserBotLinks,
  createBotLinkCode,
  unlinkUserPlatform,
  directLinkUser,
  type BotPlatform,
} from "@/lib/integrations/bot-auth";
import { getTelegramConfig, getTelegramMe } from "@/lib/integrations/telegram/client";
import { getWhatsAppConfig, getWhatsAppBusinessProfile } from "@/lib/integrations/whatsapp/client";

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext(request);
    const links = await getUserBotLinks(ctx.userId, ctx.organizationId);

    const tgConfig = getTelegramConfig();
    const waConfig = getWhatsAppConfig();

    const [tgMe, waProfile] = await Promise.all([
      tgConfig.botToken ? getTelegramMe().catch(() => null) : Promise.resolve(null),
      waConfig.accessToken && waConfig.phoneNumberId
        ? getWhatsAppBusinessProfile().catch(() => null)
        : Promise.resolve(null),
    ]);

    const telegramUsername = tgMe?.username || (tgConfig.botToken ? "FixbooksAssistantBot" : null);
    const whatsappPhone = waProfile?.displayPhoneNumber || waConfig.phoneNumberId || null;

    return NextResponse.json({
      links: {
        telegram: links.telegram
          ? {
              id: links.telegram.id,
              chatId: links.telegram.chatId,
              username: links.telegram.platformUsername,
              displayName: links.telegram.displayName,
              linkedAt: links.telegram.createdAt,
            }
          : null,
        whatsapp: links.whatsapp
          ? {
              id: links.whatsapp.id,
              phone: links.whatsapp.chatId,
              displayName: links.whatsapp.displayName,
              linkedAt: links.whatsapp.createdAt,
            }
          : null,
      },
      botInfo: {
        telegramUsername,
        whatsappPhone,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext(request);
    const body = await request.json().catch(() => ({}));
    const platform = (body.platform || "all") as BotPlatform | "all";

    const { code, expiresAt } = await createBotLinkCode(
      ctx.userId,
      ctx.organizationId,
      platform
    );

    const tgConfig = getTelegramConfig();
    const waConfig = getWhatsAppConfig();

    return NextResponse.json({
      code,
      expiresAt: expiresAt.toISOString(),
      platform,
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await getAuthContext(request);
    const url = new URL(request.url);
    const platform = url.searchParams.get("platform") as BotPlatform | null;

    if (!platform || (platform !== "telegram" && platform !== "whatsapp")) {
      return NextResponse.json(
        { error: "Valid platform (telegram or whatsapp) is required" },
        { status: 400 }
      );
    }

    const unlinked = await unlinkUserPlatform(
      ctx.userId,
      ctx.organizationId,
      platform
    );

    return NextResponse.json({ success: true, unlinked });
  } catch (err) {
    return handleError(err);
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await getAuthContext(request);
    const body = await request.json();
    const { platform, identifier, displayName } = body as {
      platform: BotPlatform;
      identifier: string;
      displayName?: string;
    };

    if (!platform || !identifier) {
      return NextResponse.json(
        { error: "platform and identifier are required" },
        { status: 400 }
      );
    }

    const res = await directLinkUser(
      ctx.userId,
      ctx.organizationId,
      platform,
      identifier,
      displayName
    );

    if (!res.success) {
      return NextResponse.json({ error: res.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleError(err);
  }
}
