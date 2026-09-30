import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api/auth-context";
import { requireRole } from "@/lib/api/require-role";
import { handleError } from "@/lib/api/response";
import {
  syncFinancialAccount,
  syncOrganizationFinancialAccounts,
} from "@/lib/integrations/stripe-financial-connections/sync";
import { db } from "@/lib/db";
import { stripeFinancialAccount } from "@/lib/db/schema/integrations";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const syncSchema = z.object({
  bankAccountId: z.string().uuid().optional(),
  stripeFinancialAccountId: z.string().uuid().optional(),
  forceRefresh: z.boolean().default(true),
});

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext(request);
    requireRole(ctx, "manage:banking");

    const body = await request.json().catch(() => ({}));
    const { bankAccountId, stripeFinancialAccountId, forceRefresh } =
      syncSchema.parse(body);

    if (stripeFinancialAccountId) {
      const res = await syncFinancialAccount(stripeFinancialAccountId, {
        forceRefresh,
      });
      return NextResponse.json({ success: true, result: res });
    }

    if (bankAccountId) {
      const [fa] = await db
        .select()
        .from(stripeFinancialAccount)
        .where(
          and(
            eq(stripeFinancialAccount.bankAccountId, bankAccountId),
            eq(stripeFinancialAccount.organizationId, ctx.organizationId),
            eq(stripeFinancialAccount.status, "active")
          )
        )
        .limit(1);

      if (!fa) {
        return NextResponse.json(
          { error: "No active bank feed found for this bank account" },
          { status: 404 }
        );
      }

      const res = await syncFinancialAccount(fa.id, { forceRefresh });
      return NextResponse.json({ success: true, result: res });
    }

    // Sync all active feeds in organization
    const results = await syncOrganizationFinancialAccounts(ctx.organizationId, {
      forceRefresh,
    });

    return NextResponse.json({ success: true, results });
  } catch (err) {
    return handleError(err);
  }
}
