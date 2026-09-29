"use client";

import * as React from "react";
import { Calendar } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type DashboardPeriodKey =
  | "ytd"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "last_quarter"
  | "last_12_months"
  | "last_year"
  | "all_time";

export interface PeriodRange {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  label: string;
  badge: string;
  displayText: string;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const toISODate = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export function getPeriodRange(
  key: DashboardPeriodKey,
  refDate: Date = new Date()
): PeriodRange {
  const year = refDate.getFullYear();
  const month = refDate.getMonth();
  const todayStr = toISODate(refDate);

  switch (key) {
    case "this_month": {
      const startStr = `${year}-${String(month + 1).padStart(2, "0")}-01`;
      return {
        startDate: startStr,
        endDate: todayStr,
        label: `This Month (${MONTHS[month]})`,
        badge: `${MONTHS[month]} ${year}`,
        displayText: `1 ${MONTHS[month]} ${year} – Today`,
      };
    }
    case "last_month": {
      const lastMonthDate = new Date(year, month - 1, 1);
      const lmYear = lastMonthDate.getFullYear();
      const lmMonth = lastMonthDate.getMonth();
      const lmDays = new Date(lmYear, lmMonth + 1, 0).getDate();
      const startStr = `${lmYear}-${String(lmMonth + 1).padStart(2, "0")}-01`;
      const endStr = `${lmYear}-${String(lmMonth + 1).padStart(2, "0")}-${String(
        lmDays
      ).padStart(2, "0")}`;
      return {
        startDate: startStr,
        endDate: endStr,
        label: `Last Month (${MONTHS[lmMonth]})`,
        badge: `${MONTHS[lmMonth]} ${lmYear}`,
        displayText: `1 ${MONTHS[lmMonth]} – ${lmDays} ${MONTHS[lmMonth]} ${lmYear}`,
      };
    }
    case "this_quarter": {
      const q = Math.floor(month / 3) + 1;
      const qStartMonth = (q - 1) * 3;
      const startStr = `${year}-${String(qStartMonth + 1).padStart(2, "0")}-01`;
      return {
        startDate: startStr,
        endDate: todayStr,
        label: `This Quarter (Q${q})`,
        badge: `Q${q} ${year}`,
        displayText: `1 ${MONTHS[qStartMonth]} ${year} – Today`,
      };
    }
    case "last_quarter": {
      const q = Math.floor(month / 3) + 1;
      const lq = q === 1 ? 4 : q - 1;
      const lqYear = q === 1 ? year - 1 : year;
      const lqStartMonth = (lq - 1) * 3;
      const lqEndMonth = lqStartMonth + 2;
      const lqEndDays = new Date(lqYear, lqEndMonth + 1, 0).getDate();
      const startStr = `${lqYear}-${String(lqStartMonth + 1).padStart(
        2,
        "0"
      )}-01`;
      const endStr = `${lqYear}-${String(lqEndMonth + 1).padStart(
        2,
        "0"
      )}-${String(lqEndDays).padStart(2, "0")}`;
      return {
        startDate: startStr,
        endDate: endStr,
        label: `Last Quarter (Q${lq})`,
        badge: `Q${lq} ${lqYear}`,
        displayText: `1 ${MONTHS[lqStartMonth]} – ${lqEndDays} ${MONTHS[lqEndMonth]} ${lqYear}`,
      };
    }
    case "last_12_months": {
      const pastYearDate = new Date(refDate);
      pastYearDate.setFullYear(year - 1);
      return {
        startDate: toISODate(pastYearDate),
        endDate: todayStr,
        label: "Last 12 Months",
        badge: "Trailing 12M",
        displayText: "Rolling 365 Days",
      };
    }
    case "last_year": {
      const prevYear = year - 1;
      return {
        startDate: `${prevYear}-01-01`,
        endDate: `${prevYear}-12-31`,
        label: `Last Year (${prevYear})`,
        badge: `FY ${prevYear}`,
        displayText: `1 Jan ${prevYear} – 31 Dec ${prevYear}`,
      };
    }
    case "all_time": {
      return {
        startDate: "2000-01-01",
        endDate: todayStr,
        label: "All Time",
        badge: "All Time",
        displayText: "Since Inception",
      };
    }
    case "ytd":
    default: {
      return {
        startDate: `${year}-01-01`,
        endDate: todayStr,
        label: "Year to Date (YTD)",
        badge: "YTD",
        displayText: `1 Jan ${year} – Today`,
      };
    }
  }
}

export const PERIOD_PRESETS: { key: DashboardPeriodKey; label: string }[] = [
  { key: "ytd", label: "Year to Date (YTD)" },
  { key: "this_month", label: "This Month" },
  { key: "last_month", label: "Last Month" },
  { key: "this_quarter", label: "This Quarter" },
  { key: "last_quarter", label: "Last Quarter" },
  { key: "last_12_months", label: "Last 12 Months" },
  { key: "last_year", label: "Last Year" },
  { key: "all_time", label: "All Time" },
];

interface DashboardPeriodSelectProps {
  value: DashboardPeriodKey;
  onChange: (key: DashboardPeriodKey, range: PeriodRange) => void;
  disabled?: boolean;
}

export function DashboardPeriodSelect({
  value,
  onChange,
  disabled = false,
}: DashboardPeriodSelectProps) {
  const currentRange = getPeriodRange(value);

  return (
    <Select
      value={value}
      onValueChange={(val) => {
        const key = val as DashboardPeriodKey;
        onChange(key, getPeriodRange(key));
      }}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        className="h-8 w-auto min-w-[190px] gap-2 rounded-lg border-emerald-950/20 bg-background/90 px-2.5 text-xs font-medium text-foreground shadow-xs transition-colors hover:border-emerald-500/40 hover:bg-emerald-50/50 dark:border-emerald-900 dark:hover:bg-emerald-950/30"
      >
        <Calendar className="size-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <SelectValue placeholder="Select period">
          <span className="truncate">{currentRange.label}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end" className="w-[230px] p-1">
        {PERIOD_PRESETS.map((preset) => {
          const range = getPeriodRange(preset.key);
          return (
            <SelectItem
              key={preset.key}
              value={preset.key}
              className="rounded-md text-xs cursor-pointer py-1.5 focus:bg-emerald-50 dark:focus:bg-emerald-950/50 focus:text-emerald-950 dark:focus:text-emerald-200"
            >
              <div className="flex flex-col text-left">
                <span className="font-medium text-foreground">
                  {preset.label}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {range.displayText}
                </span>
              </div>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
