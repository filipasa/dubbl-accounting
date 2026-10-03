import { db } from "@/lib/db";
import {
  botConversationLink,
  botLinkCode,
  users,
  organization,
  member,
} from "@/lib/db/schema";
import { eq, and, gt, isNull } from "drizzle-orm";
import type { AuthContext } from "@/lib/api/auth-context";
import type { MemberRole } from "@/lib/plans";
import crypto from "crypto";

export type BotPlatform = "telegram" | "whatsapp";

export interface SenderInfo {
  username?: string | null;
  userId?: string | null;
  displayName?: string | null;
}

/**
 * Normalizes link codes (removes leading prefixes like 'link_', trims, uppercase)
 */
export function normalizeLinkCode(rawCode: string): string {
  let cleaned = (rawCode || "").trim().toUpperCase();
  if (cleaned.startsWith("LINK_")) {
    cleaned = cleaned.slice(5).trim();
  }
  if (cleaned.startsWith("FB-")) {
    cleaned = cleaned.slice(3).trim();
  }
  return cleaned;
}

/**
 * Generates a friendly link code (e.g. FB-839201)
 */
export function generateRandomCode(): string {
  const digits = Math.floor(100000 + Math.random() * 900000).toString();
  return `FB-${digits}`;
}

/**
 * Resolves the AuthContext for a specific conversation.
 * Scopes every bookkeeping action strictly to the linked Fixbooks user and organization.
 */
export async function resolveBotUserContext(
  platform: BotPlatform,
  chatId: string,
  senderInfo?: SenderInfo
): Promise<AuthContext | null> {
  if (!chatId) return null;

  // 1. Check primary lookup by (platform, chatId)
  let link = await db.query.botConversationLink.findFirst({
    where: and(
      eq(botConversationLink.platform, platform),
      eq(botConversationLink.chatId, chatId)
    ),
  });

  // 2. If not found, try fallback lookup by telegram username or user ID (if available)
  if (!link && platform === "telegram" && senderInfo?.username) {
    const cleanUsername = senderInfo.username.replace(/^@/, "").toLowerCase();
    link = await db.query.botConversationLink.findFirst({
      where: and(
        eq(botConversationLink.platform, platform),
        eq(botConversationLink.platformUsername, cleanUsername)
      ),
    });

    if (link) {
      // Update chatId to this chat
      await db
        .update(botConversationLink)
        .set({
          chatId,
          platformUserId: senderInfo.userId || link.platformUserId,
          displayName: senderInfo.displayName || link.displayName,
          updatedAt: new Date(),
        })
        .where(eq(botConversationLink.id, link.id))
        .catch(() => {});
    }
  }

  // 3. Fallback lookup for telegram by platformUserId
  if (!link && platform === "telegram" && senderInfo?.userId) {
    link = await db.query.botConversationLink.findFirst({
      where: and(
        eq(botConversationLink.platform, platform),
        eq(botConversationLink.platformUserId, senderInfo.userId)
      ),
    });

    if (link) {
      await db
        .update(botConversationLink)
        .set({
          chatId,
          platformUsername: senderInfo.username ? senderInfo.username.replace(/^@/, "").toLowerCase() : link.platformUsername,
          displayName: senderInfo.displayName || link.displayName,
          updatedAt: new Date(),
        })
        .where(eq(botConversationLink.id, link.id))
        .catch(() => {});
    }
  }

  if (!link) {
    return null;
  }

  // 4. Verify organization is still active
  const org = await db.query.organization.findFirst({
    where: and(
      eq(organization.id, link.organizationId),
      isNull(organization.deletedAt)
    ),
  });

  if (!org) {
    return null;
  }

  // 5. Verify user's membership and role in that organization
  const mem = await db.query.member.findFirst({
    where: and(
      eq(member.userId, link.userId),
      eq(member.organizationId, link.organizationId)
    ),
  });

  const role = (mem?.role || "member") as MemberRole;

  return {
    userId: link.userId,
    organizationId: link.organizationId,
    role,
  };
}

