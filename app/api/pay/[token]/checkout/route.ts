import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { invoice } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { stripe } from "@/lib/stripe";
import { resolvePublicBaseUrl } from "@/lib/public-url";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  if (!stripe) {
    return NextResponse.json({ error: "Billing not configured" }, { status: 404 });
  }

  const { token } = await params;

  const inv = await db.query.invoice.findFirst({
    where: and(
      eq(invoice.paymentLinkToken, token),
      isNull(invoice.deletedAt)
    ),
    with: { organization: true, contact: true },
  });

  if (!inv || inv.status === "paid" || inv.status === "void" || inv.amountDue <= 0) {
    return NextResponse.json({ error: "Invoice not payable" }, { status: 400 });
  }

  const methods = inv.paymentMethods && inv.paymentMethods.length > 0 ? inv.paymentMethods : ["pay_by_bank"];
  const hasPayByBank = methods.includes("pay_by_bank");
  const hasCard = methods.includes("card") || methods.includes("online") || methods.includes("stripe");

  if (!hasPayByBank && !hasCard) {
    return NextResponse.json({ error: "No payment methods configured for this invoice" }, { status: 400 });
  }

  const paymentMethodTypes: ("card" | "pay_by_bank")[] = [];
  if (hasCard) paymentMethodTypes.push("card");
  if (hasPayByBank) paymentMethodTypes.push("pay_by_bank");

  const baseUrl = resolvePublicBaseUrl(request);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: paymentMethodTypes,
    ...(hasPayByBank ? {
      payment_method_options: {
        pay_by_bank: {},
      },
    } : {}),
    customer_email: inv.contact?.email || undefined,
    line_items: [
      {
        price_data: {
          currency: inv.currencyCode.toLowerCase(),
          product_data: {
            name: `Invoice ${inv.invoiceNumber}`,
            description: `Payment to ${inv.organization.name}`,
          },
          unit_amount: inv.amountDue,
        },
        quantity: 1,
      },
    ],
    metadata: {
      invoiceId: inv.id,
      organizationId: inv.organizationId,
      paymentLinkToken: token,
    },
    success_url: `${baseUrl}/pay/${token}?status=success`,
    cancel_url: `${baseUrl}/pay/${token}?status=cancelled`,
  });

  return NextResponse.json({ checkoutUrl: session.url });
}
