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

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 80;
  const h = 24;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-6 w-16 sm:w-20 shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-emerald-500"
      />
    </svg>
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
    <div className="rounded-lg border bg-card p-3 sm:p-5 flex flex-col justify-between">
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
        <div className="mt-2 flex items-end justify-between gap-1.5">
          <div className="space-y-1">
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
          {sparklineData && <Sparkline data={sparklineData} />}
        </div>
      </div>
      {subtitle && (
        <p className="mt-2 pt-2 border-t text-[11px] text-muted-foreground/80">
          {subtitle}
        </p>
      )}
    </div>
  );
}
