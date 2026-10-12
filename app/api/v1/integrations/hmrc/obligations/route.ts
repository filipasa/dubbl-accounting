import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api/auth-context";
import { requireRole } from "@/lib/api/require-role";
import { handleError } from "@/lib/api/response";
import { getVatObligations } from "@/lib/integrations/hmrc/vat-api";
import { buildFraudHeaders } from "@/lib/integrations/hmrc/fraud-prevention";

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext(request);
    requireRole(ctx, "view:data");

    const url = new URL(request.url);
    const statusParam = (url.searchParams.get("status") || "O").toUpperCase();
    const status = statusParam === "F" ? "F" : "O";

    const fraudHeaders = buildFraudHeaders({
      request,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
    });

    const obligations = await getVatObligations({
      organizationId: ctx.organizationId,
      status,
      fraudHeaders,
    });

    return NextResponse.json({ obligations });
  } catch (err) {
    return handleError(err);
  }
}
