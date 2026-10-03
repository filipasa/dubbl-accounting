import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { journalEntry, journalLine, chartAccount } from "@/lib/db/schema";
import { eq, and, isNull, gte, lte, sql } from "drizzle-orm";
import { getAuthContext } from "@/lib/api/auth-context";
import { handleError } from "@/lib/api/response";

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatDayLabel(d: Date): string {
  return `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`;
}

function formatMonthLabel(year: number, monthZeroIndexed: number): string {
  return `${MONTH_NAMES[monthZeroIndexed]} ${year}`;
}

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext(request);
    const url = new URL(request.url);

    let startDateParam = url.searchParams.get("startDate");
    let endDateParam = url.searchParams.get("endDate");
    const periodParam = url.searchParams.get("period");
    const monthsParam = url.searchParams.get("months");

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    // If all_time is selected or startDate is before 2010, resolve the earliest real transaction
    if (periodParam === "all_time" || (startDateParam && startDateParam < "2010-01-01")) {
      const [earliest] = await db
        .select({
          minDate: sql<string>`MIN(${journalEntry.date})`,
        })
        .from(journalEntry)
        .where(
          and(
            eq(journalEntry.organizationId, ctx.organizationId),
            eq(journalEntry.status, "posted"),
            isNull(journalEntry.deletedAt)
          )
        );

      if (earliest?.minDate) {
        startDateParam = earliest.minDate.slice(0, 10);
      } else {
        const fallback = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 5, 1));
        startDateParam = fallback.toISOString().slice(0, 10);
      }
    }

    // Default to last 6 months if no dates were provided
    if (!startDateParam || !endDateParam) {
      const months = Math.min(parseInt(monthsParam || "6", 10), 24);
      const startMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth() - months + 1, 1));
      startDateParam = startMonth.toISOString().slice(0, 10);
      endDateParam = todayStr;
    }

    const start = new Date(`${startDateParam}T00:00:00Z`);
    const end = new Date(`${endDateParam}T23:59:59Z`);
    const diffMs = end.getTime() - start.getTime();
    const diffDays = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1);

    // Case 1: Granularity <= 31 days (daily breakdown, e.g. This Month, Last Month, short custom)
    if (diffDays <= 31) {
      // Single day case: generate 2 points (Start of Day £0 -> End of Day total)
      if (diffDays === 1) {
        const rows = await db
          .select({
            type: chartAccount.type,
            debit: sql<number>`COALESCE(SUM(${journalLine.debitAmount}), 0)`,
            credit: sql<number>`COALESCE(SUM(${journalLine.creditAmount}), 0)`,
          })
          .from(journalLine)
          .innerJoin(journalEntry, eq(journalLine.journalEntryId, journalEntry.id))
          .innerJoin(chartAccount, eq(journalLine.accountId, chartAccount.id))
          .where(
            and(
              eq(journalEntry.organizationId, ctx.organizationId),
              eq(journalEntry.status, "posted"),
              isNull(journalEntry.deletedAt),
              gte(journalEntry.date, startDateParam),
              lte(journalEntry.date, endDateParam),
              sql`${chartAccount.type} IN ('revenue', 'expense')`
            )
          )
          .groupBy(chartAccount.type);

        let dayRev = 0;
        let dayExp = 0;
        for (const row of rows) {
          const debit = Number(row.debit);
          const credit = Number(row.credit);
          if (row.type === "revenue") dayRev += credit - debit;
          else if (row.type === "expense") dayExp += debit - credit;
        }

        const trend = [
          {
            month: `${startDateParam}-start`,
            label: "Start of Day",
            revenue: 0,
            expenses: 0,
            netIncome: 0,
          },
          {
            month: `${startDateParam}-end`,
            label: formatDayLabel(start),
            revenue: dayRev,
            expenses: dayExp,
            netIncome: dayRev - dayExp,
          },
        ];

        return NextResponse.json({
          months: trend,
          revenueSparkline: trend.map((t) => t.revenue),
          expenseSparkline: trend.map((t) => t.expenses),
          netIncomeSparkline: trend.map((t) => t.netIncome),
        });
      }

      // Multi-day <= 31 days: bucket per day
      const buckets: { key: string; label: string; revenue: number; expenses: number }[] = [];
      const bucketMap = new Map<string, typeof buckets[0]>();

      const cur = new Date(start);
      while (cur <= end) {
        const key = cur.toISOString().slice(0, 10);
        const item = {
          key,
          label: formatDayLabel(cur),
          revenue: 0,
          expenses: 0,
        };
        buckets.push(item);
        bucketMap.set(key, item);
        cur.setUTCDate(cur.getUTCDate() + 1);
      }

      const rows = await db
        .select({
          dateKey: sql<string>`TO_CHAR(${journalEntry.date}::date, 'YYYY-MM-DD')`.as("date_key"),
          type: chartAccount.type,
          debit: sql<number>`COALESCE(SUM(${journalLine.debitAmount}), 0)`,
          credit: sql<number>`COALESCE(SUM(${journalLine.creditAmount}), 0)`,
        })
        .from(journalLine)
        .innerJoin(journalEntry, eq(journalLine.journalEntryId, journalEntry.id))
        .innerJoin(chartAccount, eq(journalLine.accountId, chartAccount.id))
        .where(
          and(
            eq(journalEntry.organizationId, ctx.organizationId),
            eq(journalEntry.status, "posted"),
            isNull(journalEntry.deletedAt),
            gte(journalEntry.date, startDateParam),
            lte(journalEntry.date, endDateParam),
            sql`${chartAccount.type} IN ('revenue', 'expense')`
          )
        )
        .groupBy(
          sql`TO_CHAR(${journalEntry.date}::date, 'YYYY-MM-DD')`,
          chartAccount.type
        );

      for (const row of rows) {
        const existing = bucketMap.get(row.dateKey);
        if (!existing) continue;
        const debit = Number(row.debit);
        const credit = Number(row.credit);
        if (row.type === "revenue") existing.revenue += credit - debit;
        else if (row.type === "expense") existing.expenses += debit - credit;
      }

      const trend = buckets.map((b) => ({
        month: b.key,
        label: b.label,
        revenue: b.revenue,
        expenses: b.expenses,
        netIncome: b.revenue - b.expenses,
      }));

      return NextResponse.json({
        months: trend,
        revenueSparkline: trend.map((t) => t.revenue),
        expenseSparkline: trend.map((t) => t.expenses),
        netIncomeSparkline: trend.map((t) => t.netIncome),
      });
    }

    // Case 2: 31 < diffDays <= 93 (weekly breakdown, e.g. This Quarter, Last Quarter)
    if (diffDays <= 93) {
      interface WeekBucket {
        key: string;
        label: string;
        startDate: string;
        endDate: string;
        revenue: number;
        expenses: number;
      }
      const weekBuckets: WeekBucket[] = [];

      let curStart = new Date(start);
      while (curStart <= end) {
        let curEnd = new Date(curStart);
        curEnd.setUTCDate(curEnd.getUTCDate() + 6);
        if (curEnd > end) {
          curEnd = new Date(end);
        }

        const sStr = curStart.toISOString().slice(0, 10);
        const eStr = curEnd.toISOString().slice(0, 10);
        const label = `${curStart.getUTCDate()} ${MONTH_NAMES[curStart.getUTCMonth()]} – ${curEnd.getUTCDate()} ${MONTH_NAMES[curEnd.getUTCMonth()]}`;

        weekBuckets.push({
          key: `${sStr}_${eStr}`,
          label,
          startDate: sStr,
          endDate: eStr,
          revenue: 0,
          expenses: 0,
        });

        curStart.setUTCDate(curStart.getUTCDate() + 7);
      }

      const rows = await db
        .select({
          dateKey: sql<string>`TO_CHAR(${journalEntry.date}::date, 'YYYY-MM-DD')`.as("date_key"),
          type: chartAccount.type,
          debit: sql<number>`COALESCE(SUM(${journalLine.debitAmount}), 0)`,
          credit: sql<number>`COALESCE(SUM(${journalLine.creditAmount}), 0)`,
        })
        .from(journalLine)
        .innerJoin(journalEntry, eq(journalLine.journalEntryId, journalEntry.id))
        .innerJoin(chartAccount, eq(journalLine.accountId, chartAccount.id))
        .where(
          and(
            eq(journalEntry.organizationId, ctx.organizationId),
            eq(journalEntry.status, "posted"),
            isNull(journalEntry.deletedAt),
            gte(journalEntry.date, startDateParam),
            lte(journalEntry.date, endDateParam),
            sql`${chartAccount.type} IN ('revenue', 'expense')`
          )
        )
        .groupBy(
          sql`TO_CHAR(${journalEntry.date}::date, 'YYYY-MM-DD')`,
          chartAccount.type
        );

      for (const row of rows) {
        const bucket = weekBuckets.find(
          (b) => row.dateKey >= b.startDate && row.dateKey <= b.endDate
        );
        if (!bucket) continue;
        const debit = Number(row.debit);
        const credit = Number(row.credit);
        if (row.type === "revenue") bucket.revenue += credit - debit;
        else if (row.type === "expense") bucket.expenses += debit - credit;
      }

      const trend = weekBuckets.map((b) => ({
        month: b.key,
        label: b.label,
        revenue: b.revenue,
        expenses: b.expenses,
        netIncome: b.revenue - b.expenses,
      }));

      return NextResponse.json({
        months: trend,
        revenueSparkline: trend.map((t) => t.revenue),
        expenseSparkline: trend.map((t) => t.expenses),
        netIncomeSparkline: trend.map((t) => t.netIncome),
      });
    }

    // Case 3: diffDays > 93 (monthly breakdown, e.g. YTD, Last 12 Months, Last Year, All Time)
    let curMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    const stopMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));

    const monthBuckets: { key: string; label: string; revenue: number; expenses: number }[] = [];
    const monthMap = new Map<string, typeof monthBuckets[0]>();

    while (curMonth <= stopMonth) {
      const y = curMonth.getUTCFullYear();
      const m = curMonth.getUTCMonth();
      const key = `${y}-${String(m + 1).padStart(2, "0")}`;
      const label = formatMonthLabel(y, m);

      const item = {
        key,
        label,
        revenue: 0,
        expenses: 0,
      };
      monthBuckets.push(item);
      monthMap.set(key, item);

      curMonth.setUTCMonth(curMonth.getUTCMonth() + 1);
    }

    const rows = await db
      .select({
        monthKey: sql<string>`TO_CHAR(${journalEntry.date}::date, 'YYYY-MM')`.as("month_key"),
        type: chartAccount.type,
        debit: sql<number>`COALESCE(SUM(${journalLine.debitAmount}), 0)`,
        credit: sql<number>`COALESCE(SUM(${journalLine.creditAmount}), 0)`,
      })
      .from(journalLine)
      .innerJoin(journalEntry, eq(journalLine.journalEntryId, journalEntry.id))
      .innerJoin(chartAccount, eq(journalLine.accountId, chartAccount.id))
      .where(
        and(
          eq(journalEntry.organizationId, ctx.organizationId),
          eq(journalEntry.status, "posted"),
          isNull(journalEntry.deletedAt),
          gte(journalEntry.date, startDateParam),
          lte(journalEntry.date, endDateParam),
          sql`${chartAccount.type} IN ('revenue', 'expense')`
        )
      )
      .groupBy(
        sql`TO_CHAR(${journalEntry.date}::date, 'YYYY-MM')`,
        chartAccount.type
      )
      .orderBy(sql`month_key`);

    for (const row of rows) {
      const existing = monthMap.get(row.monthKey);
      if (!existing) continue;
      const debit = Number(row.debit);
      const credit = Number(row.credit);
      if (row.type === "revenue") existing.revenue += credit - debit;
      else if (row.type === "expense") existing.expenses += debit - credit;
    }

    // If more than 36 months, roll into quarters to keep the curve sleek and clean
    let finalBuckets = monthBuckets;
    if (monthBuckets.length > 36) {
      const quarterMap = new Map<string, { key: string; label: string; revenue: number; expenses: number }>();
      for (const mb of monthBuckets) {
        const [yearStr, monthStr] = mb.key.split("-");
        const m = parseInt(monthStr, 10);
        const q = Math.floor((m - 1) / 3) + 1;
        const qKey = `${yearStr}-Q${q}`;
        const qLabel = `Q${q} ${yearStr}`;

        let qBucket = quarterMap.get(qKey);
        if (!qBucket) {
          qBucket = { key: qKey, label: qLabel, revenue: 0, expenses: 0 };
          quarterMap.set(qKey, qBucket);
        }
        qBucket.revenue += mb.revenue;
        qBucket.expenses += mb.expenses;
      }
      finalBuckets = Array.from(quarterMap.values());
    }

    const trend = finalBuckets.map((b) => ({
      month: b.key,
      label: b.label,
      revenue: b.revenue,
      expenses: b.expenses,
      netIncome: b.revenue - b.expenses,
    }));

    return NextResponse.json({
      months: trend,
      revenueSparkline: trend.map((t) => t.revenue),
      expenseSparkline: trend.map((t) => t.expenses),
      netIncomeSparkline: trend.map((t) => t.netIncome),
    });
  } catch (err) {
    return handleError(err);
  }
}
