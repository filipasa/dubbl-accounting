const DEFAULT_SITE_URL = "https://fixbooks.io";
const DEFAULT_APP_URL = "https://fixbooks.io";

function trimTrailingSlash(url: string) {
  return url.replace(/\/+$/, "");
}

function joinUrl(baseUrl: string, path = "") {
  const normalizedPath = path ? `/${path.replace(/^\/+/, "")}` : "";
  return `${trimTrailingSlash(baseUrl)}${normalizedPath}`;
}

export function getPublicAppUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (envUrl) {
    const trimmed = trimTrailingSlash(envUrl);
    // Ignore internal vercel.app domains (e.g. dubbl-accounting.vercel.app)
    if (!trimmed.includes("vercel.app")) {
      return trimmed;
    }
  }
  return DEFAULT_APP_URL;
}

export function getPublicSiteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    const trimmed = trimTrailingSlash(process.env.NEXT_PUBLIC_SITE_URL);
    if (!trimmed.includes("vercel.app")) {
      return trimmed;
    }
  }

  const appUrl = getPublicAppUrl();
  if (appUrl.endsWith("/app")) {
    return appUrl.slice(0, -4);
  }

  return appUrl;
}

/**
 * Resolve the public base URL for customer-facing links (payment links, invoice PDFs, emails).
 * - In local dev (localhost / 127.0.0.1), preserves http://localhost:port so local testing works.
 * - If request host is a vercel.app preview/deployment domain, overrides it with fixbooks.io.
 * - If request host is fixbooks.io or www.fixbooks.io, preserves it.
 * - Otherwise falls back to getPublicAppUrl() (https://fixbooks.io).
 */
export function resolvePublicBaseUrl(request?: Request): string {
  if (request) {
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
    if (host) {
      if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) {
        const proto = request.headers.get("x-forwarded-proto") || "http";
        return `${proto}://${host}`;
      }
      if (host === "fixbooks.io" || host === "www.fixbooks.io") {
        return `https://${host}`;
      }
      // If host is *.vercel.app or any other deployment host, use fixbooks.io
      return DEFAULT_APP_URL;
    }
  }
  return getPublicAppUrl();
}

export function toAppUrl(path = "") {
  return joinUrl(getPublicAppUrl(), path);
}

export function toSiteUrl(path = "") {
  return joinUrl(getPublicSiteUrl(), path);
}
