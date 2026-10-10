import { db } from "@/lib/db";
import { inventoryItem, quote, quoteLine, invoice, invoiceLine } from "@/lib/db/schema";
import { eq, and, or, sql } from "drizzle-orm";
import { notDeleted } from "@/lib/db/soft-delete";
import { isDiscountLine, isShippingLine } from "@/lib/documents/line-adjustments";

export interface LineItemForProductStore {
  description: string;
  shortDescription?: string | null;
  unitPrice?: number; // minor units / cents
  imageUrl?: string | null;
}

export interface ResolveProductItemResult {
  item: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    shortDescription: string | null;
    salePrice: number; // minor units / cents
    imageUrl: string | null;
  };
  isNew: boolean;
}

/**
 * Checks if a line item describes an actual sellable product
 * rather than a fee, delivery/shipping, or discount adjustment.
 */
export function isRealProductLine(desc: string | null | undefined): boolean {
  if (!desc) return false;
  const trimmed = desc.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();

  if (isDiscountLine({ description: trimmed }) || isShippingLine({ description: trimmed })) {
    return false;
  }
  if (lower.startsWith("delivery") || lower.startsWith("shipping") || lower.includes("carriage fee") || lower === "payment processing fee") {
    return false;
  }
  return true;
}

/**
 * Checks if a matching product already exists in the organization's inventory items
 * (matching case-insensitively by item name, item code, or SKU).
 * - If a match exists: returns the existing catalog item (isNew: false) and updates missing details.
 * - If no match exists: creates a new inventory item with PRD-XXXX code (isNew: true).
 */
export async function resolveOrCreateProductItem(
  organizationId: string,
  line: LineItemForProductStore
): Promise<ResolveProductItemResult | null> {
  if (!organizationId || !line || !line.description) return null;

  const rawName = (line.description || "").trim();
  if (!isRealProductLine(rawName)) return null;

  // Strip optional quantity multipliers like "2x " or "3 x " from beginning
  const cleanName = rawName.replace(/^\d+\s*[xX]\s+/, "").trim();
  const searchTerms = Array.from(
    new Set([rawName.toLowerCase(), cleanName.toLowerCase()])
  ).filter(Boolean);

  // Look up existing inventory item
  const existing = await db.query.inventoryItem.findFirst({
    where: and(
      eq(inventoryItem.organizationId, organizationId),
      or(
        ...searchTerms.map(
          (t) => sql`lower(trim(${inventoryItem.name})) = ${t}`
        ),
        ...searchTerms.map(
          (t) => sql`lower(trim(${inventoryItem.code})) = ${t}`
        ),
        ...searchTerms.map(
          (t) => sql`lower(trim(coalesce(${inventoryItem.sku}, ''))) = ${t}`
        )
      ),
      notDeleted(inventoryItem.deletedAt)
    ),
  });

  if (existing) {
    const updates: Record<string, any> = {};
    if (!existing.shortDescription && line.shortDescription) {
      updates.shortDescription = line.shortDescription;
    }
    if (!existing.imageUrl && line.imageUrl) {
      updates.imageUrl = line.imageUrl;
    }
    if (
      (!existing.salePrice || existing.salePrice === 0) &&
      line.unitPrice &&
      line.unitPrice > 0
    ) {
      updates.salePrice = line.unitPrice;
    }
    if (Object.keys(updates).length > 0) {
      await db
        .update(inventoryItem)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(inventoryItem.id, existing.id));
      Object.assign(existing, updates);
    }
    return {
      item: {
        id: existing.id,
        code: existing.code,
        name: existing.name,
        description: existing.description,
        shortDescription: existing.shortDescription,
        salePrice: existing.salePrice,
        imageUrl: existing.imageUrl,
      },
      isNew: false,
    };
  }

  // Not found -> create new inventory item in catalog
  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inventoryItem)
    .where(eq(inventoryItem.organizationId, organizationId));

  let nextNum = (countResult[0]?.count || 0) + 1;
  let code = `PRD-${String(nextNum).padStart(4, "0")}`;

  // Collision prevention
  let existingCode = await db.query.inventoryItem.findFirst({
    where: and(
      eq(inventoryItem.organizationId, organizationId),
      eq(inventoryItem.code, code)
    ),
  });
  while (existingCode) {
    nextNum++;
    code = `PRD-${String(nextNum).padStart(4, "0")}`;
    existingCode = await db.query.inventoryItem.findFirst({
      where: and(
        eq(inventoryItem.organizationId, organizationId),
        eq(inventoryItem.code, code)
      ),
    });
  }

  const [created] = await db
    .insert(inventoryItem)
    .values({
      organizationId,
      code,
      name: cleanName || rawName,
      description: line.shortDescription || cleanName || rawName,
      shortDescription: line.shortDescription || null,
      salePrice: line.unitPrice || 0,
      imageUrl: line.imageUrl || null,
      quantityOnHand: 0,
      isActive: true,
    })
    .returning();

  return {
    item: {
      id: created.id,
      code: created.code,
      name: created.name,
      description: created.description,
      shortDescription: created.shortDescription,
      salePrice: created.salePrice,
      imageUrl: created.imageUrl,
    },
    isNew: true,
  };
}

/**
 * Automatically ensures that product line items from quotes or invoices
 * are stored in the inventory_item catalog for the organization.
 */
export async function ensureProductsStored(
  organizationId: string,
  lines: LineItemForProductStore[]
): Promise<void> {
  if (!organizationId || !lines || lines.length === 0) return;

  for (const line of lines) {
    try {
      await resolveOrCreateProductItem(organizationId, line);
    } catch (err) {
      console.error("[ProductStorage] Failed to auto-store product:", line.description, err);
    }
  }
}

/**
 * Backfills products from existing quotes and invoices for an organization.
 */
export async function backfillProductsFromDocuments(organizationId: string): Promise<number> {
  const quoteLines = await db
    .select({
      description: quoteLine.description,
      shortDescription: quoteLine.shortDescription,
      unitPrice: quoteLine.unitPrice,
      imageUrl: quoteLine.imageUrl,
    })
    .from(quoteLine)
    .innerJoin(quote, eq(quoteLine.quoteId, quote.id))
    .where(and(eq(quote.organizationId, organizationId), notDeleted(quote.deletedAt)));

  const invLines = await db
    .select({
      description: invoiceLine.description,
      shortDescription: invoiceLine.shortDescription,
      unitPrice: invoiceLine.unitPrice,
      imageUrl: invoiceLine.imageUrl,
    })
    .from(invoiceLine)
    .innerJoin(invoice, eq(invoiceLine.invoiceId, invoice.id))
    .where(and(eq(invoice.organizationId, organizationId), notDeleted(invoice.deletedAt)));

  const allLines = [...quoteLines, ...invLines];
  await ensureProductsStored(organizationId, allLines);
  return allLines.length;
}