/**
 * Returns user and organization details for an active conversation link
 */
export async function getLinkedUserInfo(
  platform: BotPlatform,
  chatId: string
): Promise<{
  user: { id: string; name: string | null; email: string };
  org: { id: string; name: string };
  role: string;
} | null> {
  const link = await db.query.botConversationLink.findFirst({
    where: and(
      eq(botConversationLink.platform, platform),
      eq(botConversationLink.chatId, chatId)
    ),
  });

  if (!link) return null;

  const user = await db.query.users.findFirst({
    where: eq(users.id, link.userId),
  });

  const org = await db.query.organization.findFirst({
    where: eq(organization.id, link.organizationId),
  });

  const mem = await db.query.member.findFirst({
    where: and(
      eq(member.userId, link.userId),
      eq(member.organizationId, link.organizationId)
    ),
  });

  if (!user || !org) return null;

  return {
    user: { id: user.id, name: user.name, email: user.email },
    org: { id: org.id, name: org.name },
    role: mem?.role || "member",
  };
}

/**
 * Creates a short-lived link code for the current user and org
 */
export async function createBotLinkCode(
  userId: string,
  organizationId: string,
  platform: BotPlatform | "all" = "all"
): Promise<{ code: string; expiresAt: Date }> {
  // Expiration: 15 minutes from now
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const code = generateRandomCode();

  await db.insert(botLinkCode).values({
    code,
    platform,
    userId,
    organizationId,
    expiresAt,
  });

  return { code, expiresAt };
}

/**
 * Links a conversation using a 6-digit or FB-XXXXXX link code
 */
export async function linkConversationWithCode(
  platform: BotPlatform,
  chatId: string,
  rawCode: string,
  senderInfo?: SenderInfo
): Promise<{
  success: boolean;
  user?: { id: string; name: string | null; email: string };
  org?: { id: string; name: string };
  error?: string;
}> {
  const normalized = normalizeLinkCode(rawCode);
  if (!normalized) {
    return { success: false, error: "Link code cannot be empty." };
  }

  const now = new Date();

  // Find valid code (accept either FB-XXXXXX or XXXXXX)
  const candidateCodes = [normalized, `FB-${normalized}`];

  let foundCode: typeof botLinkCode.$inferSelect | null = null;
  for (const c of candidateCodes) {
    const record = await db.query.botLinkCode.findFirst({
      where: and(
        eq(botLinkCode.code, c),
        gt(botLinkCode.expiresAt, now),
        isNull(botLinkCode.usedAt)
      ),
    });
    if (record) {
      foundCode = record;
      break;
    }
  }

  if (!foundCode) {
    return {
      success: false,
      error: "Invalid or expired link code. Please generate a new code in Fixbooks Settings.",
    };
  }

  if (foundCode.platform !== "all" && foundCode.platform !== platform) {
    return {
      success: false,
      error: `This link code was generated for ${foundCode.platform}, not ${platform}.`,
    };
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, foundCode.userId),
  });

  const org = await db.query.organization.findFirst({
    where: and(
      eq(organization.id, foundCode.organizationId),
      isNull(organization.deletedAt)
    ),
  });

  if (!user || !org) {
    return { success: false, error: "Associated user or organization not found." };
  }

  const cleanUsername = senderInfo?.username
    ? senderInfo.username.replace(/^@/, "").toLowerCase()
    : null;

  // Check if link already exists for (platform, chatId)
  const existingLink = await db.query.botConversationLink.findFirst({
    where: and(
      eq(botConversationLink.platform, platform),
      eq(botConversationLink.chatId, chatId)
    ),
  });

  if (existingLink) {
    await db
      .update(botConversationLink)
      .set({
        userId: foundCode.userId,
        organizationId: foundCode.organizationId,
        platformUsername: cleanUsername || existingLink.platformUsername,
        platformUserId: senderInfo?.userId || existingLink.platformUserId,
        displayName: senderInfo?.displayName || existingLink.displayName,
        updatedAt: new Date(),
      })
      .where(eq(botConversationLink.id, existingLink.id));
  } else {
    await db.insert(botConversationLink).values({
      platform,
      chatId,
      userId: foundCode.userId,
      organizationId: foundCode.organizationId,
      platformUsername: cleanUsername,
      platformUserId: senderInfo?.userId || null,
      displayName: senderInfo?.displayName || null,
    });
  }

  // Mark code as used
  await db
    .update(botLinkCode)
    .set({ usedAt: new Date() })
    .where(eq(botLinkCode.id, foundCode.id));

  return {
    success: true,
    user: { id: user.id, name: user.name, email: user.email },
    org: { id: org.id, name: org.name },
  };
}

