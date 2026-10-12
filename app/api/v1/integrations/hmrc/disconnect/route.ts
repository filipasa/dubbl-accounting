import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hmrcConnection } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAuthContext } from "@/lib/api/auth-context";
import { requireRole } from "@/lib/api/require-role";
import { handleError } from "@/lib/api/response";

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext(request);
    requireRole(ctx, "manage:tax-config");

    await db
      .delete(hmrcConnection)
      .where(eq(hmrcConnection.organizationId, ctx.organizationId));

    return NextResponse.json({ success: true, message: "HMRC connection disconnected." });
  } catch (err) {
    return handleError(err);
  }
}
