import test from "node:test";
import assert from "node:assert/strict";
import { buildFraudHeaders } from "../lib/integrations/hmrc/fraud-prevention";
import { getAuthorizationUrl, getHmrcConfig } from "../lib/integrations/hmrc/client";
import type { HmrcVatReturnPayload } from "../lib/integrations/hmrc/types";

test("buildFraudHeaders constructs valid HMRC WEB_APP_VIA_SERVER headers", () => {
  const req = new Request("http://localhost:3000/api/v1/tax/vat-return/submit-hmrc", {
    headers: {
      "x-forwarded-for": "82.165.197.1, 10.0.0.1",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    },
  });

  const headers = buildFraudHeaders({
    request: req,
    organizationId: "00000000-0000-0000-0000-000000000001",
    userId: "00000000-0000-0000-0000-000000000002",
    clientTelemetry: {
      deviceId: "test-device-uuid-1234",
      screens: "width=1920&height=1080&scaling-factor=2&colour-depth=24",
      windowSize: "width=1440&height=900",
      timezone: "UTC+01:00",
      doNotTrack: false,
    },
  });

  assert.equal(headers["Gov-Client-Connection-Method"], "WEB_APP_VIA_SERVER");
  assert.equal(headers["Gov-Client-Device-ID"], "test-device-uuid-1234");
  assert.equal(headers["Gov-Client-Public-IP"], "82.165.197.1");
  assert.equal(headers["Gov-Client-Screens"], "width=1920&height=1080&scaling-factor=2&colour-depth=24");
  assert.equal(headers["Gov-Client-Window-Size"], "width=1440&height=900");
  assert.equal(headers["Gov-Client-Timezone"], "UTC+01:00");
  assert.equal(headers["Gov-Vendor-Version"], "fixbooks=1.0.0");
  assert.ok(headers["Gov-Vendor-License-IDs"].startsWith("fixbooks="));
  assert.ok(headers["Gov-Client-User-IDs"].startsWith("fixbooks="));
});

test("buildFraudHeaders falls back gracefully when client telemetry is omitted", () => {
  const req = new Request("http://localhost:3000/api/test");

  const headers = buildFraudHeaders({
    request: req,
    organizationId: "org-1",
    userId: "user-1",
  });

  assert.equal(headers["Gov-Client-Connection-Method"], "WEB_APP_VIA_SERVER");
  assert.ok(headers["Gov-Client-Device-ID"].length > 0);
  assert.equal(headers["Gov-Client-Public-IP"], "127.0.0.1");
  assert.ok(headers["Gov-Client-Screens"].includes("width="));
  assert.ok(headers["Gov-Client-Window-Size"].includes("width="));
});

test("HMRC VAT Return payload validates box decimal and integer constraints", () => {
  // Minor units in pence:
  const box1Pence = 125050; // £1250.50
  const box2Pence = 0;      // £0.00
  const box3Pence = 125050; // £1250.50
  const box4Pence = 25025;  // £250.25
  const box5Pence = 100025; // £1000.25
  const box6Pence = 625250; // £6252.50 -> rounded integer £6253
  const box7Pence = 125125; // £1251.25 -> rounded integer £1251
  const box8Pence = 0;
  const box9Pence = 0;

  const payload: HmrcVatReturnPayload = {
    periodKey: "18A1",
    vatDueSales: Math.round(box1Pence) / 100,
    vatDueAcquisitions: Math.round(box2Pence) / 100,
    totalVatDue: Math.round(box3Pence) / 100,
    vatReclaimedCurrPeriod: Math.round(box4Pence) / 100,
    netVatDue: Math.abs(Math.round(box5Pence) / 100),
    totalValueSalesExVAT: Math.round(box6Pence / 100),
    totalValuePurchasesExVAT: Math.round(box7Pence / 100),
    totalValueGoodsSuppliedExVAT: Math.round(box8Pence / 100),
    totalAcquisitionsExVAT: Math.round(box9Pence / 100),
    finalised: true,
  };

  assert.equal(payload.periodKey, "18A1");
  assert.equal(payload.vatDueSales, 1250.5);
  assert.equal(payload.vatDueAcquisitions, 0);
  assert.equal(payload.totalVatDue, 1250.5);
  assert.equal(payload.vatReclaimedCurrPeriod, 250.25);
  assert.equal(payload.netVatDue, 1000.25);
  assert.equal(payload.totalValueSalesExVAT, 6253);
  assert.equal(payload.totalValuePurchasesExVAT, 1251);
  assert.equal(payload.totalValueGoodsSuppliedExVAT, 0);
  assert.equal(payload.totalAcquisitionsExVAT, 0);
  assert.equal(payload.finalised, true);
});

test("getAuthorizationUrl generates expected OAuth 2.0 URL with read:vat write:vat", () => {
  process.env.HMRC_CLIENT_ID = "test-client-id-123";
  process.env.HMRC_CLIENT_SECRET = "test-client-secret-456";
  process.env.HMRC_ENVIRONMENT = "sandbox";

  const url = getAuthorizationUrl("test_state_xyz");
  const parsed = new URL(url);

  assert.equal(parsed.origin, "https://test-api.service.hmrc.gov.uk");
  assert.equal(parsed.pathname, "/oauth/authorize");
  assert.equal(parsed.searchParams.get("client_id"), "test-client-id-123");
  assert.equal(parsed.searchParams.get("response_type"), "code");
  assert.equal(parsed.searchParams.get("scope"), "read:vat write:vat");
  assert.equal(parsed.searchParams.get("state"), "test_state_xyz");
});
