import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hmrcConnection, organization } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { exchangeCodeForTokens, getHmrcConfig } from "@/lib/integrations/hmrc/client";
import crypto from "crypto";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || url.origin;

  if (error || !code || !stateParam) {
    const reason = encodeURIComponent(errorDescription || error || "Authorization cancelled");
    return NextResponse.redirect(`${baseUrl}/tax/vat-return?hmrc_error=${reason}`);
  }

  try {
    // Decode and verify state
    const decodedState = JSON.parse(Buffer.from(stateParam, "base64url").toString("utf8"));
    const { payload, sig } = decodedState;

    const secret = process.env.AUTH_SECRET || "fixbooks-hmrc-state-key";
    const expectedSig = crypto.createHmac("sha256", secret).update(payload).digest("hex");

    if (sig !== expectedSig) {
      return NextResponse.redirect(`${baseUrl}/tax/vat-return?hmrc_error=Invalid+state+signature`);
    }

    const { orgId, userId, vrn, timestamp } = JSON.parse(payload);

    // Reject stale states (> 15 minutes)
    if (Date.now() - timestamp > 15 * 60 * 1000) {
      return NextResponse.redirect(`${baseUrl}/tax/vat-return?hmrc_error=Authorization+session+expired`);
    }

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code);
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    const config = getHmrcConfig();

    // Upsert HMRC connection
    const existing = await db.query.hmrcConnection.findFirst({
      where: eq(hmrcConnection.organizationId, orgId),
    });

    const cleanVrn = (vrn || "").replace(/[^0-9]/g, "") || existing?.vrn || "123456789";

    if (existing) {
      await db
        .update(hmrcConnection)
        .set({
          vrn: cleanVrn,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenExpiresAt,
          scope: tokens.scope || "read:vat write:vat",
          environment: config.environment,
          status: "connected",
          connectedBy: userId,
          connectedAt: new Date(),
          updatedAt: new Date(),
          lastError: null,
        })
        .where(eq(hmrcConnection.id, existing.id));
    } else {
      await db.insert(hmrcConnection).values({
        organizationId: orgId,
        vrn: cleanVrn,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt,
        scope: tokens.scope || "read:vat write:vat",
        environment: config.environment,
        status: "connected",
        connectedBy: userId,
        connectedAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // Update organization taxId with clean VRN if empty
    if (cleanVrn) {
      await db
        .update(organization)
        .set({ taxId: cleanVrn })
        .where(eq(organization.id, orgId));
    }

    return NextResponse.redirect(`${baseUrl}/tax/vat-return?hmrc_connected=true`);
  } catch (err: unknown) {
    console.error("[HMRC Callback Error]", err);
    const message = err instanceof Error ? err.message : "Token exchange failed";
    return NextResponse.redirect(`${baseUrl}/tax/vat-return?hmrc_error=${encodeURIComponent(message)}`);
  }
}
