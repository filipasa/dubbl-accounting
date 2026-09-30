import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bankAccount } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getAuthContext } from "@/lib/api/auth-context";
import { requireRole } from "@/lib/api/require-role";
import { handleError, notFound } from "@/lib/api/response";
import { logAudit, diffChanges } from "@/lib/api/audit";
import { notDeleted, softDelete } from "@/lib/db/soft-delete";
import { z } from "zod";
import { currencyCodeSchema } from "@/lib/currency/zod";

const updateSchema = z.object({
  accountName: z.string().min(1).optional(),
  accountNumber: z.string().nullable().optional(),
  bankName: z.string().nullable().optional(),
  currencyCode: currencyCodeSchema.optional(),
  countryCode: z.string().length(2).nullable().optional(),
  accountType: z
    .enum(["checking", "savings", "credit_card", "cash", "loan", "investment", "other"])
    .optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  chartAccountId: z.string().nullable().optional(),
  balance: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

import { stripeFinancialAccount } from "@/lib/db/schema/integrations";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request);

    const found = await db.query.bankAccount.findFirst({
      where: and(
        eq(bankAccount.id, id),
        eq(bankAccount.organizationId, ctx.organizationId),
        notDeleted(bankAccount.deletedAt)
      ),
      with: { chartAccount: true },
    });

    if (!found) return notFound("Bank account");

    const [activeFeed] = await db
      .select()
      .from(stripeFinancialAccount)
      .where(
        and(
          eq(stripeFinancialAccount.bankAccountId, id),
          eq(stripeFinancialAccount.organizationId, ctx.organizationId),
          eq(stripeFinancialAccount.status, "active")
        )
      )
      .limit(1);

    return NextResponse.json({
      bankAccount: {
        ...found,
        feed: activeFeed
          ? {
              id: activeFeed.id,
              stripeAccountId: activeFeed.stripeAccountId,
              institutionName: activeFeed.institutionName,
              displayName: activeFeed.displayName,
              last4: activeFeed.last4,
              currency: activeFeed.currency,
              status: activeFeed.status,
              lastSyncAt: activeFeed.lastSyncAt ? activeFeed.lastSyncAt.toISOString() : null,
              lastSyncTxnCount: activeFeed.lastSyncTxnCount,
              errorMessage: activeFeed.errorMessage,
            }
          : null,
      },
    });
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
    requireRole(ctx, "manage:banking");

    const existing = await db.query.bankAccount.findFirst({
      where: and(
        eq(bankAccount.id, id),
        eq(bankAccount.organizationId, ctx.organizationId),
        notDeleted(bankAccount.deletedAt)
      ),
    });

    if (!existing) return notFound("Bank account");

    const body = await request.json();
    const parsed = updateSchema.parse(body);

    const [updated] = await db
      .update(bankAccount)
      .set(parsed)
      .where(eq(bankAccount.id, id))
      .returning();

    logAudit({ ctx, action: "update", entityType: "bank_account", entityId: id, changes: diffChanges(existing as Record<string, unknown>, updated as Record<string, unknown>), request });

    return NextResponse.json({ bankAccount: updated });
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
    requireRole(ctx, "manage:banking");

    const existing = await db.query.bankAccount.findFirst({
      where: and(
        eq(bankAccount.id, id),
        eq(bankAccount.organizationId, ctx.organizationId),
        notDeleted(bankAccount.deletedAt)
      ),
    });

    if (!existing) return notFound("Bank account");

    await db
      .update(bankAccount)
      .set(softDelete())
      .where(eq(bankAccount.id, id));

    logAudit({
      ctx,
      action: "delete",
      entityType: "bank_account",
      entityId: id,
      changes: existing as Record<string, unknown>,
      request,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleError(err);
  }
}
