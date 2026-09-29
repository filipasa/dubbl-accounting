import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  invoice,
  quote,
  creditNote,
  payment,
  bill,
  stripeEntityMap,
  journalEntry,
} from "@/lib/db/schema";
import { eq, and, gte, lte, lt, desc, sql } from "drizzle-orm";
import { getAuthContext } from "@/lib/api/auth-context";
import { handleError } from "@/lib/api/response";
import { notDeleted } from "@/lib/db/soft-delete";

type ActivityItem = {
  id: string;
  type: "invoice" | "quote" | "credit_note" | "payment" | "bill" | "stripe_charge";
  number: string;
  status: string;
  amount: number;
  currencyCode: string;
  date: string;
  createdAt: string;
};

const ALL_TYPES = ["invoice", "quote", "credit_note", "payment", "bill", "stripe_charge"] as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request);
    const url = new URL(request.url);

    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "30")));
    const cursor = url.searchParams.get("cursor");
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const typeFilter = url.searchParams.get("type");

    const types = typeFilter
      ? typeFilter.split(",").filter((t) => (ALL_TYPES as readonly string[]).includes(t))
      : [...ALL_TYPES];

    // Fetch limit+1 from each type (for cursor detection), then merge and slice
    const fetchLimit = limit + 1;
    const cursorDate = cursor ? new Date(cursor) : null;

    const results = await Promise.all([
      types.includes("invoice")
        ? db.query.invoice.findMany({
            where: and(
              eq(invoice.contactId, id),
              eq(invoice.organizationId, ctx.organizationId),
              notDeleted(invoice.deletedAt),
              ...(startDate ? [gte(invoice.issueDate, startDate)] : []),
              ...(endDate ? [lte(invoice.issueDate, endDate)] : []),
              ...(cursorDate ? [lt(invoice.createdAt, cursorDate)] : []),
            ),
            orderBy: (t, { desc }) => [desc(t.createdAt)],
            limit: fetchLimit,
            columns: { id: true, invoiceNumber: true, status: true, total: true, currencyCode: true, issueDate: true, createdAt: true },
          }).then((rows) => rows.map((r): ActivityItem => ({
            id: r.id, type: "invoice", number: r.invoiceNumber, status: r.status,
            amount: r.total, currencyCode: r.currencyCode, date: r.issueDate,
            createdAt: r.createdAt.toISOString(),
          })))
        : [],

      types.includes("quote")
        ? db.query.quote.findMany({
            where: and(
              eq(quote.contactId, id),
              eq(quote.organizationId, ctx.organizationId),
              notDeleted(quote.deletedAt),
              ...(startDate ? [gte(quote.issueDate, startDate)] : []),
              ...(endDate ? [lte(quote.issueDate, endDate)] : []),
              ...(cursorDate ? [lt(quote.createdAt, cursorDate)] : []),
            ),
            orderBy: (t, { desc }) => [desc(t.createdAt)],
            limit: fetchLimit,
            columns: { id: true, quoteNumber: true, status: true, total: true, currencyCode: true, issueDate: true, createdAt: true },
          }).then((rows) => rows.map((r): ActivityItem => ({
            id: r.id, type: "quote", number: r.quoteNumber, status: r.status,
            amount: r.total, currencyCode: r.currencyCode, date: r.issueDate,
            createdAt: r.createdAt.toISOString(),
          })))
        : [],

      types.includes("credit_note")
        ? db.query.creditNote.findMany({
            where: and(
              eq(creditNote.contactId, id),
              eq(creditNote.organizationId, ctx.organizationId),
              notDeleted(creditNote.deletedAt),
              ...(startDate ? [gte(creditNote.issueDate, startDate)] : []),
              ...(endDate ? [lte(creditNote.issueDate, endDate)] : []),
              ...(cursorDate ? [lt(creditNote.createdAt, cursorDate)] : []),
            ),
            orderBy: (t, { desc }) => [desc(t.createdAt)],
            limit: fetchLimit,
            columns: { id: true, creditNoteNumber: true, status: true, total: true, currencyCode: true, issueDate: true, createdAt: true },
          }).then((rows) => rows.map((r): ActivityItem => ({
            id: r.id, type: "credit_note", number: r.creditNoteNumber, status: r.status,
            amount: r.total, currencyCode: r.currencyCode, date: r.issueDate,
            createdAt: r.createdAt.toISOString(),
          })))
        : [],

      types.includes("payment")
        ? db.query.payment.findMany({
            where: and(
              eq(payment.contactId, id),
              eq(payment.organizationId, ctx.organizationId),
              notDeleted(payment.deletedAt),
              ...(startDate ? [gte(payment.date, startDate)] : []),
              ...(endDate ? [lte(payment.date, endDate)] : []),
              ...(cursorDate ? [lt(payment.createdAt, cursorDate)] : []),
            ),
            orderBy: (t, { desc }) => [desc(t.createdAt)],
            limit: fetchLimit,
            columns: { id: true, paymentNumber: true, type: true, amount: true, currencyCode: true, date: true, createdAt: true },
          }).then((rows) => rows.map((r): ActivityItem => ({
            id: r.id, type: "payment", number: r.paymentNumber, status: r.type,
            amount: r.amount, currencyCode: r.currencyCode, date: r.date,
            createdAt: r.createdAt.toISOString(),
          })))
        : [],

      types.includes("bill")
        ? db.query.bill.findMany({
            where: and(
              eq(bill.contactId, id),
              eq(bill.organizationId, ctx.organizationId),
              notDeleted(bill.deletedAt),
              ...(startDate ? [gte(bill.issueDate, startDate)] : []),
              ...(endDate ? [lte(bill.issueDate, endDate)] : []),
              ...(cursorDate ? [lt(bill.createdAt, cursorDate)] : []),
            ),
            orderBy: (t, { desc }) => [desc(t.createdAt)],
            limit: fetchLimit,
            columns: { id: true, billNumber: true, status: true, total: true, currencyCode: true, issueDate: true, createdAt: true },
          }).then((rows) => rows.map((r): ActivityItem => ({
            id: r.id, type: "bill", number: r.billNumber, status: r.status,
            amount: r.total, currencyCode: r.currencyCode, date: r.issueDate,
            createdAt: r.createdAt.toISOString(),
          })))
        : [],

      types.includes("stripe_charge")
        ? db
            .select({
              dubblEntityId: stripeEntityMap.dubblEntityId,
              stripeEntityId: stripeEntityMap.stripeEntityId,
              metadata: stripeEntityMap.metadata,
              createdAt: stripeEntityMap.createdAt,
              entryNumber: journalEntry.entryNumber,
              entryStatus: journalEntry.status,
              entryDate: journalEntry.date,
            })
            .from(stripeEntityMap)
            .leftJoin(
              journalEntry,
              and(
                eq(stripeEntityMap.dubblEntityId, journalEntry.id),
                notDeleted(journalEntry.deletedAt)
              )
            )
            .where(
              and(
                eq(stripeEntityMap.organizationId, ctx.organizationId),
                eq(stripeEntityMap.stripeEntityType, "charge"),
                sql`${stripeEntityMap.metadata}->>'contactId' = ${id}`,
                ...(cursorDate ? [lt(stripeEntityMap.createdAt, cursorDate)] : []),
                ...(startDate ? [gte(journalEntry.date, startDate)] : []),
                ...(endDate ? [lte(journalEntry.date, endDate)] : [])
              )
            )
            .orderBy(desc(stripeEntityMap.createdAt))
            .limit(fetchLimit)
            .then((rows) =>
              rows.map((r): ActivityItem => {
                const meta = (r.metadata as Record<string, unknown>) || {};
                const amount = typeof meta.amount === "number" ? meta.amount : 0;
                const currency = typeof meta.currency === "string" ? meta.currency : "GBP";
                const dateStr = r.entryDate
                  ? typeof r.entryDate === "string"
                    ? r.entryDate
                    : (r.entryDate as Date).toISOString().slice(0, 10)
                  : r.createdAt.toISOString().slice(0, 10);
                return {
                  id: r.dubblEntityId,
                  type: "stripe_charge",
                  number: r.stripeEntityId,
                  status: r.entryStatus || "posted",
                  amount,
                  currencyCode: currency,
                  date: dateStr,
                  createdAt: r.createdAt.toISOString(),
                };
              })
            )
        : [],
    ]);

    // Merge all, sort by createdAt desc, take limit+1
    const merged = results.flat().sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const hasMore = merged.length > limit;
    const items = merged.slice(0, limit);
    const nextCursor = hasMore && items.length > 0
      ? items[items.length - 1].createdAt
      : null;

    return NextResponse.json({ activity: items, nextCursor, hasMore });
  } catch (err) {
    return handleError(err);
  }
}
