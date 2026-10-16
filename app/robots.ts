import type { MetadataRoute } from "next";
import { getPublicSiteUrl } from "@/lib/public-url";

const APP_URL = getPublicSiteUrl();

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/dashboard/", "/settings/", "/onboarding/"],
      },
    ],
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}
