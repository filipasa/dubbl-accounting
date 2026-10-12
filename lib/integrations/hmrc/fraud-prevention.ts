import crypto from "crypto";
import type { HmrcFraudHeaders } from "./types";

/**
 * Builds the required HMRC Anti-Fraud headers for a WEB_APP_VIA_SERVER architecture.
 *
 * Requirements:
 * https://developer.service.hmrc.gov.uk/guides/fraud-prevention/connection-method/web-app-via-server/
 */
export function buildFraudHeaders(params: {
  request: Request;
  organizationId: string;
  userId: string;
  clientTelemetry?: {
    deviceId?: string;
    screens?: string; // e.g. "width=1920&height=1080&scaling-factor=1&colour-depth=24"
    windowSize?: string; // e.g. "width=1440&height=900"
    timezone?: string; // e.g. "UTC+01:00"
    browserUserAgent?: string;
    doNotTrack?: boolean;
    localIps?: string;
  };
}): Record<string, string> {
  const { request, organizationId, userId, clientTelemetry } = params;

  // Extract public IP from standard proxy headers
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const clientIp = (forwardedFor ? forwardedFor.split(",")[0].trim() : realIp) || "127.0.0.1";

  // Persistent device ID: hashed org + user ID fallback if not provided by client
  const deviceId =
    clientTelemetry?.deviceId ||
    crypto.createHash("sha256").update(`${organizationId}:${userId}:device`).digest("hex");

  // License ID: hashed org ID (never send plain database UUIDs)
  const vendorLicenseId = crypto
    .createHash("sha256")
    .update(`fixbooks:org:${organizationId}`)
    .digest("hex");

  // User ID: hashed user ID
  const hashedUserId = crypto
    .createHash("sha256")
    .update(`fixbooks:user:${userId}`)
    .digest("hex");

  const headers: Record<string, string> = {
    "Gov-Client-Connection-Method": "WEB_APP_VIA_SERVER",
    "Gov-Client-Device-ID": deviceId,
    "Gov-Client-User-IDs": `fixbooks=${hashedUserId}`,
    "Gov-Client-Timezone": clientTelemetry?.timezone || "UTC+00:00",
    "Gov-Client-Screens":
      clientTelemetry?.screens || "width=1920&height=1080&scaling-factor=1&colour-depth=24",
    "Gov-Client-Window-Size": clientTelemetry?.windowSize || "width=1440&height=900",
    "Gov-Client-Browser-JS-User-Agent":
      clientTelemetry?.browserUserAgent ||
      request.headers.get("user-agent") ||
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Gov-Client-Public-IP": clientIp,
    "Gov-Vendor-Version": "fixbooks=1.0.0",
    "Gov-Vendor-License-IDs": `fixbooks=${vendorLicenseId}`,
  };

  if (clientTelemetry?.localIps) {
    headers["Gov-Client-Local-IPs"] = clientTelemetry.localIps;
  }

  if (clientTelemetry?.doNotTrack !== undefined) {
    headers["Gov-Client-Browser-Do-Not-Track"] = clientTelemetry.doNotTrack ? "true" : "false";
  }

  return headers;
}
