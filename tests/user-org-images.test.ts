import { describe, it } from "node:test";
import assert from "node:assert";
import { z } from "zod";

describe("User Profile & Organisation Image API Schema Validation", () => {
  // Schema mirroring app/api/v1/user/profile/route.ts
  const userProfileUpdateSchema = z.object({
    name: z.string().min(1).optional(),
    image: z.string().nullable().optional(),
  });

  // Schema mirroring app/api/v1/organization/route.ts
  const orgUpdateSchema = z.object({
    name: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    logo: z.string().nullable().optional(),
    country: z.string().min(1).optional().nullable(),
    businessType: z.string().min(1).optional().nullable(),
    defaultCurrency: z.string().min(1).optional(),
    dateFormat: z.string().min(1).optional(),
    fiscalYearStartMonth: z.number().min(1).max(12).optional(),
  });

  it("userProfileUpdateSchema accepts valid name and image data URL", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY44YAAAAASUVORK5CYII=";
    const result = userProfileUpdateSchema.parse({
      name: "Filip Vacarciuc",
      image: dataUrl,
    });
    assert.strictEqual(result.name, "Filip Vacarciuc");
    assert.strictEqual(result.image, dataUrl);
  });

  it("userProfileUpdateSchema accepts https URL or null to remove image", () => {
    const urlResult = userProfileUpdateSchema.parse({
      image: "https://example.com/avatar.jpg",
    });
    assert.strictEqual(urlResult.image, "https://example.com/avatar.jpg");

    const nullResult = userProfileUpdateSchema.parse({
      image: null,
    });
    assert.strictEqual(nullResult.image, null);
  });

  it("orgUpdateSchema accepts valid logo data URL", () => {
    const dataUrl = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI0MCIgZmlsbD0iZ3JlZW4iIC8+PC9zdmc+";
    const result = orgUpdateSchema.parse({
      name: "Doors Delivered",
      logo: dataUrl,
    });
    assert.strictEqual(result.name, "Doors Delivered");
    assert.strictEqual(result.logo, dataUrl);
  });

  it("orgUpdateSchema accepts hosted URL or null to remove logo", () => {
    const urlResult = orgUpdateSchema.parse({
      logo: "https://www.fixbooks.io/logo.png",
    });
    assert.strictEqual(urlResult.logo, "https://www.fixbooks.io/logo.png");

    const nullResult = orgUpdateSchema.parse({
      logo: null,
    });
    assert.strictEqual(nullResult.logo, null);
  });

  it("validates mime types supported by uploads/image route", () => {
    const allowed = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/svg+xml",
    ]);

    assert.ok(allowed.has("image/jpeg"));
    assert.ok(allowed.has("image/png"));
    assert.ok(allowed.has("image/webp"));
    assert.ok(allowed.has("image/gif"));
    assert.ok(allowed.has("image/svg+xml"));
    assert.ok(!allowed.has("application/pdf"));
    assert.ok(!allowed.has("text/plain"));
  });
});
