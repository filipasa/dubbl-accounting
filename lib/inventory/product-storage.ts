import { db } from "@/lib/db";
import { inventoryItem, quote, quoteLine, invoice, invoiceLine } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { notDeleted } from "@/lib/db/soft-delete";
import { isDiscountLine, isShippingLine } from "@/lib/documents/line-adjustments";

export interface LineItemForProductStore {
  description: string;
  shortDescription?: string | null;
  unitPrice?: number; // minor units / cents
  imageUrl?: string | null;
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
 * Automatically ensures that product line items from quotes or invoices
 * are stored in the inventory_item catalog for the organization.
 */
export async function ensureProductsStored(
  organizationId: string,
  lines: LineItemForProductStore[]
): Promise<void> {
  if (!organizationId || !lines || lines.length === 0) return;

  for (const line of lines) {
    const rawName = (line.description || "").trim();
    if (!isRealProductLine(rawName)) continue;

    try {
      // Check if product with this exact name already exists in org (case-insensitive)
      const existing = await db.query.inventoryItem.findFirst({
        where: and(
          eq(inventoryItem.organizationId, organizationId),
          sql`lower(trim(${inventoryItem.name})) = lower(trim(${rawName}))`,
          notDeleted(inventoryItem.deletedAt)
        ),
      });

      if (!existing) {
        // Generate an item code: e.g. PRD-0001
        const countResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(inventoryItem)
          .where(eq(inventoryItem.organizationId, organizationId));
        const num = (countResult[0]?.count || 0) + 1;
        const code = `PRD-${String(num).padStart(4, "0")}`;

        await db.insert(inventoryItem).values({
          organizationId,
          code,
          name: rawName,
          description: line.shortDescription || rawName,
          shortDescription: line.shortDescription || null,
          salePrice: line.unitPrice || 0,
          imageUrl: line.imageUrl || null,
          quantityOnHand: 0,
          isActive: true,
        });
      } else {
        // Enrich existing item if it lacks image, short description, or non-zero price
        const updates: Record<string, any> = {};
        if (!existing.shortDescription && line.shortDescription) {
          updates.shortDescription = line.shortDescription;
        }
        if (!existing.imageUrl && line.imageUrl) {
          updates.imageUrl = line.imageUrl;
        }
        if ((!existing.salePrice || existing.salePrice === 0) && line.unitPrice && line.unitPrice > 0) {
          updates.salePrice = line.unitPrice;
        }
        if (Object.keys(updates).length > 0) {
          await db
            .update(inventoryItem)
            .set({ ...updates, updatedAt: new Date() })
            .where(eq(inventoryItem.id, existing.id));
        }
      }
    } catch (err) {
      console.error("[ProductStorage] Failed to auto-store product:", rawName, err);
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
