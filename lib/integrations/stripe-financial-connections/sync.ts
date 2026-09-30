import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import {
  stripeFinancialAccount,
  stripeFinancialConnection,
} from "@/lib/db/schema/integrations";
import { bankAccount, bankTransaction } from "@/lib/db/schema/banking";
import { makeTransactionDedupeHash } from "@/lib/banking/importer";
import { applyBankRulesToTransaction, loadActiveBankRules } from "@/lib/api/bank-rules";
import { eq, and, inArray } from "drizzle-orm";
import type Stripe from "stripe";

export interface SyncAccountOptions {
  startDate?: string; // YYYY-MM-DD
  forceRefresh?: boolean;
}

export interface SyncAccountResult {
  synced: number;
  totalFetched: number;
  balanceCents: number | null;
  status: string;
}

export async function syncFinancialAccount(
  stripeFinancialAccountId: string,
  options?: SyncAccountOptions
): Promise<SyncAccountResult> {
  if (!stripe) {
    throw new Error("Stripe is not configured. Please set STRIPE_SECRET_KEY.");
  }

  // 1. Load account record
  const [fa] = await db
    .select()
    .from(stripeFinancialAccount)
    .where(eq(stripeFinancialAccount.id, stripeFinancialAccountId))
    .limit(1);

  if (!fa) {
    throw new Error(`Stripe financial account ${stripeFinancialAccountId} not found.`);
  }

  if (!fa.bankAccountId) {
    return {
      synced: 0,
      totalFetched: 0,
      balanceCents: null,
      status: "unlinked",
    };
  }

  // 2. Load connection details for default date window
  const [conn] = await db
    .select()
    .from(stripeFinancialConnection)
    .where(eq(stripeFinancialConnection.id, fa.connectionId))
    .limit(1);

  // 3. Determine start timestamp (max 730 days)
  const now = new Date();
  const maxCutoff = new Date(now.getTime() - 730 * 24 * 60 * 60 * 1000);
  let cutoffDate: Date;

  if (options?.startDate) {
    const parsed = new Date(options.startDate);
    cutoffDate = !isNaN(parsed.getTime()) && parsed > maxCutoff ? parsed : maxCutoff;
  } else if (conn?.initialSyncStartDate) {
    const parsed = new Date(conn.initialSyncStartDate);
    cutoffDate = !isNaN(parsed.getTime()) && parsed > maxCutoff ? parsed : maxCutoff;
  } else {
    const days = conn?.initialSyncDays ?? 90;
    const computed = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    cutoffDate = computed > maxCutoff ? computed : maxCutoff;
  }

  const minTimestamp = Math.floor(cutoffDate.getTime() / 1000);

  // 4. Force refresh if requested
  if (options?.forceRefresh) {
    try {
      await stripe.financialConnections.accounts.refresh(fa.stripeAccountId, {
        features: ["transactions", "balance"],
      });
    } catch (err) {
      console.warn(`Stripe refresh warning for ${fa.stripeAccountId}:`, err);
    }
  }

  // 5. Fetch updated balance
  let balanceCents: number | null = null;
  let stripeAcc: Stripe.FinancialConnections.Account;
  try {
    stripeAcc = await stripe.financialConnections.accounts.retrieve(
      fa.stripeAccountId,
      { expand: ["balance"] }
    );
    if (stripeAcc.balance?.cash?.available) {
      const vals = Object.values(stripeAcc.balance.cash.available);
      if (vals.length > 0 && typeof vals[0] === "number") {
        balanceCents = vals[0];
      }
    } else if (stripeAcc.balance?.current) {
      const vals = Object.values(stripeAcc.balance.current);
      if (vals.length > 0 && typeof vals[0] === "number") {
        balanceCents = vals[0];
      }
    }

    if (balanceCents != null) {
      await db
        .update(bankAccount)
        .set({ balance: balanceCents })
        .where(eq(bankAccount.id, fa.bankAccountId));
    }
  } catch (err) {
    console.error(`Failed to retrieve Stripe balance for ${fa.stripeAccountId}:`, err);
    throw err;
  }

  // 6. Fetch transactions from Stripe (auto-paginated)
  let hasMore = true;
  let startingAfter: string | undefined;
  const allTxns: Stripe.FinancialConnections.Transaction[] = [];

  while (hasMore && allTxns.length < 1000) {
    const res = await stripe.financialConnections.transactions.list({
      account: fa.stripeAccountId,
      limit: 100,
      transacted_at: { gte: minTimestamp },
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    allTxns.push(...res.data);
    hasMore = res.has_more;
    if (res.data.length > 0) {
      startingAfter = res.data[res.data.length - 1].id;
    } else {
      hasMore = false;
    }
  }

  // 7. Load existing transactions for deduplication
  const existingRecords = await db
    .select({
      externalTransactionId: bankTransaction.externalTransactionId,
      dedupeHash: bankTransaction.dedupeHash,
    })
    .from(bankTransaction)
    .where(eq(bankTransaction.bankAccountId, fa.bankAccountId));

  const existingExtIds = new Set(
    existingRecords.map((r) => r.externalTransactionId).filter(Boolean) as string[]
  );
  const existingHashes = new Set(
    existingRecords.map((r) => r.dedupeHash).filter(Boolean) as string[]
  );

  // 8. Load active bank rules
  const activeRules = await loadActiveBankRules(fa.organizationId);

  // 9. Prepare new rows
  const rowsToInsert = [];
  for (const txn of allTxns) {
    if (existingExtIds.has(txn.id)) {
      continue;
    }

    const dateStr = new Date(txn.transacted_at * 1000).toISOString().slice(0, 10);
    const txCurrency = (txn.currency || fa.currency || "GBP").toUpperCase();
    const normalizedTx = {
      date: dateStr,
      amount: txn.amount,
      description: txn.description || "Bank Transaction",
      externalTransactionId: txn.id,
      reference: null,
      statementLineRef: null,
      currencyCode: txCurrency,
      pending: txn.status === "pending",
      raw: txn as unknown as Record<string, unknown>,
    };

    const dedupeHash = makeTransactionDedupeHash(fa.bankAccountId, normalizedTx);
    if (existingHashes.has(dedupeHash)) {
      continue;
    }

    const assignment = activeRules.length
      ? applyBankRulesToTransaction(activeRules, normalizedTx)
      : null;

    const postedDateStr = txn.status_transitions?.posted_at
      ? new Date(txn.status_transitions.posted_at * 1000).toISOString().slice(0, 10)
      : dateStr;

    rowsToInsert.push({
      bankAccountId: fa.bankAccountId,
      date: dateStr,
      postedDate: postedDateStr,
      description: txn.description || "Bank Transaction",
      reference: null,
      amount: txn.amount,
      status: (assignment?.reconcile ? "reconciled" : "unreconciled") as
        | "reconciled"
        | "unreconciled",
      sourceType: "stripe_financial_connections",
      externalTransactionId: txn.id,
      statementLineRef: null,
      payee: null,
      counterparty: null,
      currencyCode: txCurrency,
      pending: txn.status === "pending",
      rawPayload: txn as unknown as Record<string, unknown>,
      dedupeHash,
      accountId: assignment?.accountId ?? null,
      contactId: assignment?.contactId ?? null,
      taxRateId: assignment?.taxRateId ?? null,
    });

    existingExtIds.add(txn.id);
    existingHashes.add(dedupeHash);
  }

  // 10. Bulk insert new rows in batches
  if (rowsToInsert.length > 0) {
    const BATCH_SIZE = 100;
    for (let i = 0; i < rowsToInsert.length; i += BATCH_SIZE) {
      const batch = rowsToInsert.slice(i, i + BATCH_SIZE);
      await db.insert(bankTransaction).values(batch);
    }
  }

  // 11. Update financial account metadata
  await db
    .update(stripeFinancialAccount)
    .set({
      lastSyncAt: new Date(),
      lastSyncTxnCount: rowsToInsert.length,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(stripeFinancialAccount.id, fa.id));

  return {
    synced: rowsToInsert.length,
    totalFetched: allTxns.length,
    balanceCents,
    status: "active",
  };
}

export async function syncOrganizationFinancialAccounts(
  organizationId: string,
  options?: SyncAccountOptions
): Promise<{ accountId: string; synced: number }[]> {
  const accounts = await db
    .select({ id: stripeFinancialAccount.id })
    .from(stripeFinancialAccount)
    .where(
      and(
        eq(stripeFinancialAccount.organizationId, organizationId),
        eq(stripeFinancialAccount.status, "active")
      )
    );

  const results = [];
  for (const acc of accounts) {
    try {
      const res = await syncFinancialAccount(acc.id, options);
      results.push({ accountId: acc.id, synced: res.synced });
    } catch (err) {
      console.error(`Error syncing account ${acc.id}:`, err);
    }
  }

  return results;
}
