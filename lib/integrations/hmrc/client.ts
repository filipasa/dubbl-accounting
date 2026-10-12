import { db } from "@/lib/db";
import { hmrcConnection } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { HmrcConfig, HmrcEnvironment, HmrcTokenResponse } from "./types";

/**
 * Returns HMRC OAuth & API configuration based on environment variables.
 */
export function getHmrcConfig(): HmrcConfig {
  const environment: HmrcEnvironment =
    process.env.HMRC_ENVIRONMENT === "production" ? "production" : "sandbox";

  const isProd = environment === "production";
  const apiBaseUrl = isProd
    ? "https://api.service.hmrc.gov.uk"
    : "https://test-api.service.hmrc.gov.uk";

  const redirectUri =
    process.env.HMRC_REDIRECT_URI ||
    (process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/api/v1/integrations/hmrc/callback`
      : "https://www.fixbooks.io/api/v1/integrations/hmrc/callback");

  return {
    clientId: process.env.HMRC_CLIENT_ID || "",
    clientSecret: process.env.HMRC_CLIENT_SECRET || "",
    environment,
    redirectUri,
    apiBaseUrl,
    oauthAuthorizeUrl: `${apiBaseUrl}/oauth/authorize`,
    oauthTokenUrl: `${apiBaseUrl}/oauth/token`,
  };
}

/**
 * Generate the OAuth 2.0 URL to direct the user to HMRC Government Gateway.
 */
export function getAuthorizationUrl(state: string): string {
  const config = getHmrcConfig();
  if (!config.clientId) {
    throw new Error("HMRC_CLIENT_ID is not configured in environment variables.");
  }

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    scope: "read:vat write:vat",
    redirect_uri: config.redirectUri,
    state,
  });

  return `${config.oauthAuthorizeUrl}?${params.toString()}`;
}

/**
 * Exchange an OAuth authorization code for access and refresh tokens.
 */
export async function exchangeCodeForTokens(code: string): Promise<HmrcTokenResponse> {
  const config = getHmrcConfig();
  if (!config.clientId || !config.clientSecret) {
    throw new Error("HMRC_CLIENT_ID or HMRC_CLIENT_SECRET is not configured.");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    code,
  });

  const res = await fetch(config.oauthTokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error("[HMRC Token Exchange] Failed:", errorText);
    throw new Error(`HMRC Token Exchange Failed (${res.status}): ${errorText}`);
  }

  return res.json();
}

/**
 * Refreshes an expired or near-expired access token using the stored refresh token.
 */
export async function refreshAccessToken(
  connection: typeof hmrcConnection.$inferSelect
): Promise<string> {
  const config = getHmrcConfig();

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: connection.refreshToken,
  });

  const res = await fetch(config.oauthTokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error("[HMRC Token Refresh] Failed:", errorText);
    await db
      .update(hmrcConnection)
      .set({
        status: "expired",
        lastError: `Token refresh failed: ${errorText}`,
        updatedAt: new Date(),
      })
      .where(eq(hmrcConnection.id, connection.id));

    throw new Error(`HMRC Token Refresh Failed (${res.status}). Please reconnect your HMRC account.`);
  }

  const tokenData: HmrcTokenResponse = await res.json();
  const tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

  await db
    .update(hmrcConnection)
    .set({
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenExpiresAt,
      status: "connected",
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(hmrcConnection.id, connection.id));

  return tokenData.access_token;
}

/**
 * Ensures the connection has an active, valid access token, auto-refreshing if within 5 mins of expiry.
 */
export async function ensureValidAccessToken(
  connection: typeof hmrcConnection.$inferSelect
): Promise<string> {
  const expiresAt = new Date(connection.tokenExpiresAt).getTime();
  const now = Date.now();
  const fiveMinutesMs = 5 * 60 * 1000;

  if (expiresAt - now < fiveMinutesMs) {
    return refreshAccessToken(connection);
  }

  return connection.accessToken;
}

/**
 * Perform an authenticated request to the HMRC API.
 */
export async function hmrcApiRequest<T>(params: {
  connection: typeof hmrcConnection.$inferSelect;
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  fraudHeaders?: Record<string, string>;
}): Promise<{ ok: boolean; status: number; data: T; rawText?: string }> {
  const { connection, path, method = "GET", body, fraudHeaders = {} } = params;
  const config = getHmrcConfig();

  const token = await ensureValidAccessToken(connection);
  const url = `${config.apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.hmrc.1.0+json",
    ...fraudHeaders,
  };

  if (body) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  } else {
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      return { ok: res.ok, status: res.status, data, rawText: text };
    } catch {
      return { ok: res.ok, status: res.status, data: text as unknown as T, rawText: text };
    }
  }
}
