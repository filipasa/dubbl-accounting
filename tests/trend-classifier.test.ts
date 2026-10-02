import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyTrend,
  generateOrganicBezierCurve,
} from "../lib/analytics/trend-classifier";

test("classifyTrend detects constant patterns", () => {
  const flat = [5000, 5000, 5000, 5000, 5000];
  const result = classifyTrend(flat);
  assert.equal(result.type, "constant");
  assert.equal(result.changePercent, 0);

  // Near constant (< 4% variation)
  const nearFlat = [5000, 5020, 4980, 5010, 5000];
  const resNear = classifyTrend(nearFlat);
  assert.equal(resNear.type, "constant");
});

test("classifyTrend detects linear growth", () => {
  const linear = [1000, 2000, 3000, 4000, 5000, 6000];
  const result = classifyTrend(linear);
  assert.equal(result.type, "linear_growth");
  assert.ok(result.rSquared >= 0.95);
  assert.ok(result.slope > 0);
  assert.equal(result.isPositive, true);
});

test("classifyTrend detects exponential growth", () => {
  // Accelerating gains
  const exponential = [1000, 1200, 1600, 2400, 4200, 8000];
  const result = classifyTrend(exponential);
  assert.equal(result.type, "exponential_growth");
  assert.ok(result.acceleration > 0);
  assert.equal(result.isPositive, true);
});

test("classifyTrend detects declining trajectories", () => {
  const declining = [8000, 6500, 5000, 3800, 2500, 1200];
  const result = classifyTrend(declining);
  assert.equal(result.type, "declining");
  assert.ok(result.slope < 0);
  assert.equal(result.isPositive, false);
});

test("classifyTrend detects recovery (V-shape / U-shape turnaround)", () => {
  const recovery = [6000, 3500, 1200, 2800, 5000, 7500];
  const result = classifyTrend(recovery);
  assert.equal(result.type, "recovery");
  assert.equal(result.isPositive, true);
});

test("classifyTrend detects volatile oscillation", () => {
  const volatile = [1000, 6000, 1500, 7000, 2000, 6500];
  const result = classifyTrend(volatile);
  assert.equal(result.type, "volatile");
});

test("classifyTrend handles edge cases gracefully", () => {
  assert.equal(classifyTrend([]).type, "constant");
  assert.equal(classifyTrend([100]).type, "constant");
  assert.equal(classifyTrend([100, 200]).type, "linear_growth");
  assert.equal(classifyTrend([200, 100]).type, "declining");
});

test("generateOrganicBezierCurve produces smooth cubic Bézier SVG paths", () => {
  const data = [1200, 1500, 2100, 3200, 5000, 7500];
  const { linePath, areaPath, points, trend } = generateOrganicBezierCurve(
    data,
    140,
    32,
    3,
    4
  );

  assert.equal(points.length, 6);
  assert.equal(trend.type, "exponential_growth");

  // Path should start with M and contain cubic bezier command C
  assert.ok(linePath.startsWith("M "));
  assert.ok(linePath.includes(" C "));

  // Area path should close with Z
  assert.ok(areaPath.startsWith("M "));
  assert.ok(areaPath.endsWith(" Z"));

  // Check that all Y coordinates are within padded bounds [4, 28]
  for (const pt of points) {
    assert.ok(pt.y >= 3.99 && pt.y <= 28.01, `Point Y ${pt.y} should be within bounds`);
    assert.ok(pt.x >= 2.99 && pt.x <= 137.01, `Point X ${pt.x} should be within bounds`);
  }
});

test("generateOrganicBezierCurve handles flat and single value gracefully", () => {
  const flat = generateOrganicBezierCurve([500, 500, 500], 100, 30);
  assert.ok(flat.linePath.startsWith("M "));
  assert.ok(flat.areaPath.endsWith(" Z"));

  const single = generateOrganicBezierCurve([100], 100, 30);
  assert.ok(single.linePath.startsWith("M "));
  assert.equal(single.points.length, 1);

  const empty = generateOrganicBezierCurve([], 100, 30);
  assert.equal(empty.linePath, "");
  assert.equal(empty.points.length, 0);
});