/**
 * Direct link from Web Settings (e.g. entering phone number or Telegram username)
 */
export async function directLinkUser(
  userId: string,
  organizationId: string,
  platform: BotPlatform,
  identifier: string,
  displayName?: string
): Promise<{ success: boolean; error?: string }> {
  const cleanId =
    platform === "whatsapp"
      ? identifier.replace(/[^0-9]/g, "")
      : identifier.replace(/^@/, "").trim().toLowerCase();

  if (!cleanId) {
    return { success: false, error: "Identifier cannot be empty." };
  }

  const existing = await db.query.botConversationLink.findFirst({
    where: and(
      eq(botConversationLink.platform, platform),
      eq(
        platform === "whatsapp"
          ? botConversationLink.chatId
          : botConversationLink.platformUsername,
        cleanId
      )
    ),
  });

  if (existing) {
    await db
      .update(botConversationLink)
      .set({
        userId,
        organizationId,
        displayName: displayName || existing.displayName,
        updatedAt: new Date(),
      })
      .where(eq(botConversationLink.id, existing.id));
  } else {
    await db.insert(botConversationLink).values({
      platform,
      chatId: cleanId,
      userId,
      organizationId,
      platformUsername: platform === "telegram" ? cleanId : null,
      displayName: displayName || null,
    });
  }

  return { success: true };
}

/**
 * Unlinks a conversation from chat side
 */
export async function unlinkConversation(
  platform: BotPlatform,
  chatId: string
): Promise<boolean> {
  const deleted = await db
    .delete(botConversationLink)
    .where(
      and(
        eq(botConversationLink.platform, platform),
        eq(botConversationLink.chatId, chatId)
      )
    )
    .returning({ id: botConversationLink.id });

  return deleted.length > 0;
}

/**
 * Unlinks a user's platform link from Web Settings
 */
export async function unlinkUserPlatform(
  userId: string,
  organizationId: string,
  platform: BotPlatform
): Promise<boolean> {
  const deleted = await db
    .delete(botConversationLink)
    .where(
      and(
        eq(botConversationLink.platform, platform),
        eq(botConversationLink.userId, userId),
        eq(botConversationLink.organizationId, organizationId)
      )
    )
    .returning({ id: botConversationLink.id });

  return deleted.length > 0;
}

/**
 * Returns current links for a user in a specific organization
 */
export async function getUserBotLinks(
  userId: string,
  organizationId: string
): Promise<{
  telegram: typeof botConversationLink.$inferSelect | null;
  whatsapp: typeof botConversationLink.$inferSelect | null;
}> {
  const links = await db.query.botConversationLink.findMany({
    where: and(
      eq(botConversationLink.userId, userId),
      eq(botConversationLink.organizationId, organizationId)
    ),
  });

  const telegram = links.find((l) => l.platform === "telegram") || null;
  const whatsapp = links.find((l) => l.platform === "whatsapp") || null;

  return { telegram, whatsapp };
}
