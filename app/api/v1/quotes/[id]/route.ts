import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { quote, quoteLine } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getAuthContext } from "@/lib/api/auth-context";
import { requireRole } from "@/lib/api/require-role";
import { handleError, notFound } from "@/lib/api/response";
import { logAudit, diffChanges } from "@/lib/api/audit";
import { notDeleted, softDelete } from "@/lib/db/soft-delete";
import { decimalToMinorUnits } from "@/lib/money";
import { preloadTaxRates, calcTax } from "@/lib/api/tax-calculator";
import { currencyCodeSchema } from "@/lib/currency/zod";
import { z } from "zod";

const lineSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().default(1),
  unitPrice: z.number().default(0),
  accountId: z.string().nullable().optional(),
  taxRateId: z.string().nullable().optional(),
  discountPercent: z.number().int().min(0).max(10000).default(0),
  costCenterId: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  shortDescription: z.string().nullable().optional(),
});

const updateSchema = z.object({
  contactId: z.string().optional(),
  issueDate: z.string().optional(),
  expiryDate: z.string().optional(),
  reference: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  currencyCode: currencyCodeSchema.optional(),
  lines: z.array(lineSchema).min(1).optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request);

    const found = await db.query.quote.findFirst({
      where: and(
        eq(quote.id, id),
        eq(quote.organizationId, ctx.organizationId),
        notDeleted(quote.deletedAt)
      ),
      with: {
        contact: true,
        lines: {
          with: { account: true, taxRate: true },
        },
      },
    });

    if (!found) return notFound("Quote");
    return NextResponse.json({ quote: found });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request);
    requireRole(ctx, "manage:invoices");

    const existing = await db.query.quote.findFirst({
      where: and(
        eq(quote.id, id),
        eq(quote.organizationId, ctx.organizationId),
        notDeleted(quote.deletedAt)
      ),
    });

    if (!existing) return notFound("Quote");
    if (existing.status !== "draft") {
      return NextResponse.json(
        { error: "Only draft quotes can be edited" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const parsed = updateSchema.parse(body);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.contactId !== undefined) patch.contactId = parsed.contactId;
    if (parsed.issueDate !== undefined) patch.issueDate = parsed.issueDate;
    if (parsed.expiryDate !== undefined) patch.expiryDate = parsed.expiryDate;
    if (parsed.reference !== undefined) patch.reference = parsed.reference || null;
    if (parsed.notes !== undefined) patch.notes = parsed.notes || null;
    if (parsed.currencyCode !== undefined) patch.currencyCode = parsed.currencyCode;

    const targetCurrency = parsed.currencyCode || existing.currencyCode;

    if (parsed.lines) {
      const taxRateIds = parsed.lines
        .map((l) => l.taxRateId)
        .filter(Boolean) as string[];
      const ratesMap = await preloadTaxRates(taxRateIds);

      let subtotal = 0;
      const processedLines = parsed.lines.map((l, i) => {
        const grossAmount = decimalToMinorUnits(l.quantity * l.unitPrice, targetCurrency);
        const discountAmount = l.discountPercent
          ? Math.round((grossAmount * l.discountPercent) / 10000)
          : 0;
        const amount = grossAmount - discountAmount;
        subtotal += amount;
        const taxRateId = l.taxRateId || null;
        const taxAmount = taxRateId
          ? calcTax(amount, ratesMap.get(taxRateId) ?? 0)
          : 0;
        return {
          quoteId: id,
          description: l.description,
          quantity: Math.round(l.quantity * 100),
          unitPrice: decimalToMinorUnits(l.unitPrice, targetCurrency),
          accountId: l.accountId || null,
          taxRateId,
          discountPercent: l.discountPercent,
          taxAmount,
          amount,
          costCenterId: l.costCenterId || null,
          imageUrl: l.imageUrl || null,
          shortDescription: l.shortDescription || null,
          sortOrder: i,
        };
      });

      const taxTotal = processedLines.reduce((sum, l) => sum + l.taxAmount, 0);
      const total = subtotal + taxTotal;
      patch.subtotal = subtotal;
      patch.taxTotal = taxTotal;
      patch.total = total;

      await db.delete(quoteLine).where(eq(quoteLine.quoteId, id));
      await db.insert(quoteLine).values(processedLines);
    }

    const [updated] = await db
      .update(quote)
      .set(patch)
      .where(eq(quote.id, id))
      .returning();

    logAudit({ ctx, action: "update", entityType: "quote", entityId: id, changes: diffChanges(existing as Record<string, unknown>, updated as Record<string, unknown>), request });

    // Fetch the refreshed quote with lines and relations
    const fullQuote = await db.query.quote.findFirst({
      where: and(
        eq(quote.id, id),
        eq(quote.organizationId, ctx.organizationId),
        notDeleted(quote.deletedAt)
      ),
      with: {
        contact: true,
        lines: {
          with: { account: true, taxRate: true },
        },
      },
    });

    return NextResponse.json({ quote: fullQuote || updated });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request);
    requireRole(ctx, "manage:invoices");

    const existing = await db.query.quote.findFirst({
      where: and(
        eq(quote.id, id),
        eq(quote.organizationId, ctx.organizationId),
        notDeleted(quote.deletedAt)
      ),
    });

    if (!existing) return notFound("Quote");
    if (existing.status !== "draft") {
      return NextResponse.json(
        { error: "Only draft quotes can be deleted" },
        { status: 400 }
      );
    }

    await db.delete(quoteLine).where(eq(quoteLine.quoteId, id));
    await db.update(quote).set(softDelete()).where(eq(quote.id, id));

    logAudit({
      ctx,
      action: "delete",
      entityType: "quote",
      entityId: id,
      changes: existing as Record<string, unknown>,
      request,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleError(err);
  }
}
