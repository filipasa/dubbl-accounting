import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bankAccount, bankTransaction, bankStatementImport } from "@/lib/db/schema";
import { eq, and, desc, isNotNull } from "drizzle-orm";
import { getAuthContext } from "@/lib/api/auth-context";
import { requireRole } from "@/lib/api/require-role";
import { handleError } from "@/lib/api/response";
import { notDeleted } from "@/lib/db/soft-delete";

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext(request);
    requireRole(ctx, "manage:banking");

    const accounts = await db.query.bankAccount.findMany({
      where: and(
        eq(bankAccount.organizationId, ctx.organizationId),
        notDeleted(bankAccount.deletedAt)
      ),
    });

    const results: Array<{
      id: string;
      name: string;
      oldBalance: number;
      newBalance: number;
      updated: boolean;
      source?: string | null;
    }> = [];

    for (const acc of accounts) {
      const latestTxWithBalance = await db.query.bankTransaction.findFirst({
        where: and(
          eq(bankTransaction.bankAccountId, acc.id),
          isNotNull(bankTransaction.balance)
        ),
        orderBy: [desc(bankTransaction.date), desc(bankTransaction.createdAt)],
      });

      const lastImport = await db.query.bankStatementImport.findFirst({
        where: and(
          eq(bankStatementImport.bankAccountId, acc.id),
          isNotNull(bankStatementImport.closingBalance)
        ),
        orderBy: desc(bankStatementImport.createdAt),
      });

      let detectedBalance: number | null = null;
      let source: string | null = null;

      if (latestTxWithBalance?.balance != null) {
        detectedBalance = latestTxWithBalance.balance;
        source = `latest transaction (${latestTxWithBalance.date})`;
      } else if (lastImport?.closingBalance != null) {
        detectedBalance = lastImport.closingBalance;
        source = `statement import (${lastImport.fileName || "statement"})`;
      }

      if (detectedBalance != null && detectedBalance !== acc.balance) {
        await db
          .update(bankAccount)
          .set({ balance: detectedBalance })
          .where(eq(bankAccount.id, acc.id));

        results.push({
          id: acc.id,
          name: acc.accountName,
          oldBalance: acc.balance,
          newBalance: detectedBalance,
          updated: true,
          source,
        });
      } else {
        results.push({
          id: acc.id,
          name: acc.accountName,
          oldBalance: acc.balance,
          newBalance: acc.balance,
          updated: false,
        });
      }
    }

    return NextResponse.json({
      success: true,
      updatedCount: results.filter((r) => r.updated).length,
      accounts: results,
    });
  } catch (err) {
    return handleError(err);
  }
}
