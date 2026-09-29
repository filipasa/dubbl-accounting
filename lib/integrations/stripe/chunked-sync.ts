import { db } from "@/lib/db";
import { stripeIntegration, stripeSyncLog } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { stripe } from "@/lib/stripe";
import Stripe from "stripe";
import { ensureIntegrationAccountsMapped } from "./accounts";
import {
  handleChargeSucceeded,
  handleCustomerCreated,
  handlePayoutPaid,
  handleTransferCreated,
  handleStripeCreditNoteCreated,
} from "./sync";

export type SyncStage = "customers" | "charges" | "payouts" | "transfers" | "creditNotes";
export type SyncPeriod = "30d" | "90d" | "180d" | "365d" | "all" | "custom";

export const SYNC_STAGES: SyncStage[] = [
  "customers",
  "charges",
  "payouts",
  "transfers",
  "creditNotes",
];

export interface SyncChunkParams {
  integrationId: string;
  stage?: SyncStage;
  cursor?: string | null;
  limit?: number;
  period?: SyncPeriod;
  startDate?: string | null;
  endDate?: string | null;
}

export interface SyncChunkResult {
  success: boolean;
  stage: SyncStage;
  nextStage: SyncStage | null;
  nextCursor: string | null;
  hasMore: boolean;
  batchCount: number;
  isComplete: boolean;
  message?: string;
}

function getDateFilter(
  period?: SyncPeriod,
  startDate?: string | null,
  endDate?: string | null
): Stripe.RangeQueryParam | undefined {
  if (period === "all") {
    return undefined;
  }

  if (period === "custom") {
    const filter: Stripe.RangeQueryParam = {};
    if (startDate) {
      filter.gte = Math.floor(new Date(`${startDate}T00:00:00Z`).getTime() / 1000);
    }
    if (endDate) {
      filter.lte = Math.floor(new Date(`${endDate}T23:59:59Z`).getTime() / 1000);
    }
    return Object.keys(filter).length > 0 ? filter : undefined;
  }

  const daysMap: Record<string, number> = {
    "30d": 30,
    "90d": 90,
    "180d": 180,
    "365d": 365,
  };

  const days = daysMap[period || "30d"] ?? 30;
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  return { gte: since };
}

