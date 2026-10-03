import test from "node:test";
import assert from "node:assert/strict";
import { generateOrganicBezierCurve } from "../lib/analytics/trend-classifier";

test("sparkline organic bezier curves calculate distinct shapes for different period series", () => {
  // Monthly trajectory (e.g. YTD or last 12 months with steady linear growth)
  const ytdMonthly = [1000, 2000, 3000, 4000, 5000, 6000];
  const curveYtd = generateOrganicBezierCurve(ytdMonthly, 140, 32);

  // Daily trajectory (e.g. Last Month with mid-month surge)
  const lastMonthDaily = [
    500, 500, 500, 1200, 2500, 4000, 3200, 1800, 900, 600, 500, 500,
  ];
  const curveLastMonth = generateOrganicBezierCurve(lastMonthDaily, 140, 32);

  // Weekly trajectory (e.g. This Quarter with sudden dip and recovery)
  const quarterWeekly = [4000, 3500, 2000, 1000, 800, 2200, 3800, 5000];
  const curveQuarter = generateOrganicBezierCurve(quarterWeekly, 140, 32);

  // Each period has distinct curve paths and points
  assert.notEqual(curveYtd.linePath, curveLastMonth.linePath);
  assert.notEqual(curveYtd.linePath, curveQuarter.linePath);
  assert.notEqual(curveLastMonth.linePath, curveQuarter.linePath);

  assert.equal(curveYtd.points.length, 6);
  assert.equal(curveLastMonth.points.length, 12);
  assert.equal(curveQuarter.points.length, 8);

  assert.equal(curveYtd.trend.type, "linear_growth");
  assert.equal(curveQuarter.trend.type, "recovery");
});

test("sparkline handles single-day boundary with 2 points for smooth rendering", () => {
  // When a period has 1 day (e.g. Today only), our API generates 2 points (Start of Day £0 -> End of Day total)
  const singleDaySeries = [0, 1500];
  const curve = generateOrganicBezierCurve(singleDaySeries, 140, 32);

  assert.equal(curve.points.length, 2);
  assert.ok(curve.linePath.startsWith("M "));
  assert.ok(curve.areaPath.endsWith(" Z"));
  assert.equal(curve.points[0].x < curve.points[1].x, true);
});

test("sparkline handles zero transactions flatline gracefully", () => {
  const zeroSeries = [0, 0, 0, 0, 0];
  const curve = generateOrganicBezierCurve(zeroSeries, 140, 32);

  assert.equal(curve.points.length, 5);
  assert.equal(curve.trend.type, "constant");
  // Y coordinate should be centered within effective height (padY=4, effectiveH=24 -> y=16)
  for (const pt of curve.points) {
    assert.equal(pt.y, 16);
  }
});
