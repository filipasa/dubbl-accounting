import { db } from "@/lib/db";
import { hmrcConnection, hmrcVatSubmission } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hmrcApiRequest } from "./client";
import type {
  HmrcObligation,
  HmrcObligationsResponse,
  HmrcVatReturnPayload,
  HmrcVatSubmissionResponse,
} from "./types";

/**
 * Format monetary pence (minor units) to HMRC decimal pounds (2 decimal places)
 */
function toPoundsDecimal(pence: number): number {
  return Math.round(pence) / 100;
}

/**
 * Format monetary pence (minor units) to HMRC whole integer pounds (Boxes 6-9)
 */
function toPoundsInteger(pence: number): number {
  return Math.round(pence / 100);
}

/**
 * Retrieve VAT Obligations from HMRC for an organization.
 */
export async function getVatObligations(params: {
  organizationId: string;
  status?: "O" | "F";
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
  fraudHeaders?: Record<string, string>;
}): Promise<HmrcObligation[]> {
  const { organizationId, status = "O", fraudHeaders } = params;

  const connection = await db.query.hmrcConnection.findFirst({
    where: eq(hmrcConnection.organizationId, organizationId),
  });

  if (!connection || connection.status !== "connected") {
    throw new Error("HMRC is not connected for this organization.");
  }

  // Default to 12 months back and forward if dates omitted
  const now = new Date();
  const from =
    params.from ||
    new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString().slice(0, 10);
  const to =
    params.to ||
    new Date(now.getFullYear() + 1, now.getMonth(), 1).toISOString().slice(0, 10);

  const queryParams = new URLSearchParams({
    from,
    to,
    status,
  });

  const res = await hmrcApiRequest<HmrcObligationsResponse>({
    connection,
    path: `/organisations/vat/${connection.vrn}/obligations?${queryParams.toString()}`,
    method: "GET",
    fraudHeaders,
  });

  if (!res.ok) {
    console.error("[HMRC Obligations] Failed:", res.data);
    const errObj = res.data as { code?: string; message?: string };
    throw new Error(
      errObj.message || `Failed to fetch HMRC obligations (HTTP ${res.status})`
    );
  }

  // Flatten obligationDetails array
  const list: HmrcObligation[] = [];
  if (res.data?.obligations && Array.isArray(res.data.obligations)) {
    for (const group of res.data.obligations) {
      if (group.obligationDetails) {
        list.push(...group.obligationDetails);
      }
    }
  }

  return list;
}

/**
 * Submit a finalised 9-box VAT Return to HMRC.
 */
export async function submitVatReturnToHmrc(params: {
  organizationId: string;
  userId: string;
  taxPeriodId?: string;
  periodKey: string;
  boxes: {
    box1: number; // minor units (pence)
    box2: number;
    box3: number;
    box4: number;
    box5: number;
    box6: number;
    box7: number;
    box8: number;
    box9: number;
  };
  fraudHeaders?: Record<string, string>;
}): Promise<HmrcVatSubmissionResponse> {
  const { organizationId, userId, taxPeriodId, periodKey, boxes, fraudHeaders } = params;

  const connection = await db.query.hmrcConnection.findFirst({
    where: eq(hmrcConnection.organizationId, organizationId),
  });

  if (!connection || connection.status !== "connected") {
    throw new Error("HMRC is not connected for this organization.");
  }

  // Calculate HMRC figures strictly conforming to HMRC MTD validation rules
  const vatDueSales = toPoundsDecimal(boxes.box1);
  const vatDueAcquisitions = toPoundsDecimal(boxes.box2);
  const totalVatDue = toPoundsDecimal(boxes.box3);
  const vatReclaimedCurrPeriod = toPoundsDecimal(boxes.box4);
  // HMRC requires netVatDue to be positive
  const netVatDue = Math.abs(toPoundsDecimal(boxes.box5));

  const totalValueSalesExVAT = toPoundsInteger(boxes.box6);
  const totalValuePurchasesExVAT = toPoundsInteger(boxes.box7);
  const totalValueGoodsSuppliedExVAT = toPoundsInteger(boxes.box8);
  const totalAcquisitionsExVAT = toPoundsInteger(boxes.box9);

  const payload: HmrcVatReturnPayload = {
    periodKey,
    vatDueSales,
    vatDueAcquisitions,
    totalVatDue,
    vatReclaimedCurrPeriod,
    netVatDue,
    totalValueSalesExVAT,
    totalValuePurchasesExVAT,
    totalValueGoodsSuppliedExVAT,
    totalAcquisitionsExVAT,
    finalised: true,
  };

  const res = await hmrcApiRequest<HmrcVatSubmissionResponse>({
    connection,
    path: `/organisations/vat/${connection.vrn}/returns`,
    method: "POST",
    body: payload,
    fraudHeaders,
  });

  if (!res.ok) {
    const errorData = res.data as { code?: string; message?: string; errors?: Array<{ message: string }> };
    const errorMsg =
      errorData.errors?.[0]?.message ||
      errorData.message ||
      `HMRC rejected return with status ${res.status}`;

    // Record failed submission in audit log
    await db.insert(hmrcVatSubmission).values({
      organizationId,
      taxPeriodId: taxPeriodId || null,
      vrn: connection.vrn,
      periodKey,
      box1: boxes.box1,
      box2: boxes.box2,
      box3: boxes.box3,
      box4: boxes.box4,
      box5: boxes.box5,
      box6: boxes.box6,
      box7: boxes.box7,
      box8: boxes.box8,
      box9: boxes.box9,
      status: "rejected",
      submittedBy: userId,
      requestPayload: payload as unknown as Record<string, unknown>,
      responsePayload: (res.data || {}) as unknown as Record<string, unknown>,
      errorMessage: errorMsg,
    });

    throw new Error(`HMRC Submission Rejected: ${errorMsg}`);
  }

  const result = res.data;

  // Persist successful submission record
  await db.insert(hmrcVatSubmission).values({
    organizationId,
    taxPeriodId: taxPeriodId || null,
    vrn: connection.vrn,
    periodKey,
    box1: boxes.box1,
    box2: boxes.box2,
    box3: boxes.box3,
    box4: boxes.box4,
    box5: boxes.box5,
    box6: boxes.box6,
    box7: boxes.box7,
    box8: boxes.box8,
    box9: boxes.box9,
    formBundleNumber: result.formBundleNumber,
    paymentIndicator: result.paymentIndicator,
    chargeRefNumber: result.chargeRefNumber || null,
    processingDate: result.processingDate ? new Date(result.processingDate) : new Date(),
    status: "submitted",
    submittedBy: userId,
    requestPayload: payload as unknown as Record<string, unknown>,
    responsePayload: result as unknown as Record<string, unknown>,
    errorMessage: null,
  });

  return result;
}

/**
 * Fetch a previously submitted VAT return from HMRC for verification.
 */
export async function getSubmittedVatReturn(params: {
  organizationId: string;
  periodKey: string;
  fraudHeaders?: Record<string, string>;
}): Promise<Record<string, unknown>> {
  const { organizationId, periodKey, fraudHeaders } = params;

  const connection = await db.query.hmrcConnection.findFirst({
    where: eq(hmrcConnection.organizationId, organizationId),
  });

  if (!connection || connection.status !== "connected") {
    throw new Error("HMRC is not connected for this organization.");
  }

  const res = await hmrcApiRequest<Record<string, unknown>>({
    connection,
    path: `/organisations/vat/${connection.vrn}/returns/${periodKey}`,
    method: "GET",
    fraudHeaders,
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch submitted return (HTTP ${res.status})`);
  }

  return res.data;
}
