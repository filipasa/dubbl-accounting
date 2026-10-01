import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseAddressString,
  cleanCustomerName,
  normalizeDateInput,
} from "../lib/integrations/whatsapp/executor";
import { sanitizeTelegramHtml } from "../lib/integrations/telegram/client";
import { htmlToWhatsAppMarkdown } from "../lib/integrations/whatsapp/client";

test("parseAddressString handles UK multiline address with country", () => {
  const raw = `25 Sandover
Northampton
NN4 0TS
United Kingdom (UK)`;

  const parsed = parseAddressString(raw);
  assert.equal(parsed.addressLine, "25 Sandover");
  assert.equal(parsed.city, "Northampton");
  assert.equal(parsed.postalCode, "NN4 0TS");
  assert.equal(parsed.country, "United Kingdom");
});

test("parseAddressString handles comma-separated UK address", () => {
  const raw = "45 ROMNEY ROAD, HAYES, UB4 8PU, UK";
  const parsed = parseAddressString(raw);
  assert.equal(parsed.addressLine, "45 ROMNEY ROAD");
  assert.equal(parsed.city, "HAYES");
  assert.equal(parsed.postalCode, "UB4 8PU");
  assert.equal(parsed.country, "United Kingdom");
});

test("cleanCustomerName handles individual with company LTD", () => {
  assert.equal(
    cleanCustomerName("ILIE Sula\nZamos Construction LTD"),
    "Zamos Construction LTD (ILIE Sula)"
  );
  assert.equal(
    cleanCustomerName("ILIE Sula, Zamos Construction LTD"),
    "Zamos Construction LTD (ILIE Sula)"
  );
  assert.equal(cleanCustomerName("John Doe"), "John Doe");
});

test("normalizeDateInput converts DD/MM/YYYY and YYYY-MM-DD", () => {
  assert.equal(normalizeDateInput("09/08/2026"), "2026-08-09");
  assert.equal(normalizeDateInput("9/8/2026"), "2026-08-09");
  assert.equal(normalizeDateInput("2026-08-09"), "2026-08-09");
  assert.equal(normalizeDateInput(""), undefined);
});

test("sanitizeTelegramHtml converts h3/h2/p/br and keeps supported tags", () => {
  const input = `Invoice created! 🎉\n\n🚪 <b>1x Door:</b> £487.50\n🚚 <b>Shipping:</b> £83.33\n<p>Subtotal: £570.83</p>\n<h3>Total: £685.00</h3>`;
  const sanitized = sanitizeTelegramHtml(input);
  assert.match(sanitized, /<b>Total: £685\.00<\/b>/);
  assert.ok(!sanitized.includes("<h3>"));
  assert.ok(!sanitized.includes("<p>"));
  assert.ok(sanitized.includes("<b>1x Door:</b>"));
});

test("htmlToWhatsAppMarkdown converts HTML to WhatsApp markdown", () => {
  const input = `Invoice created! 🎉\n\n🚪 <b>1x Door:</b> £487.50\n🚚 <b>Shipping:</b> £83.33\n<h3>Total: £685.00</h3>`;
  const markdown = htmlToWhatsAppMarkdown(input);
  assert.ok(markdown.includes("*1x Door:*"));
  assert.ok(markdown.includes("*Shipping:*"));
  assert.ok(markdown.includes("*Total: £685.00*"));
  assert.ok(!markdown.includes("<b>"));
  assert.ok(!markdown.includes("<h3>"));
});
