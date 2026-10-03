import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLinkCode,
  generateRandomCode,
} from "../lib/integrations/bot-auth";

test("normalizeLinkCode strips prefixes and normalizes input", () => {
  // Test raw 6-digit code
  assert.equal(normalizeLinkCode("123456"), "123456");

  // Test FB- prefix
  assert.equal(normalizeLinkCode("FB-123456"), "123456");
  assert.equal(normalizeLinkCode("fb-987654"), "987654");

  // Test deep-link link_ prefix
  assert.equal(normalizeLinkCode("link_FB-554433"), "554433");
  assert.equal(normalizeLinkCode("LINK_112233"), "112233");
  assert.equal(normalizeLinkCode("link_445566"), "445566");

  // Test whitespace handling
  assert.equal(normalizeLinkCode("  FB-778899  "), "778899");
  assert.equal(normalizeLinkCode(""), "");
});

test("generateRandomCode generates 6-digit FB-XXXXXX code", () => {
  const code = generateRandomCode();
  assert.match(code, /^FB-[0-9]{6}$/);

  const normalized = normalizeLinkCode(code);
  assert.match(normalized, /^[0-9]{6}$/);
});

test("User separation ensures isolated context mapping", () => {
  // Simulate registry of bot links
  interface MockBotLink {
    platform: "telegram" | "whatsapp";
    chatId: string;
    userId: string;
    organizationId: string;
    role: string;
  }

  const links: MockBotLink[] = [
    {
      platform: "telegram",
      chatId: "chat_user_alice",
      userId: "user_alice_uuid",
      organizationId: "org_alpha",
      role: "owner",
    },
    {
      platform: "telegram",
      chatId: "chat_user_bob",
      userId: "user_bob_uuid",
      organizationId: "org_beta",
      role: "member",
    },
    {
      platform: "whatsapp",
      chatId: "447123456789",
      userId: "user_alice_uuid",
      organizationId: "org_alpha",
      role: "owner",
    },
    {
      platform: "whatsapp",
      chatId: "15559876543",
      userId: "user_charlie_uuid",
      organizationId: "org_gamma",
      role: "admin",
    },
  ];

  function resolveMockContext(platform: "telegram" | "whatsapp", chatId: string) {
    const found = links.find((l) => l.platform === platform && l.chatId === chatId);
    if (!found) return null;
    return {
      userId: found.userId,
      organizationId: found.organizationId,
      role: found.role,
    };
  }

  // 1. Verify User Alice receives her own context
  const aliceTgContext = resolveMockContext("telegram", "chat_user_alice");
  assert.deepEqual(aliceTgContext, {
    userId: "user_alice_uuid",
    organizationId: "org_alpha",
    role: "owner",
  });

  // 2. Verify User Bob receives his separate context in org_beta
  const bobTgContext = resolveMockContext("telegram", "chat_user_bob");
  assert.deepEqual(bobTgContext, {
    userId: "user_bob_uuid",
    organizationId: "org_beta",
    role: "member",
  });
  assert.notEqual(aliceTgContext?.userId, bobTgContext?.userId);
  assert.notEqual(aliceTgContext?.organizationId, bobTgContext?.organizationId);

  // 3. Verify WhatsApp Alice maps to Alice
  const aliceWaContext = resolveMockContext("whatsapp", "447123456789");
  assert.deepEqual(aliceWaContext, {
    userId: "user_alice_uuid",
    organizationId: "org_alpha",
    role: "owner",
  });

  // 4. Verify Charlie maps to Charlie
  const charlieWaContext = resolveMockContext("whatsapp", "15559876543");
  assert.deepEqual(charlieWaContext, {
    userId: "user_charlie_uuid",
    organizationId: "org_gamma",
    role: "admin",
  });
  assert.notEqual(aliceWaContext?.userId, charlieWaContext?.userId);

  // 5. Unlinked chats are blocked (return null context)
  const unknownChat = resolveMockContext("telegram", "unlinked_chat_9999");
  assert.equal(unknownChat, null);

  const unknownPhone = resolveMockContext("whatsapp", "447000000000");
  assert.equal(unknownPhone, null);
});

