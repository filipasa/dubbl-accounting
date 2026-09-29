import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stripeIntegration } from "@/lib/db/schema";
import { getAuthContext } from "@/lib/api/auth-context";
import { requireRole } from "@/lib/api/require-role";
import { handleError, notFound } from "@/lib/api/response";
import { eq, and } from "drizzle-orm";
import { notDeleted } from "@/lib/db/soft-delete";
import { syncStripeChunk, SyncStage, SyncPeriod } from "@/lib/integrations/stripe/chunked-sync";
import { runInitialSync } from "@/lib/integrations/stripe/initial-sync";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext(request);
    requireRole(ctx, "manage:integrations");

    const body = await request.json().catch(() => ({}));
    const integrationId = body.integrationId;
    if (!integrationId) {
      return NextResponse.json({ error: "integrationId is required" }, { status: 400 });
    }

    const integration = await db.query.stripeIntegration.findFirst({
      where: and(
        eq(stripeIntegration.id, integrationId),
        eq(stripeIntegration.organizationId, ctx.organizationId),
        notDeleted(stripeIntegration.deletedAt)
      ),
    });

    if (!integration) return notFound("Stripe integration");

    // If caller explicitly asks for full legacy sync (e.g. background worker)
    if (body.fullSync === true) {
      await runInitialSync(integration.id);
      return NextResponse.json({ success: true, message: "Sync completed" });
    }

    const stage = body.stage as SyncStage | undefined;
    const cursor = body.cursor as string | undefined;
    const limit = typeof body.limit === "number" ? body.limit : undefined;
    const period = body.period as SyncPeriod | undefined;
    const startDate = body.startDate as string | undefined;
    const endDate = body.endDate as string | undefined;

    const result = await syncStripeChunk({
      integrationId: integration.id,
      stage,
      cursor,
      limit,
      period,
      startDate,
      endDate,
    });

    return NextResponse.json(result);
  } catch (err) {
    return handleError(err);
  }
}