export async function syncStripeChunk(params: SyncChunkParams): Promise<SyncChunkResult> {
  const integration = await db.query.stripeIntegration.findFirst({
    where: eq(stripeIntegration.id, params.integrationId),
  });

  if (!integration) {
    throw new Error("Stripe integration not found");
  }

  const stripeClient = integration.accessToken
    ? new Stripe(integration.accessToken, { typescript: true })
    : stripe;

  if (!stripeClient) {
    throw new Error("Stripe client is not configured");
  }

  await ensureIntegrationAccountsMapped(integration);

  const stage: SyncStage = params.stage && SYNC_STAGES.includes(params.stage)
    ? params.stage
    : "customers";

  const limit = Math.min(Math.max(params.limit || 50, 10), 100);
  const cursor = params.cursor || undefined;
  const created = getDateFilter(params.period, params.startDate, params.endDate);
  const stripeAccountOpts = integration.accessToken ? undefined : { stripeAccount: integration.stripeAccountId };

  let batchCount = 0;
  let hasMoreInStage = false;
  let lastItemId: string | null = null;

  switch (stage) {
    case "customers": {
      const listParams: Stripe.CustomerListParams = {
        limit,
        ...(created ? { created } : {}),
        ...(cursor ? { starting_after: cursor } : {}),
      };
      const res = await stripeClient.customers.list(listParams, stripeAccountOpts);
      batchCount = res.data.length;
      hasMoreInStage = res.has_more;
      if (batchCount > 0) {
        lastItemId = res.data[batchCount - 1].id;
      }

      for (const customer of res.data) {
        try {
          await handleCustomerCreated(integration, customer);
        } catch (err) {
          await db.insert(stripeSyncLog).values({
            integrationId: integration.id,
            eventType: "customer.created",
            stripeEventId: null,
            status: "failed",
            errorMessage: err instanceof Error ? err.message : "Unknown error",
            payload: { customerId: customer.id },
          });
        }
      }
      break;
    }

    case "charges": {
      const listParams: Stripe.ChargeListParams = {
        limit,
        ...(created ? { created } : {}),
        ...(cursor ? { starting_after: cursor } : {}),
      };
      const res = await stripeClient.charges.list(listParams, stripeAccountOpts);
      batchCount = res.data.length;
      hasMoreInStage = res.has_more;
      if (batchCount > 0) {
        lastItemId = res.data[batchCount - 1].id;
      }

      for (const charge of res.data) {
        try {
          if (charge.status === "succeeded") {
            await handleChargeSucceeded(integration, charge);
          }
        } catch (err) {
          await db.insert(stripeSyncLog).values({
            integrationId: integration.id,
            eventType: "charge.succeeded",
            stripeEventId: null,
            status: "failed",
            errorMessage: err instanceof Error ? err.message : "Unknown error",
            payload: { chargeId: charge.id },
          });
        }
      }
      break;
    }

    case "payouts": {
      const listParams: Stripe.PayoutListParams = {
        limit,
        status: "paid",
        expand: ["data.destination"],
        ...(created ? { created } : {}),
        ...(cursor ? { starting_after: cursor } : {}),
      };
      const res = await stripeClient.payouts.list(listParams, stripeAccountOpts);
      batchCount = res.data.length;
      hasMoreInStage = res.has_more;
      if (batchCount > 0) {
        lastItemId = res.data[batchCount - 1].id;
      }

      for (const payout of res.data) {
        try {
          await handlePayoutPaid(integration, payout);
        } catch (err) {
          await db.insert(stripeSyncLog).values({
            integrationId: integration.id,
            eventType: "payout.paid",
            stripeEventId: null,
            status: "failed",
            errorMessage: err instanceof Error ? err.message : "Unknown error",
            payload: { payoutId: payout.id },
          });
        }
      }
      break;
    }

    case "transfers": {
      const listParams: Stripe.TransferListParams = {
        limit,
        ...(created ? { created } : {}),
        ...(cursor ? { starting_after: cursor } : {}),
      };
      const res = await stripeClient.transfers.list(listParams, stripeAccountOpts);
      batchCount = res.data.length;
      hasMoreInStage = res.has_more;
      if (batchCount > 0) {
        lastItemId = res.data[batchCount - 1].id;
      }

      for (const transfer of res.data) {
        try {
          await handleTransferCreated(integration, transfer);
        } catch (err) {
          await db.insert(stripeSyncLog).values({
            integrationId: integration.id,
            eventType: "transfer.created",
            stripeEventId: null,
            status: "failed",
            errorMessage: err instanceof Error ? err.message : "Unknown error",
            payload: { transferId: transfer.id },
          });
        }
      }
      break;
    }

    case "creditNotes": {
      const listParams: Stripe.CreditNoteListParams = {
        limit,
        ...(created ? { created } : {}),
        ...(cursor ? { starting_after: cursor } : {}),
      };
      const res = await stripeClient.creditNotes.list(listParams, stripeAccountOpts);
      batchCount = res.data.length;
      hasMoreInStage = res.has_more;
      if (batchCount > 0) {
        lastItemId = res.data[batchCount - 1].id;
      }

      for (const cn of res.data) {
        try {
          await handleStripeCreditNoteCreated(integration, cn);
        } catch (err) {
          await db.insert(stripeSyncLog).values({
            integrationId: integration.id,
            eventType: "credit_note.created",
            stripeEventId: null,
            status: "failed",
            errorMessage: err instanceof Error ? err.message : "Unknown error",
            payload: { creditNoteId: cn.id },
          });
        }
      }
      break;
    }
  }

  let nextStage: SyncStage | null = stage;
  let nextCursor: string | null = null;
  let isComplete = false;

  if (hasMoreInStage && lastItemId) {
    nextStage = stage;
    nextCursor = lastItemId;
  } else {
    // Current stage finished, transition to next stage
    const currentIndex = SYNC_STAGES.indexOf(stage);
    if (currentIndex < SYNC_STAGES.length - 1) {
      nextStage = SYNC_STAGES[currentIndex + 1];
      nextCursor = null;
    } else {
      nextStage = null;
      nextCursor = null;
      isComplete = true;

      await db
        .update(stripeIntegration)
        .set({
          initialSyncCompleted: true,
          lastSyncAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(stripeIntegration.id, integration.id));

      await db.insert(stripeSyncLog).values({
        integrationId: integration.id,
        eventType: "initial_sync",
        status: "success",
        payload: {
          period: params.period || "30d",
          completedAt: new Date().toISOString(),
        },
      });
    }
  }

  return {
    success: true,
    stage,
    nextStage,
    nextCursor,
    hasMore: hasMoreInStage,
    batchCount,
    isComplete,
  };
}