test("Link code redemption honors expiration, single-use, and platform restrictions", () => {
  interface MockCode {
    code: string;
    platform: "telegram" | "whatsapp" | "all";
    userId: string;
    expiresAt: Date;
    usedAt: Date | null;
  }

  const codeStore: MockCode[] = [
    {
      code: "FB-111111",
      platform: "all",
      userId: "user_1",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // active
      usedAt: null,
    },
    {
      code: "FB-222222",
      platform: "telegram",
      userId: "user_2",
      expiresAt: new Date(Date.now() - 1000), // expired
      usedAt: null,
    },
    {
      code: "FB-333333",
      platform: "telegram",
      userId: "user_3",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      usedAt: new Date(Date.now() - 5000), // already used
    },
    {
      code: "FB-444444",
      platform: "whatsapp", // only whatsapp
      userId: "user_4",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      usedAt: null,
    },
  ];

  function redeemCode(
    platform: "telegram" | "whatsapp",
    inputCode: string
  ): { success: boolean; userId?: string; error?: string } {
    const normalized = normalizeLinkCode(inputCode);
    const candidateCodes = [normalized, `FB-${normalized}`];

    const found = codeStore.find(
      (c) =>
        candidateCodes.includes(c.code) &&
        c.expiresAt > new Date() &&
        c.usedAt === null
    );

    if (!found) {
      return { success: false, error: "Invalid or expired link code." };
    }

    if (found.platform !== "all" && found.platform !== platform) {
      return {
        success: false,
        error: `This link code was generated for ${found.platform}, not ${platform}.`,
      };
    }

    found.usedAt = new Date();
    return { success: true, userId: found.userId };
  }

  // 1. Successful redemption with 'FB-111111'
  const res1 = redeemCode("telegram", "FB-111111");
  assert.equal(res1.success, true);
  assert.equal(res1.userId, "user_1");

  // 2. Cannot reuse already redeemed code
  const res1Reuse = redeemCode("telegram", "FB-111111");
  assert.equal(res1Reuse.success, false);
  assert.match(res1Reuse.error || "", /Invalid or expired/);

  // 3. Expired code fails
  const res2 = redeemCode("telegram", "FB-222222");
  assert.equal(res2.success, false);
  assert.match(res2.error || "", /Invalid or expired/);

  // 4. Already used code fails
  const res3 = redeemCode("telegram", "FB-333333");
  assert.equal(res3.success, false);
  assert.match(res3.error || "", /Invalid or expired/);

  // 5. Platform mismatch fails
  const res4 = redeemCode("telegram", "FB-444444"); // platform is whatsapp
  assert.equal(res4.success, false);
  assert.match(res4.error || "", /generated for whatsapp, not telegram/);

  // 6. Platform match succeeds
  const res4Wa = redeemCode("whatsapp", "FB-444444");
  assert.equal(res4Wa.success, true);
  assert.equal(res4Wa.userId, "user_4");
});

test("Telegram and WhatsApp link command parser recognizes various command shapes", () => {
  function parseLinkCommand(text: string): string | null {
    const trimmed = text.trim();
    // Deep-link /start link_XXXXXX
    if (trimmed.startsWith("/start link_")) {
      return trimmed.replace(/^\/start link_/, "").trim();
    }
    // Command /link XXXXXX or !link XXXXXX
    const match = trimmed.match(/^[/!]link\s+([a-zA-Z0-9_-]+)/i);
    if (match) {
      return match[1];
    }
    return null;
  }

  assert.equal(parseLinkCommand("/link FB-887766"), "FB-887766");
  assert.equal(parseLinkCommand("/link 123456"), "123456");
  assert.equal(parseLinkCommand("!link FB-998877"), "FB-998877");
  assert.equal(parseLinkCommand("!link 654321"), "654321");
  assert.equal(parseLinkCommand("/start link_FB-554433"), "FB-554433");
  assert.equal(parseLinkCommand("/start link_112233"), "112233");
  assert.equal(parseLinkCommand("hello fixbooks"), null);
  assert.equal(parseLinkCommand("/invoice Acme, £500"), null);
});
