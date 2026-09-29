import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { journalEntry, journalLine } from "@/lib/db/schema";
import { and, eq, sql, desc, asc, isNull, or, ilike, gte, lte } from "drizzle-orm";
import { getAuthContext } from "@/lib/api/auth-context";
import { handleError } from "@/lib/api/response";
import { logAudit } from "@/lib/api/audit";
import { centsToDecimal } from "@/lib/money";
import { assertNotLocked } from "@/lib/api/period-lock";
import { checkMonthlyLimit } from "@/lib/api/check-limit";
import { parsePagination } from "@/lib/api/pagination";
import { z } from "zod";
import { currencyCodeSchema } from "@/lib/currency/zod";

const lineSchema = z.object({
  accountId: z.string().min(1),
  description: z.string().nullable().optional(),
  debitAmount: z.number().int().min(0).default(0),
  creditAmount: z.number().int().min(0).default(0),
  currencyCode: currencyCodeSchema.default("USD"),
  exchangeRate: z.number().int().default(1000000),
});

const createSchema = z.object({
  date: z.string().min(1),
  description: z.string().min(1),
  reference: z.string().nullable().optional(),
  fiscalYearId: z.string().nullable().optional(),
  // If set, a scheduled job posts a mirror reversing entry on this date
  // (accruals / prepayments). Must be on or after the entry date.
  autoReverseDate: z.string().nullable().optional(),
  lines: z.array(lineSchema).min(2),
});

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext(request);
    const url = new URL(request.url);
    const { page, limit, offset } = parsePagination(url, 250);

    const status = url.searchParams.get("status");
    const search = url.searchParams.get("search") || url.searchParams.get("q");
    const startDate = url.searchParams.get("from") || url.searchParams.get("startDate");
    const endDate = url.searchParams.get("to") || url.searchParams.get("endDate");
    const sortBy = url.searchParams.get("sortBy") || "date";
    const sortOrder = url.searchParams.get("sortOrder") || "desc";

    const conditions = [
      eq(journalEntry.organizationId, ctx.organizationId),
      isNull(journalEntry.deletedAt),
    ];

    if (status && status !== "all") {
      conditions.push(eq(journalEntry.status, status as "draft" | "posted" | "void"));
    }

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      conditions.push(
        or(
          ilike(journalEntry.description, q),
          ilike(journalEntry.reference, q),
          sql`${journalEntry.entryNumber}::text ILIKE ${q}`
        )!
      );
    }

    if (startDate) {
      conditions.push(gte(journalEntry.date, startDate));
    }

    if (endDate) {
      conditions.push(lte(journalEntry.date, endDate));
    }

    // Determine order clause
    let orderByClause;
    const isAsc = sortOrder === "asc";
    if (sortBy === "number" || sortBy === "entryNumber") {
      orderByClause = isAsc ? [asc(journalEntry.entryNumber)] : [desc(journalEntry.entryNumber)];
    } else if (sortBy === "amount") {
      orderByClause = isAsc
        ? [asc(sql`coalesce(sum(${journalLine.debitAmount}), 0)`)]
        : [desc(sql`coalesce(sum(${journalLine.debitAmount}), 0)`)];
    } else if (sortBy === "createdAt") {
      orderByClause = isAsc ? [asc(journalEntry.createdAt)] : [desc(journalEntry.createdAt)];
    } else {
      // Default: date desc, entryNumber desc
      orderByClause = isAsc
        ? [asc(journalEntry.date), asc(journalEntry.entryNumber)]
        : [desc(journalEntry.date), desc(journalEntry.entryNumber)];
    }

    // Query paginated entries with summed debits in a single query
    const rows = await db
      .select({
        id: journalEntry.id,
        organizationId: journalEntry.organizationId,
        entryNumber: journalEntry.entryNumber,
        date: journalEntry.date,
        description: journalEntry.description,
        reference: journalEntry.reference,
        status: journalEntry.status,
        fiscalYearId: journalEntry.fiscalYearId,
        sourceType: journalEntry.sourceType,
        sourceId: journalEntry.sourceId,
        createdBy: journalEntry.createdBy,
        postedAt: journalEntry.postedAt,
        voidedAt: journalEntry.voidedAt,
        voidReason: journalEntry.voidReason,
        autoReverseDate: journalEntry.autoReverseDate,
        reversedByEntryId: journalEntry.reversedByEntryId,
        reversesEntryId: journalEntry.reversesEntryId,
        createdAt: journalEntry.createdAt,
        updatedAt: journalEntry.updatedAt,
        totalDebitCents: sql<number>`coalesce(sum(${journalLine.debitAmount}), 0)`.mapWith(Number),
      })
      .from(journalEntry)
      .leftJoin(journalLine, eq(journalLine.journalEntryId, journalEntry.id))
      .where(and(...conditions))
      .groupBy(journalEntry.id)
      .orderBy(...orderByClause)
      .limit(limit)
      .offset(offset);

    // Get total matching count
    const [countResult] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(journalEntry)
      .where(and(...conditions));
    const total = Number(countResult?.count || 0);

    // Get organization-wide summary stats (status counts & total posted debits)
    const statusCountsRaw = await db
      .select({
        status: journalEntry.status,
        count: sql<number>`count(distinct ${journalEntry.id})`.mapWith(Number),
        totalDebit: sql<number>`coalesce(sum(${journalLine.debitAmount}), 0)`.mapWith(Number),
      })
      .from(journalEntry)
      .leftJoin(journalLine, eq(journalLine.journalEntryId, journalEntry.id))
      .where(
        and(
          eq(journalEntry.organizationId, ctx.organizationId),
          isNull(journalEntry.deletedAt)
        )
      )
      .groupBy(journalEntry.status);

    let postedCount = 0;
    let draftCount = 0;
    let voidCount = 0;
    let totalPostedDebitCents = 0;

    for (const row of statusCountsRaw) {
      if (row.status === "posted") {
        postedCount = row.count;
        totalPostedDebitCents = row.totalDebit;
      } else if (row.status === "draft") {
        draftCount = row.count;
      } else if (row.status === "void") {
        voidCount = row.count;
      }
    }
    const allCount = postedCount + draftCount + voidCount;

    const result = rows.map((e) => {
      const { totalDebitCents, ...rest } = e;
      return {
        ...rest,
        totalDebit: centsToDecimal(totalDebitCents),
      };
    });

    return NextResponse.json({
      entries: result,
      total,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
      summary: {
        totalPostedDebit: centsToDecimal(totalPostedDebitCents),
        totalPostedCents: totalPostedDebitCents,
        counts: {
          all: allCount,
          posted: postedCount,
          draft: draftCount,
          void: voidCount,
        },
      },
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext(request);

    const body = await request.json();
    const parsed = createSchema.parse(body);

    await assertNotLocked(ctx.organizationId, parsed.date);
    await checkMonthlyLimit(ctx.organizationId, journalEntry, journalEntry.organizationId, journalEntry.createdAt, "entriesPerMonth");

    // Validate balance. A single-currency entry must balance in its own
    // amounts. A multi-currency entry (lines in different currencies, or any
    // non-1.0 exchange rate) must balance in BASE currency — comparing raw
    // amounts across currencies is meaningless and would let an unbalanced
    // entry post.
    const totalDebit = parsed.lines.reduce((sum, l) => sum + l.debitAmount, 0);
    const totalCredit = parsed.lines.reduce((sum, l) => sum + l.creditAmount, 0);
    const firstCurrency = parsed.lines[0]?.currencyCode;
    const isMultiCurrency = parsed.lines.some(
      (l) => l.currencyCode !== firstCurrency || l.exchangeRate !== 1_000_000
    );
    if (!isMultiCurrency) {
      if (totalDebit !== totalCredit) {
        return NextResponse.json(
          { error: "Debits must equal credits" },
          { status: 400 }
        );
      }
    } else {
      const toBase = (amount: number, rate: number) =>
        Math.round((amount * rate) / 1_000_000);
      const baseDebit = parsed.lines.reduce((s, l) => s + toBase(l.debitAmount, l.exchangeRate), 0);
      const baseCredit = parsed.lines.reduce((s, l) => s + toBase(l.creditAmount, l.exchangeRate), 0);
      // Allow up to one cent of per-line rounding slack.
      if (Math.abs(baseDebit - baseCredit) > parsed.lines.length) {
        return NextResponse.json(
          { error: "In your base currency, total debits must equal total credits." },
          { status: 400 }
        );
      }
    }
    if (totalDebit === 0) {
      return NextResponse.json(
        { error: "Entry must have non-zero amounts" },
        { status: 400 }
      );
    }

    // An auto-reversal must fall on or after the original entry's date.
    if (parsed.autoReverseDate && parsed.autoReverseDate < parsed.date) {
      return NextResponse.json(
        { error: "Auto-reverse date must be on or after the entry date" },
        { status: 400 }
      );
    }

    // Get next entry number
    const [maxResult] = await db
      .select({ max: sql<number>`coalesce(max(${journalEntry.entryNumber}), 0)` })
      .from(journalEntry)
      .where(eq(journalEntry.organizationId, ctx.organizationId));

    const entryNumber = (maxResult?.max || 0) + 1;

    const [entry] = await db
      .insert(journalEntry)
      .values({
        organizationId: ctx.organizationId,
        entryNumber,
        date: parsed.date,
        description: parsed.description,
        reference: parsed.reference || null,
        fiscalYearId: parsed.fiscalYearId || null,
        autoReverseDate: parsed.autoReverseDate || null,
        createdBy: ctx.userId,
      })
      .returning();

    // Insert lines
    await db.insert(journalLine).values(
      parsed.lines.map((l) => ({
        journalEntryId: entry.id,
        accountId: l.accountId,
        description: l.description || null,
        debitAmount: l.debitAmount,
        creditAmount: l.creditAmount,
        currencyCode: l.currencyCode,
        exchangeRate: l.exchangeRate,
      }))
    );

    logAudit({ ctx, action: "create", entityType: "journal_entry", entityId: entry.id, request });

    return NextResponse.json({ entry }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
