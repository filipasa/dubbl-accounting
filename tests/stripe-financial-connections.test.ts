import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateHistoricalDays,
  MAX_HISTORICAL_DAYS,
} from "../lib/integrations/stripe-financial-connections/client";
import { makeTransactionDedupeHash } from "../lib/banking/importer";

test("calculateHistoricalDays defaults to 90 days when no options provided", () => {
  const result = calculateHistoricalDays();
  assert.equal(result.days, 90);
  assert.match(result.startDate, /^\d{4}-\d{2}-\d{2}$/);
});

test("calculateHistoricalDays supports standard presets (30, 90, 180, 365, 730)", () => {
  for (const preset of [30, 90, 180, 365, 730]) {
    const res = calculateHistoricalDays({ days: preset });
    assert.equal(res.days, preset);
    assert.match(res.startDate, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("calculateHistoricalDays clamps historical days to a maximum of 730 days (2 years)", () => {
  assert.equal(MAX_HISTORICAL_DAYS, 730);

  const resOver = calculateHistoricalDays({ days: 1000 });
  assert.equal(resOver.days, 730);

  const resWayOver = calculateHistoricalDays({ days: 5000 });
  assert.equal(resWayOver.days, 730);
});

test("calculateHistoricalDays clamps negative or zero days to at least 1 day", () => {
  const resZero = calculateHistoricalDays({ days: 0 });
  assert.equal(resZero.days, 1);

  const resNeg = calculateHistoricalDays({ days: -45 });
  assert.equal(resNeg.days, 1);
});

test("calculateHistoricalDays correctly calculates days from custom startDate", () => {
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const res = calculateHistoricalDays({ startDate: sixtyDaysAgo });
  assert.ok(res.days >= 59 && res.days <= 61, `Expected ~60 days, got ${res.days}`);
  assert.equal(res.startDate, sixtyDaysAgo);
});

test("calculateHistoricalDays clamps custom startDate older than 730 days", () => {
  const fourYearsAgo = new Date(Date.now() - 4 * 365 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const res = calculateHistoricalDays({ startDate: fourYearsAgo });
  assert.equal(res.days, 730);
  assert.match(res.startDate, /^\d{4}-\d{2}-\d{2}$/);
});

test("calculateHistoricalDays handles invalid date strings gracefully", () => {
  const res = calculateHistoricalDays({ startDate: "invalid-date-string" });
  assert.equal(res.days, 90);
});

test("Stripe Financial Connections transactions deduplication hash produces deterministic hash", () => {
  const bankAccountId = "00000000-0000-0000-0000-000000000001";
  const tx1 = {
    date: "2026-09-25",
    amount: -4500,
    description: "Office Supplies Depot",
    externalTransactionId: "fctxn_1234567890abcdef",
    currencyCode: "GBP",
    raw: {},
  };

  const hash1 = makeTransactionDedupeHash(bankAccountId, tx1);
  const hash2 = makeTransactionDedupeHash(bankAccountId, { ...tx1 });

  assert.equal(hash1, hash2);
  assert.equal(typeof hash1, "string");
  assert.equal(hash1.length, 64); // SHA-256 hex string

  // Changing externalTransactionId changes the hash
  const hashDifferentTxn = makeTransactionDedupeHash(bankAccountId, {
    ...tx1,
    externalTransactionId: "fctxn_9999999999abcdef",
  });
  assert.notEqual(hash1, hashDifferentTxn);

  // Changing amount changes the hash
  const hashDifferentAmount = makeTransactionDedupeHash(bankAccountId, {
    ...tx1,
    amount: -4501,
  });
  assert.notEqual(hash1, hashDifferentAmount);

  // Different bank accounts don't collide
  const hashOtherAccount = makeTransactionDedupeHash(
    "00000000-0000-0000-0000-000000000002",
    tx1
  );
  assert.notEqual(hash1, hashOtherAccount);
});
