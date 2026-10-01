import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTaxRateName, resolveTaxLabel } from "../lib/tax/tax-label";

test("formatTaxRateName formats tax rates correctly", () => {
  assert.equal(formatTaxRateName("VAT", 2000), "VAT (20%)");
  assert.equal(formatTaxRateName("VAT 20%", 2000), "VAT (20%)");
  assert.equal(formatTaxRateName("VAT (20%)", 2000), "VAT (20%)");
  assert.equal(formatTaxRateName("GST 10%", 1000), "GST (10%)");
  assert.equal(formatTaxRateName("Reduced Rate", 500), "Reduced Rate (5%)");
  assert.equal(formatTaxRateName("Sales Tax 8%", 800), "Sales Tax (8%)");
  assert.equal(formatTaxRateName("Special Tax", 1750), "Special Tax (17.5%)");
  assert.equal(formatTaxRateName("Exempt", 0), "Exempt");
  assert.equal(formatTaxRateName("Zero Rate", 0), "Zero Rate");
  assert.equal(formatTaxRateName("", 2000), "Tax (20%)");
  assert.equal(formatTaxRateName(null, 2000), "Tax (20%)");
  assert.equal(formatTaxRateName(null, null), "Tax");
});

test("resolveTaxLabel returns null when taxTotal is 0 or negative", () => {
  assert.equal(resolveTaxLabel([], 0), null);
  assert.equal(resolveTaxLabel([{ taxAmount: 0, taxRate: { name: "VAT", rate: 2000 } }], 0), null);
  assert.equal(resolveTaxLabel(null, 0), null);
  assert.equal(resolveTaxLabel(undefined, -100), null);
});

test("resolveTaxLabel returns formatted tax name when tax is applied", () => {
  const lines = [
    {
      description: "Frameless Door",
      amount: 15000,
      taxAmount: 3000,
      taxRate: { name: "VAT", rate: 2000 },
    },
  ];
  assert.equal(resolveTaxLabel(lines, 3000), "VAT (20%)");
});

test("resolveTaxLabel handles multiple lines with same tax rate", () => {
  const lines = [
    {
      description: "Item 1",
      amount: 10000,
      taxAmount: 2000,
      taxRate: { name: "VAT", rate: 2000 },
    },
    {
      description: "Delivery",
      amount: 2000,
      taxAmount: 400,
      taxRate: { name: "VAT", rate: 2000 },
    },
  ];
  assert.equal(resolveTaxLabel(lines, 2400), "VAT (20%)");
});

test("resolveTaxLabel handles multiple different tax rates", () => {
  const lines = [
    {
      description: "Item 1",
      amount: 10000,
      taxAmount: 2000,
      taxRate: { name: "VAT", rate: 2000 },
    },
    {
      description: "Item 2",
      amount: 5000,
      taxAmount: 250,
      taxRate: { name: "Reduced Rate", rate: 500 },
    },
  ];
  assert.equal(resolveTaxLabel(lines, 2250), "VAT (20%) / Reduced Rate (5%)");
});

test("resolveTaxLabel falls back to fallback rate or Tax if lines have no taxRate object", () => {
  assert.equal(resolveTaxLabel([], 2000, { name: "VAT", rate: 2000 }), "VAT (20%)");
  assert.equal(resolveTaxLabel([], 2000), "Tax");
});
