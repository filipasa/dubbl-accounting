export interface TaxRateLike {
  name?: string | null;
  rate?: number | null; // in basis points, e.g. 2000 = 20%
}

export interface TaxLineLike {
  taxAmount?: number | null;
  amount?: number | null;
  taxRate?: TaxRateLike | null;
  taxRateId?: string | null;
}

/**
 * Format a tax rate name and basis points into a standard user-facing label.
 * E.g.:
 * - ("VAT", 2000) -> "VAT (20%)"
 * - ("VAT 20%", 2000) -> "VAT (20%)"
 * - ("GST 10%", 1000) -> "GST (10%)"
 * - ("Reduced Rate", 500) -> "Reduced Rate (5%)"
 * - ("Sales Tax 8%", 800) -> "Sales Tax (8%)"
 * - ("Exempt", 0) -> "Exempt"
 */
export function formatTaxRateName(name?: string | null, rate?: number | null): string {
  const trimmed = (name || "").trim();
  if (!trimmed && (rate == null || rate <= 0)) {
    return "Tax";
  }

  // Extract percentage from rate basis points or from the name string
  let pct: string | null = null;
  if (rate != null && rate > 0) {
    const val = rate / 100;
    pct = Number.isInteger(val) ? val.toString() : val.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  } else if (trimmed) {
    const match = trimmed.match(/(\d+(?:\.\d+)?)%/);
    if (match) {
      pct = match[1];
    }
  }

  // Clean trailing percentage or parenthesized percentage from the name
  let baseName = trimmed
    .replace(/\s*\(\s*\d+(?:\.\d+)?%\s*\)/g, "")
    .replace(/\s+\d+(?:\.\d+)?%/g, "")
    .trim();

  if (!baseName) {
    baseName = "Tax";
  }

  if (pct) {
    return `${baseName} (${pct}%)`;
  }

  return baseName;
}

/**
 * Resolve the dynamic tax label for a document (invoice, quote, etc.) based on its lines and tax total.
 * Returns null if taxTotal <= 0 (or no tax applied), indicating that no tax row should be displayed underneath Subtotal.
 * When tax was selected, returns the formatted tax label, e.g. "VAT (20%)".
 */
export function resolveTaxLabel(
  lines?: TaxLineLike[] | null,
  taxTotal?: number | null,
  fallback?: TaxRateLike | null
): string | null {
  if (taxTotal !== undefined && taxTotal !== null && taxTotal <= 0) {
    return null;
  }

  if (lines && lines.length > 0) {
    // Look for lines that have positive taxAmount or a taxRate with positive rate
    const taxedLines = lines.filter(
      (l) => (l.taxAmount ?? 0) > 0 || (l.taxRate && (l.taxRate.rate ?? 0) > 0)
    );

    const candidates = taxedLines.length > 0 ? taxedLines : lines;
    const labels = Array.from(
      new Set(
        candidates
          .map((l) => (l.taxRate?.name ? formatTaxRateName(l.taxRate.name, l.taxRate.rate) : null))
          .filter((lbl): lbl is string => Boolean(lbl))
      )
    );

    if (labels.length === 1) {
      return labels[0];
    }
    if (labels.length > 1) {
      return labels.join(" / ");
    }
  }

  if (fallback?.name) {
    return formatTaxRateName(fallback.name, fallback.rate);
  }

  // If taxTotal is positive but no taxRate details could be resolved, fall back to "Tax"
  if (taxTotal && taxTotal > 0) {
    return "Tax";
  }

  return null;
}
