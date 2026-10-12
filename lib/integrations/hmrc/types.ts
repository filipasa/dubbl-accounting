/**
 * HMRC Making Tax Digital (MTD) for VAT Types
 *
 * References:
 * - VAT (MTD) API v1.0 specifications: https://developer.service.hmrc.gov.uk/api-documentation/docs/api/service/vat-api/1.0
 * - Fraud Prevention Headers: https://developer.service.hmrc.gov.uk/guides/fraud-prevention/
 */

export type HmrcEnvironment = "sandbox" | "production";

export interface HmrcConfig {
  clientId: string;
  clientSecret: string;
  environment: HmrcEnvironment;
  redirectUri: string;
  apiBaseUrl: string;
  oauthAuthorizeUrl: string;
  oauthTokenUrl: string;
}

export interface HmrcTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds (typically 14400 = 4 hours)
  token_type: string;
  scope: string;
}

export interface HmrcObligation {
  start: string; // "2026-01-01"
  end: string;   // "2026-03-31"
  due: string;   // "2026-05-07"
  status: "O" | "F"; // "O" = Open, "F" = Fulfilled
  periodKey: string; // 4 characters e.g. "18A1", "#001"
  received?: string; // Date received if fulfilled
}

export interface HmrcObligationsResponse {
  obligations: Array<{
    obligationDetails: HmrcObligation[];
  }>;
}

/**
 * Box figures in the exact HMRC API format:
 * - Boxes 1-5: monetary values in pounds and pence (two decimal places)
 * - Boxes 6-9: whole integer pounds (no pence)
 * - finalised: boolean legal declaration (must be true)
 */
export interface HmrcVatReturnPayload {
  periodKey: string;
  vatDueSales: number;               // Box 1
  vatDueAcquisitions: number;        // Box 2
  totalVatDue: number;               // Box 3 = Box 1 + Box 2
  vatReclaimedCurrPeriod: number;    // Box 4
  netVatDue: number;                 // Box 5 = |Box 3 - Box 4|
  totalValueSalesExVAT: number;      // Box 6 (integer)
  totalValuePurchasesExVAT: number;  // Box 7 (integer)
  totalValueGoodsSuppliedExVAT: number; // Box 8 (integer)
  totalAcquisitionsExVAT: number;    // Box 9 (integer)
  finalised: true;
}

export interface HmrcVatSubmissionResponse {
  processingDate: string; // ISO 8601 e.g. "2026-10-12T13:20:00Z"
  paymentIndicator: "BANK" | "DD"; // Direct debit vs bank transfer
  formBundleNumber: string; // Unique HMRC filing receipt number e.g. "256660290587"
  chargeRefNumber?: string; // Generated if payment is due
}

export interface HmrcErrorResponse {
  code: string;
  message: string;
  errors?: Array<{
    code: string;
    message: string;
    path?: string;
  }>;
}

/**
 * HMRC Mandatory Anti-Fraud Telemetry Headers
 * See https://developer.service.hmrc.gov.uk/guides/fraud-prevention/
 */
export interface HmrcFraudHeaders {
  "Gov-Client-Connection-Method": "WEB_APP_VIA_SERVER";
  "Gov-Client-Device-ID": string;
  "Gov-Client-User-IDs"?: string;
  "Gov-Client-Timezone": string;
  "Gov-Client-Local-IPs"?: string;
  "Gov-Client-Screens": string;
  "Gov-Client-Window-Size": string;
  "Gov-Client-Browser-Plugins"?: string;
  "Gov-Client-Browser-JS-User-Agent": string;
  "Gov-Client-Browser-Do-Not-Track"?: string;
  "Gov-Client-Multi-Factor"?: string;
  "Gov-Client-Public-IP": string;
  "Gov-Client-Public-Port"?: string;
  "Gov-Vendor-Version": string;
  "Gov-Vendor-License-IDs": string;
}
