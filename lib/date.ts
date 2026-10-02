/**
 * Centralized date formatting utilities.
 * Synchronizes with organization preference and client localStorage.
 */

export const DATE_FORMAT_OPTIONS = [
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY (e.g. 09/08/2026)" },
  { value: "D MMM YYYY", label: "D MMM YYYY (e.g. 9 Aug 2026)" },
  { value: "D MMMM YYYY", label: "D MMMM YYYY (e.g. 9 August 2026)" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD (e.g. 2026-08-09)" },
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY (e.g. 08/09/2026)" },
  { value: "MMM D, YYYY", label: "MMM D, YYYY (e.g. Aug 9, 2026)" },
] as const;

export type DateFormatPattern = (typeof DATE_FORMAT_OPTIONS)[number]["value"] | string;

export const DEFAULT_DATE_FORMAT: DateFormatPattern = "DD/MM/YYYY";

const MONTH_NAMES_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const MONTH_NAMES_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

let globalDateFormat: string = DEFAULT_DATE_FORMAT;

/** Set active organization date format preference */
export function setGlobalDateFormat(format?: string | null) {
  if (format && typeof format === "string" && format.trim()) {
    globalDateFormat = format.trim();
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("activeOrgDateFormat", globalDateFormat);
      } catch {}
    }
  }
}

/** Get active organization date format preference */
export function getGlobalDateFormat(): string {
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem("activeOrgDateFormat");
      if (stored) return stored;
    } catch {}
  }
  return globalDateFormat;
}

interface ParsedDateParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

function parseDateToParts(value: string | Date | null | undefined): ParsedDateParts | null {
  if (!value) return null;

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
    };
  }

  const str = String(value).trim();
  if (!str) return null;

  // Handle standard YYYY-MM-DD (optionally with time) without timezone shifting
  const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (ymdMatch) {
    return {
      year: parseInt(ymdMatch[1], 10),
      month: parseInt(ymdMatch[2], 10),
      day: parseInt(ymdMatch[3], 10),
    };
  }

  // Handle UK DD/MM/YYYY
  const dmyMatch = /^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})/.exec(str);
  if (dmyMatch) {
    return {
      year: parseInt(dmyMatch[3], 10),
      month: parseInt(dmyMatch[2], 10),
      day: parseInt(dmyMatch[1], 10),
    };
  }

  // Fallback to JS Date parsing
  const d = new Date(str);
  if (isNaN(d.getTime())) return null;
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
  };
}

/**
 * Universal date formatter used across components, tables, detail views, and PDFs.
 *
 * @param date - Date object, ISO string ("2026-08-09"), or timestamp
 * @param formatOverride - Optional specific pattern override, otherwise uses active org format
 * @param fallback - Value returned if date is missing or invalid (default: "—")
 */
export function formatDate(
  date: string | Date | null | undefined,
  formatOverride?: string | null,
  fallback = "—"
): string {
  const parts = parseDateToParts(date);
  if (!parts) return fallback;

  const pattern = (formatOverride && formatOverride.trim()) || getGlobalDateFormat() || DEFAULT_DATE_FORMAT;
  const { year, month, day } = parts;

  const YYYY = String(year);
  const YY = YYYY.slice(-2);
  const MM = String(month).padStart(2, "0");
  const M = String(month);
  const DD = String(day).padStart(2, "0");
  const D = String(day);
  const MMM = MONTH_NAMES_SHORT[month - 1] || MM;
  const MMMM = MONTH_NAMES_FULL[month - 1] || MM;

  switch (pattern) {
    case "DD/MM/YYYY":
      return `${DD}/${MM}/${YYYY}`;
    case "D MMM YYYY":
      return `${D} ${MMM} ${YYYY}`;
    case "D MMMM YYYY":
      return `${D} ${MMMM} ${YYYY}`;
    case "YYYY-MM-DD":
      return `${YYYY}-${MM}-${DD}`;
    case "MM/DD/YYYY":
      return `${MM}/${DD}/${YYYY}`;
    case "MMM D, YYYY":
      return `${MMM} ${D}, ${YYYY}`;
    default:
      // Pattern replacement fallback
      return pattern
        .replace(/\bYYYY\b/g, YYYY)
        .replace(/\bYY\b/g, YY)
        .replace(/\bMMMM\b/g, MMMM)
        .replace(/\bMMM\b/g, MMM)
        .replace(/\bMM\b/g, MM)
        .replace(/\bM\b/g, M)
        .replace(/\bDD\b/g, DD)
        .replace(/\bD\b/g, D);
  }
}
