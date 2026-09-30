import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api/auth-context";
import { handleError } from "@/lib/api/response";
import { createConnectionsSession } from "@/lib/integrations/stripe-financial-connections/client";
import { z } from "zod";

const sessionSchema = z.object({
  days: z.number().int().min(1).max(730).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  returnUrl: z.string().url().optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext(request);
    const body = await request.json().catch(() => ({}));
    const validated = sessionSchema.parse(body);

    const session = await createConnectionsSession(ctx.organizationId, validated);

    return NextResponse.json(session);
  } catch (err) {
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return handleError(err);
  }
}
