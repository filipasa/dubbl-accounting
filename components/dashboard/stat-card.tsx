import { useId, useRef, useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { generateOrganicBezierCurve } from "@/lib/analytics/trend-classifier";

export interface SparklinePoint {
  value: number;
  label?: string;
  formattedValue?: string;
}

export interface StatCardProps {
  title: string;
  value: string;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  icon: LucideIcon;
  sparklineData?: (number | SparklinePoint)[];
  badge?: string;
  subtitle?: string;
  isLoading?: boolean;
}

function Sparkline({
  data,
  changeType = "positive",
}: {
  data: (number | SparklinePoint)[];
  changeType?: "positive" | "negative" | "neutral";
}) {
  const gradientId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const points: SparklinePoint[] = useMemo(() => {
    return (data || []).map((d, i) =>
      typeof d === "number"
        ? { value: d, label: `Month ${i + 1}`, formattedValue: d.toLocaleString() }
        : {
            value: d.value,
            label: d.label,
            formattedValue: d.formattedValue ?? d.value.toLocaleString(),
          }
    );
  }, [data]);

  const rawValues = useMemo(() => points.map((p) => p.value), [points]);

  const w = 140;
  const h = 32;
  const padX = 4;
  const padY = 4;

  const curveResult = useMemo(
    () => generateOrganicBezierCurve(rawValues, w, h, padX, padY),
    [rawValues]
  );

  if (points.length < 2) return null;

  const strokeColor =
    changeType === "negative"
      ? "text-red-500 dark:text-red-400"
      : changeType === "neutral"
      ? "text-muted-foreground"
      : "text-emerald-500 dark:text-emerald-400";

  const stopColor =
    changeType === "negative"
      ? "rgba(239, 68, 68, 0.20)"
      : changeType === "neutral"
      ? "rgba(148, 163, 184, 0.16)"
      : "rgba(16, 185, 129, 0.22)";

  const handlePointer = (clientX: number) => {
    if (!containerRef.current || points.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const relX = clientX - rect.left;
    const clampedRelX = Math.max(0, Math.min(rect.width, relX));
    const progress = clampedRelX / (rect.width || 1);
    const closestIdx = Math.min(
      points.length - 1,
      Math.max(0, Math.round(progress * (points.length - 1)))
    );
    setHoverIndex(closestIdx);
  };

  const activeCoord = hoverIndex !== null ? curveResult.points[hoverIndex] : null;
  const activePoint = hoverIndex !== null ? points[hoverIndex] : null;

  return (
    <div
      ref={containerRef}
      onMouseMove={(e) => handlePointer(e.clientX)}
      onMouseLeave={() => setHoverIndex(null)}
      onTouchStart={(e) => {
        if (e.touches[0]) handlePointer(e.touches[0].clientX);
      }}
      onTouchMove={(e) => {
        if (e.touches[0]) handlePointer(e.touches[0].clientX);
      }}
      onTouchEnd={() => setHoverIndex(null)}
      className="relative w-full h-8 select-none touch-none cursor-crosshair group"
    >
      {/* Floating micro-tooltip with month and formatted currency */}
      {hoverIndex !== null && activeCoord && activePoint && (
        <div
          className="pointer-events-none absolute -top-7 z-30 flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border/80 bg-popover/95 px-2 py-0.5 text-[10px] font-medium text-popover-foreground shadow-sm backdrop-blur-sm transition-all duration-75"
          style={{
            left: `${(activeCoord.x / w) * 100}%`,
            transform:
              hoverIndex === 0
                ? "translateX(0%)"
                : hoverIndex === points.length - 1
                ? "translateX(-100%)"
                : "translateX(-50%)",
          }}
        >
          {activePoint.label && (
            <span className="text-muted-foreground">{activePoint.label}</span>
          )}
          <span className="font-semibold font-mono tabular-nums">
            {activePoint.formattedValue}
          </span>
        </div>
      )}

      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="w-full h-full block overflow-visible"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stopColor} />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
        </defs>

        {/* Organic curved fill */}
        <path d={curveResult.areaPath} fill={`url(#${gradientId})`} />

        {/* Smooth organic cubic Bézier curve */}
        <path
          d={curveResult.linePath}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.85"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={strokeColor}
        />

        {/* Interactive hover scrubber: vertical guide hairline + glowing active point dot */}
        {hoverIndex !== null && activeCoord && (
          <g>
            <line
              x1={activeCoord.x}
              y1={0}
              x2={activeCoord.x}
              y2={h}
              stroke="currentColor"
              strokeWidth="1"
              strokeDasharray="2 2"
              className="text-muted-foreground/35"
            />
            {/* Outer halo */}
            <circle
              cx={activeCoord.x}
              cy={activeCoord.y}
              r="5"
              className={cn("fill-current opacity-25", strokeColor)}
            />
            {/* Middle dot */}
            <circle
              cx={activeCoord.x}
              cy={activeCoord.y}
              r="3"
              className={cn("fill-current", strokeColor)}
            />
            {/* Inner center knockout */}
            <circle
              cx={activeCoord.x}
              cy={activeCoord.y}
              r="1.5"
              className="fill-background"
            />
          </g>
        )}
      </svg>
    </div>
  );
}

export function StatCard({
  title,
  value,
  change,
  changeType = "neutral",
  icon: Icon,
  sparklineData,
  badge,
  subtitle,
  isLoading = false,
}: StatCardProps) {
  const isLongValue = value.length > 11;

  return (
    <div className="rounded-lg border bg-card p-3 sm:p-5 flex flex-col justify-between overflow-hidden">
      <div>
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground truncate">
              {title}
            </p>
            {badge && (
              <span className="inline-flex shrink-0 items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {badge}
              </span>
            )}
          </div>
          <Icon className="size-4 text-muted-foreground/50 shrink-0" />
        </div>
        <div className="mt-2 space-y-1">
          {isLoading ? (
            <div className="h-7 w-24 rounded bg-muted animate-pulse" />
          ) : (
            <p
              className={cn(
                "font-bold tracking-tight font-mono tabular-nums whitespace-nowrap",
                isLongValue
                  ? "text-base sm:text-lg xl:text-[19px] 2xl:text-[22px]"
                  : "text-lg sm:text-xl xl:text-[22px] 2xl:text-[24px]"
              )}
            >
              {value}
            </p>
          )}
          {change && (
            <p
              className={cn(
                "text-xs font-medium",
                changeType === "positive" && "text-emerald-600 dark:text-emerald-400",
                changeType === "negative" && "text-red-600 dark:text-red-400",
                changeType === "neutral" && "text-muted-foreground"
              )}
            >
              {change}
            </p>
          )}
        </div>
        {sparklineData && (
          <div className="mt-3 pt-0.5">
            <Sparkline data={sparklineData} changeType={changeType} />
          </div>
        )}
      </div>
      {subtitle && (
        <p className="mt-2 pt-2 border-t text-[11px] text-muted-foreground/80">
          {subtitle}
        </p>
      )}
    </div>
  );
}
