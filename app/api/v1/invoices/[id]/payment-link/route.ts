import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { invoice } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { getAuthContext } from "@/lib/api/auth-context";
import { handleError, notFound } from "@/lib/api/response";
import { randomBytes } from "crypto";
import { resolvePublicBaseUrl } from "@/lib/public-url";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext(request);
    const { id } = await params;

    const inv = await db.query.invoice.findFirst({
      where: and(
        eq(invoice.id, id),
        eq(invoice.organizationId, ctx.organizationId),
        isNull(invoice.deletedAt)
      ),
    });

    if (!inv) return notFound("Invoice");

    const baseUrl = resolvePublicBaseUrl(request);

    // Return existing token if already generated
    if (inv.paymentLinkToken) {
      return NextResponse.json({
        token: inv.paymentLinkToken,
        url: `${baseUrl}/pay/${inv.paymentLinkToken}`,
      });
    }

    // Generate new token
    const token = randomBytes(24).toString("hex");

    await db
      .update(invoice)
      .set({ paymentLinkToken: token, updatedAt: new Date() })
      .where(eq(invoice.id, id));

    return NextResponse.json({
      token,
      url: `${baseUrl}/pay/${token}`,
    });
  } catch (err) {
    return handleError(err);
  }
}
