import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { organization } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAuthContext } from "@/lib/api/auth-context";
import { requireRole } from "@/lib/api/require-role";
import { handleError } from "@/lib/api/response";
import { getAuthorizationUrl } from "@/lib/integrations/hmrc/client";
import crypto from "crypto";

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext(request);
    requireRole(ctx, "manage:tax-config");

    const url = new URL(request.url);
    let vrn = url.searchParams.get("vrn");

    if (!vrn) {
      const org = await db.query.organization.findFirst({
        where: eq(organization.id, ctx.organizationId),
        columns: { taxId: true },
      });
      vrn = org?.taxId || null;
    }

    // Clean VRN (digits only, e.g. "GB 123 4567 89" -> "123456789")
    const cleanVrn = vrn ? vrn.replace(/[^0-9]/g, "") : "";

    // Encode state with HMAC signature
    const statePayload = JSON.stringify({
      orgId: ctx.organizationId,
      userId: ctx.userId,
      vrn: cleanVrn,
      timestamp: Date.now(),
    });

    const secret = process.env.AUTH_SECRET || "fixbooks-hmrc-state-key";
    const signature = crypto.createHmac("sha256", secret).update(statePayload).digest("hex");
    const state = Buffer.from(JSON.stringify({ payload: statePayload, sig: signature })).toString("base64url");

    const authUrl = getAuthorizationUrl(state);

    return NextResponse.json({ url: authUrl });
  } catch (err) {
    return handleError(err);
  }
}
