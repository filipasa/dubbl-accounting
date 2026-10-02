/**
 * Mathematical Trend Classifier and Organic Bezier Curve Generator
 *
 * Analyzes financial time-series to determine mathematical trajectories
 * (exponential growth, linear growth, declining, constant, recovery, volatile)
 * and produces organic, non-overshooting cubic Bézier curves (Fritsch-Carlson
 * monotone cubic spline) for data visualization.
 */

export type TrendType =
  | "exponential_growth"
  | "linear_growth"
  | "declining"
  | "constant"
  | "recovery"
  | "volatile";

export interface TrendClassification {
  type: TrendType;
  slope: number;
  rSquared: number;
  changePercent: number;
  isPositive: boolean;
  acceleration: number;
}

export interface CurvePoint {
  x: number;
  y: number;
}

export interface OrganicBezierResult {
  linePath: string;
  areaPath: string;
  points: CurvePoint[];
  trend: TrendClassification;
}

/**
 * Classify a financial series into its underlying mathematical trend pattern.
 *
 * @param data Array of numerical values (e.g. monthly revenue in minor units)
 */
export function classifyTrend(data: number[]): TrendClassification {
  if (!data || data.length === 0) {
    return {
      type: "constant",
      slope: 0,
      rSquared: 1,
      changePercent: 0,
      isPositive: true,
      acceleration: 0,
    };
  }

  const n = data.length;
  if (n === 1) {
    return {
      type: "constant",
      slope: 0,
      rSquared: 1,
      changePercent: 0,
      isPositive: true,
      acceleration: 0,
    };
  }

  const first = data[0];
  const last = data[n - 1];
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min;
  const mean = data.reduce((a, b) => a + b, 0) / n;

  // Percentage change from start to finish
  const base = Math.abs(first) || 1;
  const changePercent = ((last - first) / base) * 100;

  // Linear regression (ordinary least squares)
  const xMean = (n - 1) / 2;
  let num = 0;
  let den = 0;
  let ssTot = 0;

  for (let i = 0; i < n; i++) {
    const xDiff = i - xMean;
    const yDiff = data[i] - mean;
    num += xDiff * yDiff;
    den += xDiff * xDiff;
    ssTot += yDiff * yDiff;
  }

  const slope = den !== 0 ? num / den : 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const yPred = mean + slope * (i - xMean);
    const err = data[i] - yPred;
    ssRes += err * err;
  }

  const rSquared = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 1;

  // First differences (velocities) and direction changes
  const deltas: number[] = [];
  let signChanges = 0;
  for (let i = 1; i < n; i++) {
    const d = data[i] - data[i - 1];
    deltas.push(d);
    if (i > 1) {
      const prevD = deltas[i - 2];
      if ((d > 0 && prevD < 0) || (d < 0 && prevD > 0)) {
        signChanges++;
      }
    }
  }

  // Second differences (accelerations)
  const accelerations: number[] = [];
  for (let i = 1; i < deltas.length; i++) {
    accelerations.push(deltas[i] - deltas[i - 1]);
  }
  const avgAcceleration =
    accelerations.length > 0
      ? accelerations.reduce((a, b) => a + b, 0) / accelerations.length
      : 0;

  const isPositive = slope >= 0 && last >= first;

  // 1. Check for Constant (flat or near-flat, variance < 3% of mean)
  const relativeVariation = Math.abs(mean) > 0 ? range / Math.abs(mean) : range;
  if (range === 0 || (relativeVariation < 0.04 && Math.abs(changePercent) < 5)) {
    return {
      type: "constant",
      slope,
      rSquared,
      changePercent,
      isPositive: true,
      acceleration: avgAcceleration,
    };
  }

  // 2. Check for Recovery (V / U shape: drops to trough, then rebounds strongly)
  if (n >= 4) {
    const minVal = Math.min(...data);
    const minIdx = data.indexOf(minVal);
    // Trough occurs in early/middle portion (not first or last)
    if (minIdx >= 1 && minIdx <= n - 2) {
      const drop = first - minVal;
      const rebound = last - minVal;
      // Meaningful drop followed by substantial recovery
      if (drop > 0 && rebound >= drop * 0.4 && last > data[minIdx + 1] && deltas[deltas.length - 1] > 0) {
        return {
          type: "recovery",
          slope,
          rSquared,
          changePercent,
          isPositive: true,
          acceleration: avgAcceleration,
        };
      }
    }
  }

  // 3. Check for Volatility (multiple reversals with substantial amplitude)
  if (signChanges >= 2 && rSquared < 0.6 && relativeVariation > 0.12) {
    return {
      type: "volatile",
      slope,
      rSquared,
      changePercent,
      isPositive: last >= first,
      acceleration: avgAcceleration,
    };
  }

  // 4. Check for Exponential Growth (positive slope + accelerating rate of change)
  if (isPositive && n >= 3) {
    const half = Math.floor(deltas.length / 2);
    const firstHalfDelta = deltas.slice(0, half).reduce((a, b) => a + b, 0);
    const secondHalfDelta = deltas.slice(half).reduce((a, b) => a + b, 0);

    const isHockeyStick =
      secondHalfDelta > firstHalfDelta * 1.35 &&
      deltas[deltas.length - 1] > (deltas[0] || 0) &&
      avgAcceleration > 0;

    if (isHockeyStick) {
      return {
        type: "exponential_growth",
        slope,
        rSquared,
        changePercent,
        isPositive: true,
        acceleration: avgAcceleration,
      };
    }
  }

  // 5. Check for Linear Growth
  if (isPositive) {
    return {
      type: "linear_growth",
      slope,
      rSquared,
      changePercent,
      isPositive: true,
      acceleration: avgAcceleration,
    };
  }

  // 6. Declining
  return {
    type: "declining",
    slope,
    rSquared,
    changePercent,
    isPositive: false,
    acceleration: avgAcceleration,
  };
}

