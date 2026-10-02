import { useId } from "react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  icon: LucideIcon;
  sparklineData?: number[];
  badge?: string;
  subtitle?: string;
  isLoading?: boolean;
}

function Sparkline({
  data,
  changeType = "positive",
}: {
  data: number[];
  changeType?: "positive" | "negative" | "neutral";
}) {
  const gradientId = useId();
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 120;
  const h = 28;
  const padX = 2;
  const padY = 3;
  const effectiveW = w - 2 * padX;
  const effectiveH = h - 2 * padY;

  const coords = data.map((v, i) => {
    const x = padX + (i / (data.length - 1)) * effectiveW;
    const y = padY + effectiveH - ((v - min) / range) * effectiveH;
    return { x, y };
  });

  const points = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");

  const first = coords[0];
  const last = coords[coords.length - 1];
  const areaPath = `M ${first.x.toFixed(1)},${h} L ${first.x.toFixed(1)},${first.y.toFixed(1)} ${coords
    .slice(1)
    .map((c) => `L ${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(" ")} L ${last.x.toFixed(1)},${h} Z`;

  const strokeColor =
    changeType === "negative"
      ? "text-red-500 dark:text-red-400"
      : "text-emerald-500 dark:text-emerald-400";
  const stopColor =
    changeType === "negative" ? "rgba(239, 68, 68, 0.15)" : "rgba(16, 185, 129, 0.18)";

  return (
    <div className="w-full h-7 overflow-hidden">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="w-full h-full block"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stopColor} />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradientId})`} />
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={strokeColor}
        />
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
