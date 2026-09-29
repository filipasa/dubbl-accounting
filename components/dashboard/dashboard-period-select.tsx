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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type DashboardPeriodKey =
  | "ytd"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "last_quarter"
  | "last_12_months"
  | "last_year"
  | "all_time"
  | "custom";

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

export const toISODate = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export function formatFriendlyDate(s: string): string {
  if (!s) return "";
  const parts = s.split("-");
  if (parts.length !== 3) return s;
  const y = parts[0];
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  if (isNaN(m) || isNaN(d) || m < 0 || m > 11) return s;
  return `${d} ${MONTHS[m]} ${y}`;
}

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
    case "custom": {
      const past30 = new Date(refDate);
      past30.setDate(past30.getDate() - 30);
      return {
        startDate: toISODate(past30),
        endDate: todayStr,
        label: "Custom Range",
        badge: "Custom",
        displayText: "Custom Date Range",
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
  { key: "custom", label: "Custom Range..." },
];

interface DashboardPeriodSelectProps {
  value: DashboardPeriodKey;
  currentRange?: PeriodRange;
  onChange: (key: DashboardPeriodKey, range: PeriodRange) => void;
  disabled?: boolean;
}

export function DashboardPeriodSelect({
  value,
  currentRange,
  onChange,
  disabled = false,
}: DashboardPeriodSelectProps) {
  const activeRange =
    value === "custom" && currentRange
      ? currentRange
      : getPeriodRange(value);

  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [startDateInput, setStartDateInput] = React.useState(
    currentRange?.startDate || toISODate(new Date())
  );
  const [endDateInput, setEndDateInput] = React.useState(
    currentRange?.endDate || toISODate(new Date())
  );
  const [dateError, setDateError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (currentRange) {
      setStartDateInput(currentRange.startDate);
      setEndDateInput(currentRange.endDate);
    }
  }, [currentRange]);

  const handleApplyCustom = () => {
    if (!startDateInput || !endDateInput) {
      setDateError("Please enter both start and end dates.");
      return;
    }
    if (startDateInput > endDateInput) {
      setDateError("Start date cannot be after end date.");
      return;
    }
    setDateError(null);
    const displayText = `${formatFriendlyDate(startDateInput)} – ${formatFriendlyDate(endDateInput)}`;
    onChange("custom", {
      startDate: startDateInput,
      endDate: endDateInput,
      label: "Custom Range",
      badge: "Custom",
      displayText,
    });
    setIsDialogOpen(false);
  };

  return (
    <>
      <Select
        value={value}
        onValueChange={(val) => {
          const key = val as DashboardPeriodKey;
          if (key === "custom") {
            setIsDialogOpen(true);
          } else {
            onChange(key, getPeriodRange(key));
          }
        }}
        disabled={disabled}
      >
        <SelectTrigger
          size="sm"
          className="h-8 w-auto min-w-[190px] gap-2 rounded-lg border-emerald-950/20 bg-background/90 px-2.5 text-xs font-medium text-foreground shadow-xs transition-colors hover:border-emerald-500/40 hover:bg-emerald-50/50 dark:border-emerald-900 dark:hover:bg-emerald-950/30"
        >
          <Calendar className="size-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <SelectValue placeholder="Select period">
            <span className="truncate">
              {value === "custom"
                ? `Custom: ${activeRange.displayText}`
                : activeRange.label}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="end" className="w-[240px] p-1">
          {PERIOD_PRESETS.map((preset) => {
            const range =
              preset.key === "custom" && currentRange
                ? currentRange
                : getPeriodRange(preset.key);

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
                    {preset.key === "custom"
                      ? value === "custom"
                        ? range.displayText
                        : "Pick custom start & end dates"
                      : range.displayText}
                  </span>
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Custom Date Range</DialogTitle>
            <DialogDescription className="text-xs">
              Choose custom start and end dates to filter financial metrics.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="custom-start-date" className="text-xs">
                  From Date
                </Label>
                <Input
                  id="custom-start-date"
                  type="date"
                  value={startDateInput}
                  onChange={(e) => {
                    setStartDateInput(e.target.value);
                    setDateError(null);
                  }}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="custom-end-date" className="text-xs">
                  To Date
                </Label>
                <Input
                  id="custom-end-date"
                  type="date"
                  value={endDateInput}
                  onChange={(e) => {
                    setEndDateInput(e.target.value);
                    setDateError(null);
                  }}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            {dateError && (
              <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                {dateError}
              </p>
            )}

            {startDateInput && endDateInput && startDateInput <= endDateInput && (
              <div className="rounded-md border bg-muted/30 p-2.5 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Selected window: </span>
                <span>{formatFriendlyDate(startDateInput)} – {formatFriendlyDate(endDateInput)}</span>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="bg-emerald-950 text-white hover:bg-emerald-900"
              onClick={handleApplyCustom}
            >
              Apply Range
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
