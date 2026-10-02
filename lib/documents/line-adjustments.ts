export interface DocumentLineAdjustmentLike {
  description?: string | null;
  amount?: number;
  unitPrice?: number;
}

export function isDiscountLine(line: DocumentLineAdjustmentLike): boolean {
  if (!line || !line.description) return false;
  const desc = line.description.trim().toLowerCase();
  return (
    desc.startsWith("discount") ||
    desc === "discount" ||
    (desc.includes("discount") && ((line.amount ?? 0) < 0 || (line.unitPrice ?? 0) < 0))
  );
}

export function isShippingLine(line: DocumentLineAdjustmentLike): boolean {
  if (!line || !line.description) return false;
  const desc = line.description.trim().toLowerCase();
  return (
    desc.startsWith("shipping") ||
    desc === "shipping" ||
    desc.startsWith("shipping fee") ||
    desc.startsWith("delivery")
  );
}

export function isAdjustmentLine(line: DocumentLineAdjustmentLike): boolean {
  return isDiscountLine(line) || isShippingLine(line);
}

export function partitionDocumentLines<T extends DocumentLineAdjustmentLike>(lines: T[] = []) {
  const itemLines: T[] = [];
  const discountLines: T[] = [];
  const shippingLines: T[] = [];

  for (const line of lines) {
    if (isDiscountLine(line)) {
      discountLines.push(line);
    } else if (isShippingLine(line)) {
      shippingLines.push(line);
    } else {
      itemLines.push(line);
    }
  }

  const hasAdjustments = discountLines.length > 0 || shippingLines.length > 0;
  // Fall back to all lines if all lines happened to be adjustments (safeguard)
  const displayItemLines = itemLines.length > 0 || !hasAdjustments ? itemLines : lines;
  const itemsSubtotal = displayItemLines.reduce((s, l) => s + (l.amount ?? 0), 0);

  return {
    itemLines: displayItemLines,
    discountLines,
    shippingLines,
    hasAdjustments,
    itemsSubtotal,
  };
}
