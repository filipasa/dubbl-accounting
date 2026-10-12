import { describe, it } from "node:test";
import assert from "node:assert";
import {
  formatYmd,
  getPresetDates,
  detectPreset,
  Preset,
} from "../components/dashboard/date-range-filter";

describe("DateRangeFilter and Preset Utilities", () => {
  it("formatYmd formats local Date without UTC timezone drift", () => {
    const d = new Date(2026, 9, 1); // 1st October 2026 local
    assert.strictEqual(formatYmd(d), "2026-10-01");

    const endOfMonth = new Date(2026, 10, 0); // 31st October 2026 local
    assert.strictEqual(formatYmd(endOfMonth), "2026-10-31");
  });

  it("getPresetDates calculates correct start and end dates for presets", () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();

    const thisMonth = getPresetDates("this-month");
    assert.ok(thisMonth);
    assert.strictEqual(thisMonth.start, formatYmd(new Date(y, m, 1)));
    assert.strictEqual(thisMonth.end, formatYmd(new Date(y, m + 1, 0)));

    const lastMonth = getPresetDates("last-month");
    assert.ok(lastMonth);
    assert.strictEqual(lastMonth.start, formatYmd(new Date(y, m - 1, 1)));
    assert.strictEqual(lastMonth.end, formatYmd(new Date(y, m, 0)));

    const thisYear = getPresetDates("this-year");
    assert.ok(thisYear);
    assert.strictEqual(thisYear.start, `${y}-01-01`);
    assert.strictEqual(thisYear.end, `${y}-12-31`);

    const lastYear = getPresetDates("last-year");
    assert.ok(lastYear);
    assert.strictEqual(lastYear.start, `${y - 1}-01-01`);
    assert.strictEqual(lastYear.end, `${y - 1}-12-31`);
  });

  it("detectPreset identifies matching preset or returns custom", () => {
    const thisMonth = getPresetDates("this-month")!;
    assert.strictEqual(detectPreset(thisMonth.start, thisMonth.end), "this-month");

    const lastMonth = getPresetDates("last-month")!;
    assert.strictEqual(detectPreset(lastMonth.start, lastMonth.end), "last-month");

    const thisQuarter = getPresetDates("this-quarter")!;
    assert.strictEqual(detectPreset(thisQuarter.start, thisQuarter.end), "this-quarter");

    const thisYear = getPresetDates("this-year")!;
    assert.strictEqual(detectPreset(thisYear.start, thisYear.end), "this-year");

    const lastYear = getPresetDates("last-year")!;
    assert.strictEqual(detectPreset(lastYear.start, lastYear.end), "last-year");

    // Partial year / custom range should return 'custom'
    const now = new Date();
    assert.strictEqual(detectPreset(`${now.getFullYear()}-01-01`, `${now.getFullYear()}-05-15`), "custom");
    assert.strictEqual(detectPreset("2026-02-01", "2026-02-15"), "custom");
  });
});
