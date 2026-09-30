import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api/auth-context";
import { handleError } from "@/lib/api/response";
import { retrieveSessionAccounts } from "@/lib/integrations/stripe-financial-connections/client";
import { db } from "@/lib/db";
import { stripeFinancialConnection } from "@/lib/db/schema/integrations";
import { eq, and } from "drizzle-orm";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext(request);
    const { id: sessionId } = await params;

    // Verify session belongs to organization
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

    const accounts = await retrieveSessionAccounts(sessionId);

    return NextResponse.json({
      sessionId,
      connection: conn,
      accounts,
    });
  } catch (err) {
    return handleError(err);
  }
}
