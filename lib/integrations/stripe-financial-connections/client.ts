import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { organization } from "@/lib/db/schema/auth";
import { stripeFinancialConnection } from "@/lib/db/schema/integrations";
import { eq } from "drizzle-orm";

export const MAX_HISTORICAL_DAYS = 730; // 2 years

export interface CreateSessionOptions {
  days?: number;
  startDate?: string; // YYYY-MM-DD
  returnUrl?: string;
}

export interface DiscoveredAccount {
  stripeAccountId: string;
  institutionName: string;
  displayName: string;
  last4: string | null;
  currency: string;
  category: string;
  subcategory: string;
  balanceCents: number;
  status: string;
}

export function calculateHistoricalDays(options?: { days?: number; startDate?: string }): {
  days: number;
  startDate: string;
} {
  const now = new Date();
  const maxHistoricalDate = new Date(now.getTime() - MAX_HISTORICAL_DAYS * 24 * 60 * 60 * 1000);
  let days = options?.days ?? 90;

  if (options?.startDate) {
    const parsed = new Date(options.startDate);
    if (!isNaN(parsed.getTime())) {
      if (parsed < maxHistoricalDate) {
        return {
          days: MAX_HISTORICAL_DAYS,
          startDate: maxHistoricalDate.toISOString().slice(0, 10),
        };
      }
      const diffMs = Math.max(0, now.getTime() - parsed.getTime());
      days = Math.min(
        Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24))),
        MAX_HISTORICAL_DAYS
      );
      return {
        days,
        startDate: parsed.toISOString().slice(0, 10),
      };
    }
  }

  days = Math.min(Math.max(1, days), MAX_HISTORICAL_DAYS);

  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const startDateStr = start.toISOString().slice(0, 10);

  return { days, startDate: startDateStr };
}

export async function getOrCreateStripeCustomer(organizationId: string): Promise<string> {
  if (!stripe) {
    throw new Error("Stripe is not configured. Please set STRIPE_SECRET_KEY.");
  }

  const [org] = await db
    .select()
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  if (!org) {
    throw new Error("Organization not found");
  }

  // Look for existing customer with matching metadata
  const existing = await stripe.customers.search({
    query: `metadata['organizationId']:'${organizationId}'`,
    limit: 1,
  });

  if (existing.data.length > 0) {
    return existing.data[0].id;
  }

  // Create a new customer record for this Fixbooks organization
  const customer = await stripe.customers.create({
    name: org.name,
    metadata: {
      organizationId,
      source: "fixbooks_financial_connections",
    },
  });

  return customer.id;
}

export async function createConnectionsSession(
  organizationId: string,
  options?: CreateSessionOptions
): Promise<{
  sessionId: string;
  clientSecret: string | null;
  publishableKey: string;
  days: number;
  startDate: string;
  isTestMode: boolean;
}> {
  if (!stripe) {
    throw new Error("Stripe is not configured. Please set STRIPE_SECRET_KEY.");
  }

  const isTestMode = (process.env.STRIPE_SECRET_KEY || "").startsWith("sk_test_");

  const customerId = await getOrCreateStripeCustomer(organizationId);
  const { days, startDate } = calculateHistoricalDays(options);

  const session = await stripe.financialConnections.sessions.create({
    account_holder: {
      type: "customer",
      customer: customerId,
    },
    permissions: ["balances", "transactions"],
    prefetch: ["balances", "transactions"],
    ...(options?.returnUrl ? { return_url: options.returnUrl } : {}),
  });

  // Record connection intent in DB
  await db.insert(stripeFinancialConnection).values({
    organizationId,
    stripeCustomerId: customerId,
    sessionId: session.id,
    status: "active",
    initialSyncDays: days,
    initialSyncStartDate: startDate,
  });

  const publishableKey =
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    process.env.STRIPE_PUBLISHABLE_KEY ||
    process.env.STRIPE_PUBLIC_KEY ||
    process.env.NEXT_PUBLIC_STRIPE_KEY ||
    process.env.NEXT_PUBLIC_STRIPE_PK ||
    process.env.STRIPE_PK ||
    "";

  return {
    sessionId: session.id,
    clientSecret: session.client_secret,
    publishableKey,
    days,
    startDate,
    isTestMode,
  };
}

export async function retrieveSessionAccounts(sessionId: string): Promise<DiscoveredAccount[]> {
  if (!stripe) {
    throw new Error("Stripe is not configured. Please set STRIPE_SECRET_KEY.");
  }

  const session = await stripe.financialConnections.sessions.retrieve(sessionId, {
    expand: ["accounts.data.balance"],
  });

  const accounts = session.accounts?.data || [];

  return accounts.map((acc) => {
    let currency = "GBP";
    let balanceCents = 0;

    if (acc.balance?.cash?.available) {
      const entries = Object.entries(acc.balance.cash.available);
      if (entries.length > 0) {
        currency = entries[0][0].toUpperCase();
        balanceCents = typeof entries[0][1] === "number" ? entries[0][1] : 0;
      }
    } else if (acc.balance?.current) {
      const entries = Object.entries(acc.balance.current);
      if (entries.length > 0) {
        currency = entries[0][0].toUpperCase();
        balanceCents = typeof entries[0][1] === "number" ? entries[0][1] : 0;
      }
    }

    return {
      stripeAccountId: acc.id,
      institutionName: acc.institution_name || "Bank",
      displayName: acc.display_name || `${acc.institution_name || "Account"} (${acc.last4 || ""})`,
      last4: acc.last4,
      currency,
      category: acc.category || "cash",
      subcategory: acc.subcategory || "checking",
      balanceCents,
      status: acc.status || "active",
    };
  });
}

export async function disconnectFinancialAccount(stripeAccountId: string): Promise<void> {
  if (!stripe) {
    throw new Error("Stripe is not configured.");
  }

  try {
    await stripe.financialConnections.accounts.disconnect(stripeAccountId);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Ignore already disconnected errors
    if (!message.includes("already disconnected")) {
      console.error(`Failed to disconnect Stripe account ${stripeAccountId}:`, err);
      throw err;
    }
  }
}
