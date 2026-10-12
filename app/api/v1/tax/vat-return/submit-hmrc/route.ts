import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { taxPeriod, taxReturnLine } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getAuthContext } from "@/lib/api/auth-context";
import { requireRole } from "@/lib/api/require-role";
import { handleError } from "@/lib/api/response";
import { buildFraudHeaders } from "@/lib/integrations/hmrc/fraud-prevention";
import { submitVatReturnToHmrc, resolveHmrcPeriodKey } from "@/lib/integrations/hmrc/vat-api";
import { createVatReturnClearingJournalEntry } from "@/lib/api/journal-automation";
import { z } from "zod";

const submitSchema = z.object({
  periodKey: z.string().min(1).max(10).optional(),
  taxPeriodId: z.string().uuid().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  basis: z.enum(["accrual", "cash"]).default("accrual"),
  finalised: z.literal(true, {
    message: "You must confirm the legal declaration to submit to HMRC.",
  }),
  boxes: z.object({
    box1: z.number(), // minor units / pence
    box2: z.number(),
    box3: z.number(),
    box4: z.number(),
    box5: z.number(),
    box6: z.number(),
    box7: z.number(),
    box8: z.number(),
    box9: z.number(),
  }),
  clientTelemetry: z
    .object({
      deviceId: z.string().optional(),
      screens: z.string().optional(),
      windowSize: z.string().optional(),
      timezone: z.string().optional(),
      browserUserAgent: z.string().optional(),
      doNotTrack: z.boolean().optional(),
      localIps: z.string().optional(),
    })
    .optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext(request);
    requireRole(ctx, "manage:tax-config");

    const body = await request.json();
    const parsed = submitSchema.parse(body);

    const fraudHeaders = buildFraudHeaders({
      request,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      clientTelemetry: parsed.clientTelemetry,
    });

    // Automatically resolve HMRC obligation periodKey if not supplied by caller
    const periodKey =
      parsed.periodKey ||
      (await resolveHmrcPeriodKey({
        organizationId: ctx.organizationId,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        fraudHeaders,
      }));

    // 1. Submit directly to HMRC via MTD API
    const submissionResult = await submitVatReturnToHmrc({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      taxPeriodId: parsed.taxPeriodId,
      periodKey,
      boxes: parsed.boxes,
      fraudHeaders,
    });

    // 2. If taxPeriodId is provided or found, update tax period and freeze figures
    let targetPeriodId = parsed.taxPeriodId;
    if (!targetPeriodId && parsed.startDate && parsed.endDate) {
      const match = await db.query.taxPeriod.findFirst({
        where: and(
          eq(taxPeriod.organizationId, ctx.organizationId),
          eq(taxPeriod.startDate, parsed.startDate),
          eq(taxPeriod.endDate, parsed.endDate),
          eq(taxPeriod.status, "open")
        ),
      });
      if (match) {
        targetPeriodId = match.id;
      }
    }

    if (targetPeriodId) {
      const period = await db.query.taxPeriod.findFirst({
        where: and(
          eq(taxPeriod.id, targetPeriodId),
          eq(taxPeriod.organizationId, ctx.organizationId)
        ),
      });

      if (period && period.status === "open") {
        await db.transaction(async (tx) => {
          // Post VAT clearing journal entry (DR 2200, CR 1500, net to 2240)
          await createVatReturnClearingJournalEntry(
            { organizationId: ctx.organizationId, userId: ctx.userId },
            {
              date: period.endDate,
              periodStartDate: period.startDate,
              periodEndDate: period.endDate,
              reference: `HMRC MTD Receipt: ${submissionResult.formBundleNumber}`,
              outputBalance: parsed.boxes.box1,
              inputBalance: parsed.boxes.box4,
            },
            tx
          ).catch((e) => console.warn("[Clearing Entry] Skipped or failed:", e));

          // Mark period filed with HMRC receipt reference
          await tx
            .update(taxPeriod)
            .set({
              status: "filed",
              filedAt: new Date(submissionResult.processingDate || Date.now()),
              filedBy: ctx.userId,
              filedReference: submissionResult.formBundleNumber,
              notes: `Submitted to HMRC MTD. Period Key: ${parsed.periodKey}, Receipt: ${submissionResult.formBundleNumber}, Payment: ${submissionResult.paymentIndicator}`,
              updatedAt: new Date(),
            })
            .where(eq(taxPeriod.id, targetPeriodId));

          // Freeze the box figures
          await tx.delete(taxReturnLine).where(eq(taxReturnLine.taxPeriodId, targetPeriodId));
          const frozenBoxes = [
            { boxNumber: "1", label: "VAT due on sales", amount: parsed.boxes.box1, sortOrder: 1 },
            { boxNumber: "2", label: "VAT due on EU acquisitions", amount: parsed.boxes.box2, sortOrder: 2 },
            { boxNumber: "3", label: "Total VAT due (Box 1 + 2)", amount: parsed.boxes.box3, sortOrder: 3 },
            { boxNumber: "4", label: "VAT reclaimed on purchases", amount: parsed.boxes.box4, sortOrder: 4 },
            { boxNumber: "5", label: "Net VAT to pay/reclaim (Box 3 - 4)", amount: parsed.boxes.box5, sortOrder: 5 },
            { boxNumber: "6", label: "Total sales ex-VAT", amount: parsed.boxes.box6, sortOrder: 6 },
            { boxNumber: "7", label: "Total purchases ex-VAT", amount: parsed.boxes.box7, sortOrder: 7 },
            { boxNumber: "8", label: "Total supplies to EU ex-VAT", amount: parsed.boxes.box8, sortOrder: 8 },
            { boxNumber: "9", label: "Total acquisitions from EU ex-VAT", amount: parsed.boxes.box9, sortOrder: 9 },
          ];

          await tx.insert(taxReturnLine).values(
            frozenBoxes.map((b) => ({
              taxPeriodId: targetPeriodId,
              boxNumber: b.boxNumber,
              label: b.label,
              amount: b.amount,
              isCalculated: true,
              sourceDescription: `HMRC MTD Filing (${parsed.basis})`,
              sortOrder: b.sortOrder,
            }))
          );
        });
      }
    }

    return NextResponse.json({
      success: true,
      submission: submissionResult,
    });
  } catch (err) {
    return handleError(err);
  }
}