/**
 * Generate smooth organic cubic Bézier SVG paths using Fritsch-Carlson
 * monotone cubic spline interpolation. Guarantees:
 * 1. C1-continuity (buttery smooth curves, no jagged angles)
 * 2. Monotonicity preservation (no overshooting or unnatural bounding box clips)
 * 3. Curve tension adapted organically to the underlying trend
 *
 * @param rawValues Array of numbers
 * @param width Canvas width in SVG units
 * @param height Canvas height in SVG units
 * @param padX Horizontal padding
 * @param padY Vertical padding
 */
export function generateOrganicBezierCurve(
  rawValues: number[],
  width = 140,
  height = 32,
  padX = 3,
  padY = 4
): OrganicBezierResult {
  const trend = classifyTrend(rawValues);

  if (rawValues.length === 0) {
    return {
      linePath: "",
      areaPath: "",
      points: [],
      trend,
    };
  }

  const effectiveW = width - 2 * padX;
  const effectiveH = height - 2 * padY;
  const max = Math.max(...rawValues);
  const min = Math.min(...rawValues);
  const range = max - min;

  // Single point case
  if (rawValues.length === 1) {
    const cy = padY + effectiveH / 2;
    const pt = { x: padX + effectiveW / 2, y: cy };
    return {
      linePath: `M ${padX},${cy} L ${width - padX},${cy}`,
      areaPath: `M ${padX},${height} L ${padX},${cy} L ${width - padX},${cy} L ${width - padX},${height} Z`,
      points: [pt],
      trend,
    };
  }

  // Compute coordinate points
  const points: CurvePoint[] = rawValues.map((v, i) => {
    const x = padX + (i / (rawValues.length - 1)) * effectiveW;
    // SVG y=0 is top, so higher financial values have lower y
    const y =
      range > 0
        ? padY + effectiveH - ((v - min) / range) * effectiveH
        : padY + effectiveH / 2;
    return {
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
    };
  });

  const n = points.length;

  // Compute secants (slopes between consecutive points)
  const dxs: number[] = [];
  const dys: number[] = [];
  const slopes: number[] = [];

  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    dxs.push(dx);
    dys.push(dy);
    slopes.push(dx !== 0 ? dy / dx : 0);
  }

  // Tangents initialization
  const tangents: number[] = new Array(n);
  tangents[0] = slopes[0];
  tangents[n - 1] = slopes[n - 2];

  for (let i = 1; i < n - 1; i++) {
    tangents[i] = (slopes[i - 1] + slopes[i]) / 2;
  }

  // Fritsch-Carlson monotonicity condition to prevent overshooting
  for (let i = 0; i < n - 1; i++) {
    const s = slopes[i];
    if (s === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
    } else {
      const alpha = tangents[i] / s;
      const beta = tangents[i + 1] / s;
      if (alpha < 0) tangents[i] = 0;
      if (beta < 0) tangents[i + 1] = 0;
      if (alpha >= 0 && beta >= 0) {
        const sumSq = alpha * alpha + beta * beta;
        if (sumSq > 9) {
          const tau = 3 / Math.sqrt(sumSq);
          tangents[i] = tau * alpha * s;
          tangents[i + 1] = tau * beta * s;
        }
      }
    }
  }

  // Organic tension parameter adapted by trend pattern
  let tensionA = 1 / 3;
  let tensionB = 1 / 3;

  if (trend.type === "exponential_growth") {
    // Elegant convex lift: softer launch from base, sleek ramp into peak
    tensionA = 0.36;
    tensionB = 0.30;
  } else if (trend.type === "recovery") {
    // Gentle hammock transition through the rebound trough
    tensionA = 0.35;
    tensionB = 0.35;
  } else if (trend.type === "constant") {
    tensionA = 0.33;
    tensionB = 0.33;
  }

  // Build cubic Bézier path commands
  let linePath = `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;

  for (let i = 0; i < n - 1; i++) {
    const dx = dxs[i];
    const cp1x = points[i].x + dx * tensionA;
    const cp1y = points[i].y + tangents[i] * dx * tensionA;

    const cp2x = points[i + 1].x - dx * tensionB;
    const cp2y = points[i + 1].y - tangents[i + 1] * dx * tensionB;

    linePath += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(
      2
    )},${cp2y.toFixed(2)} ${points[i + 1].x.toFixed(2)},${points[
      i + 1
    ].y.toFixed(2)}`;
  }

  // Area fill path closed to bottom of canvas
  const firstPt = points[0];
  const lastPt = points[n - 1];
  const areaPath = `${linePath} L ${lastPt.x.toFixed(2)},${height} L ${firstPt.x.toFixed(
    2
  )},${height} Z`;

  return {
    linePath,
    areaPath,
    points,
    trend,
  };
}
