import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hmrcConnection, hmrcVatSubmission, organization } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { getAuthContext } from "@/lib/api/auth-context";
import { requireRole } from "@/lib/api/require-role";
import { handleError } from "@/lib/api/response";
import { getHmrcConfig } from "@/lib/integrations/hmrc/client";

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext(request);
    requireRole(ctx, "view:data");

    const config = getHmrcConfig();
    const isConfigured = Boolean(config.clientId && config.clientSecret);

    const [connection, org, submissions] = await Promise.all([
      db.query.hmrcConnection.findFirst({
        where: eq(hmrcConnection.organizationId, ctx.organizationId),
      }),
      db.query.organization.findFirst({
        where: eq(organization.id, ctx.organizationId),
        columns: { taxId: true, name: true },
      }),
      db.query.hmrcVatSubmission.findMany({
        where: eq(hmrcVatSubmission.organizationId, ctx.organizationId),
        orderBy: [desc(hmrcVatSubmission.submittedAt)],
        limit: 5,
      }),
    ]);

    const isConnected = connection?.status === "connected";
    const vrn = connection?.vrn || org?.taxId || null;

    return NextResponse.json({
      isConfigured,
      connected: isConnected,
      environment: config.environment,
      vrn,
      tokenExpiresAt: connection?.tokenExpiresAt || null,
      lastSyncedAt: connection?.lastSyncedAt || null,
      lastError: connection?.lastError || null,
      recentSubmissions: submissions.map((s) => ({
        id: s.id,
        periodKey: s.periodKey,
        formBundleNumber: s.formBundleNumber,
        paymentIndicator: s.paymentIndicator,
        chargeRefNumber: s.chargeRefNumber,
        status: s.status,
        submittedAt: s.submittedAt,
        errorMessage: s.errorMessage,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}
