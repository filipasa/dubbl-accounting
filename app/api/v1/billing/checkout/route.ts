import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { subscription, organization } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAuthContext, AuthError } from "@/lib/api/auth-context";
import { requireRole } from "@/lib/api/require-role";
import { stripe as _stripeClient } from "@/lib/stripe";

// Non-null wrapper - POST handler guards for null before calling helpers
const stripe = _stripeClient!;
import { z } from "zod";

const checkoutSchema = z.object({
  type: z.enum(["seats", "storage"]).default("seats"),
  plan: z.string().min(1),
  interval: z.enum(["monthly", "annual"]).default("monthly"),
});

function getAppUrl(request: Request): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  }
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") || "https";
  if (host) {
    return `${proto}://${host}`;
  }
  return "http://localhost:3000";
}

export async function POST(request: Request) {
  if (!_stripeClient) {
    return NextResponse.json({ error: "Billing not configured" }, { status: 404 });
  }

  try {
    const ctx = await getAuthContext(request);
    requireRole(ctx, "manage:billing");

    const body = await request.json();
    const { type, plan, interval } = checkoutSchema.parse(body);

    const org = await db.query.organization.findFirst({
      where: eq(organization.id, ctx.organizationId),
    });

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Get or create stripe customer
    const sub = await db.query.subscription.findFirst({
      where: eq(subscription.organizationId, ctx.organizationId),
    });

    let customerId = sub?.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: org.name,
        metadata: { organizationId: ctx.organizationId },
      });
      customerId = customer.id;

      if (sub) {
        await db
          .update(subscription)
          .set({ stripeCustomerId: customerId, updatedAt: new Date() })
          .where(eq(subscription.id, sub.id));
      }
    }

    const appUrl = getAppUrl(request);

    if (type === "storage") {
      return await handleStorageCheckout(sub, customerId, ctx.organizationId, plan, interval, appUrl);
    } else {
      return await handleSeatCheckout(sub, customerId, ctx.organizationId, plan, interval, appUrl);
    }
  } catch (err: any) {
    console.error("Billing checkout error:", err);
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err?.message || "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handleSeatCheckout(
  sub: typeof subscription.$inferSelect | undefined,
  customerId: string,
  organizationId: string,
  plan: string,
  interval: string,
  appUrl: string
) {
  if (plan !== "pro") {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  const priceId =
    interval === "annual"
      ? process.env.STRIPE_PRO_ANNUAL_PRICE_ID
      : process.env.STRIPE_PRO_PRICE_ID;

  if (!priceId) {
    const envVar =
      interval === "annual"
        ? "STRIPE_PRO_ANNUAL_PRICE_ID"
        : "STRIPE_PRO_PRICE_ID";
    return NextResponse.json(
      {
        error: `Stripe price ID for Pro seat plan (${interval}) is not configured. Missing environment variable: ${envVar}`,
      },
      { status: 400 }
    );
  }

  // If already has an active seat subscription, update it instead of creating new
  if (sub?.stripeSubscriptionId && sub.status === "active") {
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    const currentItem = stripeSub.items.data[0];

    if (currentItem) {
      await stripe.subscriptions.update(sub.stripeSubscriptionId, {
        items: [{ id: currentItem.id, price: priceId }],
        proration_behavior: "create_prorations",
        metadata: { organizationId, type: "seats", plan, interval },
      });

      // Update local DB
      await db
        .update(subscription)
        .set({
          plan: plan as "pro",
          stripePriceId: priceId,
          billingInterval: interval,
          updatedAt: new Date(),
        })
        .where(eq(subscription.id, sub.id));

      return NextResponse.json({ updated: true });
    }
  }

  // New subscription - create checkout session
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    automatic_tax: { enabled: true },
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/settings/billing?success=true`,
    cancel_url: `${appUrl}/settings/billing`,
    metadata: { organizationId, type: "seats", plan, interval },
  });

  return NextResponse.json({ url: session.url });
}

async function handleStorageCheckout(
  sub: typeof subscription.$inferSelect | undefined,
  customerId: string,
  organizationId: string,
  plan: string,
  interval: string,
  appUrl: string
) {
  const storagePriceMap: Record<string, Record<string, string | undefined>> = {
    starter: {
      monthly: process.env.STRIPE_STORAGE_STARTER_PRICE_ID,
      annual: process.env.STRIPE_STORAGE_STARTER_ANNUAL_PRICE_ID,
    },
    growth: {
      monthly: process.env.STRIPE_STORAGE_GROWTH_PRICE_ID,
      annual: process.env.STRIPE_STORAGE_GROWTH_ANNUAL_PRICE_ID,
    },
    scale: {
      monthly: process.env.STRIPE_STORAGE_SCALE_PRICE_ID,
      annual: process.env.STRIPE_STORAGE_SCALE_ANNUAL_PRICE_ID,
    },
  };

  const storagePriceId = storagePriceMap[plan]?.[interval];
  if (!storagePriceId) {
    const envVar = `STRIPE_STORAGE_${plan.toUpperCase()}_${
      interval === "annual" ? "ANNUAL_" : ""
    }PRICE_ID`;
    return NextResponse.json(
      {
        error: `Stripe price ID for storage plan '${plan}' (${interval}) is not configured. Missing environment variable: ${envVar}`,
      },
      { status: 400 }
    );
  }

  // If already has an active storage subscription, update it
  if (sub?.stripeStorageSubscriptionId) {
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripeStorageSubscriptionId);
    const currentItem = stripeSub.items.data[0];

    if (currentItem && stripeSub.status === "active") {
      await stripe.subscriptions.update(sub.stripeStorageSubscriptionId, {
        items: [{ id: currentItem.id, price: storagePriceId }],
        proration_behavior: "create_prorations",
        metadata: { organizationId, type: "storage", storagePlan: plan, interval },
      });

      // Update local DB
      await db
        .update(subscription)
        .set({
          storagePlan: plan as "starter" | "growth" | "scale",
          stripeStoragePriceId: storagePriceId,
          updatedAt: new Date(),
        })
        .where(eq(subscription.id, sub.id));

      return NextResponse.json({ updated: true });
    }
  }

  // New storage subscription - create checkout session
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    automatic_tax: { enabled: true },
    line_items: [{ price: storagePriceId, quantity: 1 }],
    success_url: `${appUrl}/settings/billing?success=true`,
    cancel_url: `${appUrl}/settings/billing`,
    metadata: { organizationId, type: "storage", storagePlan: plan, interval },
  });

  return NextResponse.json({ url: session.url });
}
