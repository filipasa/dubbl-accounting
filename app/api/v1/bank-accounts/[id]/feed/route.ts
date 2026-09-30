import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api/auth-context";
import { requireRole } from "@/lib/api/require-role";
import { handleError } from "@/lib/api/response";
import { db } from "@/lib/db";
import { stripeFinancialAccount } from "@/lib/db/schema/integrations";
import { disconnectFinancialAccount } from "@/lib/integrations/stripe-financial-connections/client";
import { eq, and } from "drizzle-orm";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext(request);
    const { id: bankAccountId } = await params;

    const [fa] = await db
      .select()
      .from(stripeFinancialAccount)
      .where(
        and(
          eq(stripeFinancialAccount.bankAccountId, bankAccountId),
          eq(stripeFinancialAccount.organizationId, ctx.organizationId)
        )
      )
      .limit(1);

    if (!fa) {
      return NextResponse.json({ feed: null });
    }

    return NextResponse.json({
      feed: {
        id: fa.id,
        stripeAccountId: fa.stripeAccountId,
        institutionName: fa.institutionName,
        displayName: fa.displayName,
        last4: fa.last4,
        currency: fa.currency,
        status: fa.status,
        lastSyncAt: fa.lastSyncAt,
        lastSyncTxnCount: fa.lastSyncTxnCount,
        errorMessage: fa.errorMessage,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext(request);
    requireRole(ctx, "manage:banking");
    const { id: bankAccountId } = await params;

    const [fa] = await db
      .select()
      .from(stripeFinancialAccount)
      .where(
        and(
          eq(stripeFinancialAccount.bankAccountId, bankAccountId),
          eq(stripeFinancialAccount.organizationId, ctx.organizationId)
        )
      )
      .limit(1);

    if (!fa) {
      return NextResponse.json(
        { error: "No bank feed attached to this account" },
        { status: 404 }
      );
    }

    // Disconnect on Stripe side
    try {
      await disconnectFinancialAccount(fa.stripeAccountId);
    } catch (err) {
      console.warn("Could not disconnect from Stripe API:", err);
    }

    // Unlink in database
    await db
      .update(stripeFinancialAccount)
      .set({
        bankAccountId: null,
        status: "disconnected",
        updatedAt: new Date(),
      })
      .where(eq(stripeFinancialAccount.id, fa.id));

    return NextResponse.json({ success: true, message: "Bank feed disconnected" });
  } catch (err) {
    return handleError(err);
  }
}
