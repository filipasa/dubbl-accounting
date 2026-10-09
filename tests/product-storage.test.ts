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
