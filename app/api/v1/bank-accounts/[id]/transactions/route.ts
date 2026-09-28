import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bankAccount, bankTransaction } from "@/lib/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { getAuthContext } from "@/lib/api/auth-context";
import { handleError, notFound } from "@/lib/api/response";
import { notDeleted } from "@/lib/db/soft-delete";
import { parsePagination, paginatedResponse } from "@/lib/api/pagination";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request);
    const url = new URL(request.url);
    const limitParam = url.searchParams.get("limit");
    const isAll = limitParam === "all";

    let limit: number | undefined;
    let offset: number | undefined;
    let page = 1;

    if (isAll) {
      limit = undefined;
      offset = undefined;
    } else if (limitParam) {
      const parsed = parseInt(limitParam);
      limit = isNaN(parsed) ? 50 : Math.min(10000, Math.max(1, parsed));
      page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
      offset = (page - 1) * limit;
    } else {
      // Default: if no limit is specified, return all so banking doesn't silently truncate
      limit = undefined;
      offset = undefined;
    }

    const status = url.searchParams.get("status");

    // Verify bank account belongs to organization
    const account = await db.query.bankAccount.findFirst({
      where: and(
        eq(bankAccount.id, id),
        eq(bankAccount.organizationId, ctx.organizationId),
        notDeleted(bankAccount.deletedAt)
      ),
    });

    if (!account) return notFound("Bank account");

    const conditions = [eq(bankTransaction.bankAccountId, id)];

    if (status) {
      conditions.push(
        eq(bankTransaction.status, status as typeof bankTransaction.status.enumValues[number])
      );
    }

    const rows = await db.query.bankTransaction.findMany({
      where: and(...conditions),
      orderBy: desc(bankTransaction.date),
      limit,
      offset,
      with: {
        import: true,
        // Linked ledger account (set when the transaction is categorized/matched);
        // used to surface the account code+name in the UI.
        account: {
          columns: { id: true, code: true, name: true },
        },
      },
    });

    // Flatten the linked account into accountCode/accountName while keeping the
    // existing fields (accountId, journalEntryId, reconciliationId are columns).
    const transactions = rows.map(({ account, ...tx }) => ({
      ...tx,
      accountCode: account?.code ?? null,
      accountName: account?.name ?? null,
    }));

    const [countResult] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(bankTransaction)
      .where(and(...conditions));

    const [summaryResult] = await db
      .select({
        total: sql<number>`count(*)`.mapWith(Number),
        unreconciled: sql<number>`count(*) filter (where ${bankTransaction.status} = 'unreconciled')`.mapWith(Number),
        reconciled: sql<number>`count(*) filter (where ${bankTransaction.status} = 'reconciled')`.mapWith(Number),
        excluded: sql<number>`count(*) filter (where ${bankTransaction.status} = 'excluded')`.mapWith(Number),
        credits: sql<number>`coalesce(sum(${bankTransaction.amount}) filter (where ${bankTransaction.amount} > 0 and ${bankTransaction.status} != 'excluded'), 0)`.mapWith(Number),
        debits: sql<number>`coalesce(sum(abs(${bankTransaction.amount})) filter (where ${bankTransaction.amount} < 0 and ${bankTransaction.status} != 'excluded'), 0)`.mapWith(Number),
      })
      .from(bankTransaction)
      .where(eq(bankTransaction.bankAccountId, id));

    return NextResponse.json({
      data: transactions,
      pagination: {
        page,
        limit: limit ?? transactions.length,
        total: Number(countResult?.count || 0),
        totalPages: limit ? Math.ceil(Number(countResult?.count || 0) / limit) : 1,
      },
      summary: summaryResult || {
        total: 0,
        unreconciled: 0,
        reconciled: 0,
        excluded: 0,
        credits: 0,
        debits: 0,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
