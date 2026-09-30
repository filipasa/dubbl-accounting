import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bankAccount, bankTransaction, bankStatementImport } from "@/lib/db/schema";
import { eq, and, desc, isNotNull } from "drizzle-orm";
import { getAuthContext } from "@/lib/api/auth-context";
import { requireRole } from "@/lib/api/require-role";
import { handleError, notFound } from "@/lib/api/response";
import { notDeleted } from "@/lib/db/soft-delete";
import { logAudit } from "@/lib/api/audit";

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

    // 1. Look for the latest transaction with a non-null balance
    const latestTxWithBalance = await db.query.bankTransaction.findFirst({
      where: and(
        eq(bankTransaction.bankAccountId, id),
        isNotNull(bankTransaction.balance)
      ),
      orderBy: [desc(bankTransaction.date), desc(bankTransaction.createdAt)],
    });

    // 2. Look for the latest statement import with closing balance
    const lastImport = await db.query.bankStatementImport.findFirst({
      where: and(
        eq(bankStatementImport.bankAccountId, id),
        isNotNull(bankStatementImport.closingBalance)
      ),
      orderBy: desc(bankStatementImport.createdAt),
    });

    let detectedBalance: number | null = null;
    let source: string | null = null;

    if (latestTxWithBalance?.balance != null) {
      detectedBalance = latestTxWithBalance.balance;
      source = `latest statement transaction on ${latestTxWithBalance.date}`;
    } else if (lastImport?.closingBalance != null) {
      detectedBalance = lastImport.closingBalance;
      source = `statement import (${lastImport.fileName || "statement"})`;
    }

    if (detectedBalance == null) {
      return NextResponse.json({
        success: false,
        balance: account.balance,
        message:
          "No running balance column found in imported statements. You can set the balance manually in settings.",
      });
    }

    const [updated] = await db
      .update(bankAccount)
      .set({ balance: detectedBalance })
      .where(eq(bankAccount.id, id))
      .returning();

    logAudit({
      ctx,
      action: "update",
      entityType: "bank_account",
      entityId: id,
      changes: {
        balance: { from: account.balance, to: detectedBalance },
        syncSource: source,
      },
      request,
    });

    return NextResponse.json({
      success: true,
      bankAccount: updated,
      balance: detectedBalance,
      source,
      message: `Balance synced to ${(detectedBalance / 100).toFixed(2)} from ${source}.`,
    });
  } catch (err) {
    return handleError(err);
  }
}
