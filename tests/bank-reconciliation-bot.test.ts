import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findBankTransaction,
  findBillByNumber,
  findChartAccount,
  reconcileBankTransactionAction,
} from "../lib/integrations/whatsapp/executor";
import { handleTelegramCommand } from "../lib/integrations/telegram/handler";
import { handleShortcutCommand } from "../lib/integrations/whatsapp/handler";

test("findBankTransaction returns null when given empty query", async () => {
  const dummyCtx = { userId: "test-user", organizationId: "00000000-0000-0000-0000-000000000001", role: "owner" as const };
  const res = await findBankTransaction(dummyCtx, "");
  assert.equal(res, null);
});

test("findBillByNumber returns null when given empty query", async () => {
  const dummyCtx = { userId: "test-user", organizationId: "00000000-0000-0000-0000-000000000001", role: "owner" as const };
  const res = await findBillByNumber(dummyCtx, "");
  assert.equal(res, null);
});

test("findChartAccount returns null when given empty query", async () => {
  const dummyCtx = { userId: "test-user", organizationId: "00000000-0000-0000-0000-000000000001", role: "owner" as const };
  const res = await findChartAccount(dummyCtx, "");
  assert.equal(res, null);
});

test("reconcileBankTransactionAction returns error message when transaction does not exist", async () => {
  const dummyCtx = { userId: "test-user", organizationId: "00000000-0000-0000-0000-000000000001", role: "owner" as const };
  const res = await reconcileBankTransactionAction(dummyCtx, {
    transactionId: "nonexistent-tx-id",
    target: "INV-00001",
  });
  assert.equal(res.success, false);
  assert.ok(res.error?.includes("not found"));
  assert.ok(res.formattedMessage.includes("not found"));
});

test("handleTelegramCommand handles /reconcile subcommands gracefully", async () => {
  const dummyCtx = { userId: "test-user", organizationId: "00000000-0000-0000-0000-000000000001", role: "owner" as const };

  // Suggestions for nonexistent tx
  const sugRes = await handleTelegramCommand(dummyCtx, "/reconcile suggestions nonexistent-id");
  assert.ok(sugRes.includes("not found"));

  // Reconcile nonexistent tx
  const recRes = await handleTelegramCommand(dummyCtx, "/reconcile nonexistent-id INV-00001");
  assert.ok(recRes.includes("not found"));
});

test("handleShortcutCommand in WhatsApp handles !reconcile subcommands gracefully", async () => {
  const dummyCtx = { userId: "test-user", organizationId: "00000000-0000-0000-0000-000000000001", role: "owner" as const };

  const sugRes = await handleShortcutCommand(dummyCtx, "!reconcile suggestions nonexistent-id");
  assert.ok(sugRes.includes("not found"));

  const recRes = await handleShortcutCommand(dummyCtx, "!reconcile nonexistent-id INV-00001");
  assert.ok(recRes.includes("not found"));
});
