import { test } from "node:test";
import assert from "node:assert/strict";
import { isRealProductLine } from "../lib/inventory/product-storage";

test("isRealProductLine distinguishes real products from fees, delivery and discounts", () => {
  // Real products
  assert.equal(isRealProductLine("Pocket Door Kit"), true);
  assert.equal(isRealProductLine("Frameless Hidden Door"), true);
  assert.equal(isRealProductLine("Solid Engineered Oak Door"), true);
  assert.equal(isRealProductLine("Standard Door Supply"), true);
  assert.equal(isRealProductLine("Bespoke concealed door set"), true);

  // Non-products: Shipping / Delivery / Discounts / Fees
  assert.equal(isRealProductLine("Delivery"), false);
  assert.equal(isRealProductLine("Delivery Fee"), false);
  assert.equal(isRealProductLine("delivery fee"), false);
  assert.equal(isRealProductLine("Shipping"), false);
  assert.equal(isRealProductLine("shipping"), false);
  assert.equal(isRealProductLine("Shipping fee"), false);
  assert.equal(isRealProductLine("Carriage fee"), false);
  assert.equal(isRealProductLine("Discount"), false);
  assert.equal(isRealProductLine("discount"), false);
  assert.equal(isRealProductLine("Payment Processing Fee"), false);
  assert.equal(isRealProductLine(""), false);
  assert.equal(isRealProductLine(null), false);
  assert.equal(isRealProductLine(undefined), false);
});

test("resolveOrCreateProductItem returns null for non-product or invalid lines", async () => {
  const { resolveOrCreateProductItem } = await import("../lib/inventory/product-storage");
  const orgId = "org-123";
  assert.equal(await resolveOrCreateProductItem(orgId, { description: "Delivery" }), null);
  assert.equal(await resolveOrCreateProductItem(orgId, { description: "Shipping fee" }), null);
  assert.equal(await resolveOrCreateProductItem(orgId, { description: "Discount" }), null);
  assert.equal(await resolveOrCreateProductItem(orgId, { description: "" }), null);
  assert.equal(await resolveOrCreateProductItem("", { description: "Pocket Door Kit" }), null);
});

test("resolveOrCreateProductItem matches existing catalog item by name", async () => {
  const { resolveOrCreateProductItem } = await import("../lib/inventory/product-storage");
  const { db } = await import("../lib/db");
  const orgId = "org-123";
  const existingItem = {
    id: "item-1",
    organizationId: orgId,
    code: "PRD-0001",
    name: "Pocket Door Kit",
    description: "Pocket Door Kit",
    shortDescription: "Size: 1981 x 762",
    salePrice: 18900,
    imageUrl: null,
  };

  const origFindFirst = db.query.inventoryItem.findFirst;
  try {
    (db.query.inventoryItem as any).findFirst = async () => existingItem;

    const res = await resolveOrCreateProductItem(orgId, {
      description: "pocket door kit",
      unitPrice: 18900,
    });

    assert.ok(res);
    assert.equal(res.isNew, false);
    assert.equal(res.item.id, "item-1");
    assert.equal(res.item.code, "PRD-0001");
    assert.equal(res.item.salePrice, 18900);
  } finally {
    db.query.inventoryItem.findFirst = origFindFirst;
  }
});

test("resolveOrCreateProductItem creates new catalog item with PRD-XXXX when no match exists", async () => {
  const { resolveOrCreateProductItem } = await import("../lib/inventory/product-storage");
  const { db } = await import("../lib/db");
  const orgId = "org-123";
  const origFindFirst = db.query.inventoryItem.findFirst;
  const origSelect = db.select;
  const origInsert = db.insert;

  try {
    (db.query.inventoryItem as any).findFirst = async () => null;

    (db as any).select = () => ({
      from: () => ({
        where: async () => [{ count: 4 }],
      }),
    });

    let insertedValues: any = null;
    (db as any).insert = () => ({
      values: (vals: any) => {
        insertedValues = vals;
        return {
          returning: async () => [
            {
              id: "item-5",
              ...vals,
            },
          ],
        };
      },
    });

    const res = await resolveOrCreateProductItem(orgId, {
      description: "Oak Veneered Internal Door",
      shortDescription: "35mm thickness",
      unitPrice: 22000,
    });

    assert.ok(res);
    assert.equal(res.isNew, true);
    assert.equal(res.item.id, "item-5");
    assert.equal(res.item.code, "PRD-0005");
    assert.equal(res.item.name, "Oak Veneered Internal Door");
    assert.equal(res.item.salePrice, 22000);
    assert.equal(insertedValues.code, "PRD-0005");
  } finally {
    db.query.inventoryItem.findFirst = origFindFirst;
    (db as any).select = origSelect;
    (db as any).insert = origInsert;
  }
});
