import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api/auth-context";
import { requireRole } from "@/lib/api/require-role";
import { handleError } from "@/lib/api/response";
import { db } from "@/lib/db";
import {
  stripeFinancialAccount,
  stripeFinancialConnection,
} from "@/lib/db/schema/integrations";
import { bankAccount } from "@/lib/db/schema/banking";
import { ensureBankLedgerAccount } from "@/lib/api/bank-ledger";
import { syncFinancialAccount } from "@/lib/integrations/stripe-financial-connections/sync";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const linkAccountsSchema = z.object({
  sessionId: z.string(),
  accounts: z.array(
    z.object({
      stripeAccountId: z.string(),
      institutionName: z.string().optional(),
      displayName: z.string().optional(),
      last4: z.string().nullable().optional(),
      currency: z.string().default("GBP"),
      category: z.string().default("cash"),
      subcategory: z.string().default("checking"),
      action: z.enum(["link_existing", "create_new", "skip"]),
      existingBankAccountId: z.string().uuid().optional(),
      newAccountName: z.string().optional(),
    })
  ),
});

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext(request);
    requireRole(ctx, "manage:banking");

    const body = await request.json();
    const { sessionId, accounts } = linkAccountsSchema.parse(body);

    const [conn] = await db
      .select()
      .from(stripeFinancialConnection)
      .where(
        and(
          eq(stripeFinancialConnection.sessionId, sessionId),
          eq(stripeFinancialConnection.organizationId, ctx.organizationId)
        )
      )
      .limit(1);

    if (!conn) {
      return NextResponse.json({ error: "Connection session not found" }, { status: 404 });
    }

    const linkedAccounts = [];

    for (const item of accounts) {
      if (item.action === "skip") continue;

      let targetBankAccountId = item.existingBankAccountId;

      if (item.action === "create_new") {
        const accountName =
          item.newAccountName ||
          `${item.institutionName || "Bank"} ${item.displayName || "Account"}`;

        const createdAccount = await db.transaction(async (tx) => {
          const [newAcc] = await tx
            .insert(bankAccount)
            .values({
              organizationId: ctx.organizationId,
              accountName,
              accountNumber: item.last4 ? `···${item.last4}` : null,
              bankName: item.institutionName || null,
              currencyCode: item.currency.toUpperCase(),
              accountType:
                item.subcategory === "savings"
                  ? "savings"
                  : item.subcategory === "credit_card"
                  ? "credit_card"
                  : "checking",
              color: "#0f766e",
              balance: 0,
            })
            .returning();

          await ensureBankLedgerAccount(ctx.organizationId, newAcc, tx);
          return newAcc;
        });

        targetBankAccountId = createdAccount.id;
      }

      if (!targetBankAccountId) continue;

      // Upsert stripeFinancialAccount
      const [existing] = await db
        .select()
        .from(stripeFinancialAccount)
        .where(eq(stripeFinancialAccount.stripeAccountId, item.stripeAccountId))
        .limit(1);

      let faRecordId: string;

      if (existing) {
        await db
          .update(stripeFinancialAccount)
          .set({
            bankAccountId: targetBankAccountId,
            institutionName: item.institutionName,
            displayName: item.displayName,
            last4: item.last4 || null,
            currency: item.currency.toUpperCase(),
            category: item.category,
            subcategory: item.subcategory,
            status: "active",
            updatedAt: new Date(),
          })
          .where(eq(stripeFinancialAccount.id, existing.id));
        faRecordId = existing.id;
      } else {
        const [inserted] = await db
          .insert(stripeFinancialAccount)
          .values({
            organizationId: ctx.organizationId,
            connectionId: conn.id,
            stripeAccountId: item.stripeAccountId,
            bankAccountId: targetBankAccountId,
            institutionName: item.institutionName,
            displayName: item.displayName,
            last4: item.last4 || null,
            currency: item.currency.toUpperCase(),
            category: item.category,
            subcategory: item.subcategory,
            status: "active",
          })
          .returning();
        faRecordId = inserted.id;
      }

      // Automatically sync transactions & balance for newly linked account
      try {
        const syncResult = await syncFinancialAccount(faRecordId, {
          startDate: conn.initialSyncStartDate || undefined,
        });
        linkedAccounts.push({
          stripeAccountId: item.stripeAccountId,
          bankAccountId: targetBankAccountId,
          syncResult,
        });
      } catch (syncErr) {
        console.error(`Initial sync error for ${faRecordId}:`, syncErr);
        linkedAccounts.push({
          stripeAccountId: item.stripeAccountId,
          bankAccountId: targetBankAccountId,
          syncResult: { error: "Failed initial sync, will retry", synced: 0 },
        });
      }
    }

    return NextResponse.json({
      success: true,
      linkedAccounts,
    });
  } catch (err) {
    return handleError(err);
  }
}
