import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bankAccount, bankTransaction, payment } from "@/lib/db/schema";
import { eq, and, ne, isNotNull } from "drizzle-orm";
import { getAuthContext } from "@/lib/api/auth-context";
import { requireRole } from "@/lib/api/require-role";
import { handleError, notFound } from "@/lib/api/response";
import { logAudit } from "@/lib/api/audit";
import { notDeleted } from "@/lib/db/soft-delete";

interface StripePayoutMatch {
  importedTransactionId: string;
  importedDescription: string;
  importedDate: string;
  importedAmount: number;
  stripeTransactionId: string;
  stripeJournalEntryId: string;
  stripeExternalTransactionId: string | null;
  stripeDate: string;
  confidence: number;
}

function findPayoutMatches(
  importedList: Array<typeof bankTransaction.$inferSelect>,
  stripeList: Array<typeof bankTransaction.$inferSelect>
): StripePayoutMatch[] {
  const matches: StripePayoutMatch[] = [];
  const usedStripeIds = new Set<string>();

  // Filter imported transactions that look like Stripe payouts (positive amount, mentions stripe or bgc)
  const candidates = importedList
    .filter((tx) => {
      if (tx.amount <= 0 || tx.status !== "unreconciled") return false;
      const text = `${tx.description || ""} ${tx.reference || ""} ${tx.payee || ""}`.toLowerCase();
      return text.includes("stripe") || text.includes("bgc");
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const imp of candidates) {
    // Find unused stripe payouts with exact amount, within +/- 4 days
    const pool = stripeList.filter(
      (s) =>
        !usedStripeIds.has(s.id) &&
        s.amount === imp.amount &&
        s.journalEntryId &&
        Math.abs(new Date(s.date).getTime() - new Date(imp.date).getTime()) <= 4 * 86400000
    );

    if (pool.length === 0) continue;

    // Pick closest date
    pool.sort(
      (a, b) =>
        Math.abs(new Date(a.date).getTime() - new Date(imp.date).getTime()) -
        Math.abs(new Date(b.date).getTime() - new Date(imp.date).getTime())
    );

    const best = pool[0];
    usedStripeIds.add(best.id);

    const daysDiff = Math.abs(
      (new Date(best.date).getTime() - new Date(imp.date).getTime()) / 86400000
    );
    const confidence = daysDiff === 0 ? 100 : daysDiff <= 1 ? 95 : 90;

    matches.push({
      importedTransactionId: imp.id,
      importedDescription: imp.description,
      importedDate: imp.date,
      importedAmount: imp.amount,
      stripeTransactionId: best.id,
      stripeJournalEntryId: best.journalEntryId!,
      stripeExternalTransactionId: best.externalTransactionId,
      stripeDate: best.date,
      confidence,
    });
  }

  return matches;
}

/**
 * GET /api/v1/bank-accounts/[id]/match-stripe-payouts
 *
 * Scans for unreconciled bank statement lines that correspond to Stripe payouts
 * already recorded in your books, returning candidate matches with high confidence.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request);
    requireRole(ctx, "manage:banking");

    const account = await db.query.bankAccount.findFirst({
      where: and(
        eq(bankAccount.id, id),
        eq(bankAccount.organizationId, ctx.organizationId),
        notDeleted(bankAccount.deletedAt)
      ),
    });

    if (!account) return notFound("Bank account");

    const [importedTxs, stripeTxs] = await Promise.all([
      db.query.bankTransaction.findMany({
        where: and(
          eq(bankTransaction.bankAccountId, id),
          eq(bankTransaction.status, "unreconciled"),
          ne(bankTransaction.sourceType, "stripe")
        ),
      }),
      db.query.bankTransaction.findMany({
        where: and(
          eq(bankTransaction.bankAccountId, id),
          eq(bankTransaction.sourceType, "stripe"),
          isNotNull(bankTransaction.journalEntryId)
        ),
      }),
    ]);

    const matches = findPayoutMatches(importedTxs, stripeTxs);

    return NextResponse.json({
      count: matches.length,
      matches,
    });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST /api/v1/bank-accounts/[id]/match-stripe-payouts
 *
 * Automatically links matching statement transactions to their Stripe journal entries,
 * copies the Stripe payout ID, marks them reconciled, and removes the duplicate synthetic rows.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request);
    requireRole(ctx, "manage:banking");

    const account = await db.query.bankAccount.findFirst({
      where: and(
        eq(bankAccount.id, id),
        eq(bankAccount.organizationId, ctx.organizationId),
        notDeleted(bankAccount.deletedAt)
      ),
    });

    if (!account) return notFound("Bank account");

    let transactionIds: string[] | undefined;
    try {
      const body = await request.json();
      if (body && Array.isArray(body.transactionIds)) {
        transactionIds = body.transactionIds;
      }
    } catch {
      // Body is optional
    }

    const [importedTxs, stripeTxs] = await Promise.all([
      db.query.bankTransaction.findMany({
        where: and(
          eq(bankTransaction.bankAccountId, id),
          eq(bankTransaction.status, "unreconciled"),
          ne(bankTransaction.sourceType, "stripe")
        ),
      }),
      db.query.bankTransaction.findMany({
        where: and(
          eq(bankTransaction.bankAccountId, id),
          eq(bankTransaction.sourceType, "stripe"),
          isNotNull(bankTransaction.journalEntryId)
        ),
      }),
    ]);

    let matches = findPayoutMatches(importedTxs, stripeTxs);

    if (transactionIds && transactionIds.length > 0) {
      const allowed = new Set(transactionIds);
      matches = matches.filter((m) => allowed.has(m.importedTransactionId));
    }

    if (matches.length === 0) {
      return NextResponse.json({ matched: 0, message: "No matching Stripe payouts found" });
    }

    // Process all matches atomically
    await db.transaction(async (tx) => {
      for (const m of matches) {
        // Transfer any payment pointers if any exist
        await tx
          .update(payment)
          .set({ bankTransactionId: m.importedTransactionId })
          .where(eq(payment.bankTransactionId, m.stripeTransactionId));

        // Update the imported statement transaction to be reconciled and link to Stripe journal entry
        await tx
          .update(bankTransaction)
          .set({
            status: "reconciled",
            journalEntryId: m.stripeJournalEntryId,
            externalTransactionId: m.stripeExternalTransactionId,
          })
          .where(eq(bankTransaction.id, m.importedTransactionId));

        // Delete the synthetic stripe placeholder
        await tx
          .delete(bankTransaction)
          .where(eq(bankTransaction.id, m.stripeTransactionId));
      }
    });

    await logAudit({
      ctx,
      action: "batch_match_stripe_payouts",
      entityType: "bank_account",
      entityId: id,
      changes: {
        matchedCount: matches.length,
        transactionIds: matches.map((m) => m.importedTransactionId),
      },
      request,
    });

    return NextResponse.json({
      matched: matches.length,
      message: `Successfully matched ${matches.length} Stripe payout${matches.length === 1 ? "" : "s"}`,
    });
  } catch (err) {
    return handleError(err);
  }
}
