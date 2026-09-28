"use client";

import { useEffect, useState, useRef } from "react";
import { Plus, Trash2, Image as ImageIcon, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AccountPicker } from "./account-picker";

export interface LineItem {
  description: string;
  shortDescription?: string | null;
  quantity: string;
  unitPrice: string;
  accountId: string;
  taxRateId: string;
  imageUrl?: string | null;
}

// Mirrors the tax-rates API row shape ({ taxRates: [...] } from GET /api/v1/tax-rates).
// `rate` is in basis points (e.g. 2000 = 20%).
interface TaxRateOption {
  id: string;
  name: string;
  rate: number;
  type?: string;
  kind?: string;
  recoverablePercent?: number;
  isDefault?: boolean;
}

interface LineItemsEditorProps {
  lines: LineItem[];
  onChange: (lines: LineItem[]) => void;
  accountTypeFilter?: string[];
  // Intent of the document, so we can surface purchase-side reclaim hints.
  taxContext?: "sales" | "purchase";
  // When true (or by default in sales context), pre-selects the Standard Rate (20%) on initial/empty lines and newly added lines.
  defaultToStandardRate?: boolean;
}

// Format a basis-point rate as a percentage (2000 -> "20", 1750 -> "17.5").
function formatRatePct(rate: number) {
  return (rate / 100).toFixed(rate % 100 === 0 ? 0 : 2);
}

// Find standard rate (preferring 20% Standard Rate for sales)
export function findStandardTaxRate(
  rates: TaxRateOption[],
  context?: "sales" | "purchase"
): TaxRateOption | undefined {
  // 1. Look for Standard Rate with rate === 2000 (20%) matching context
  const standard20 = rates.find(
    (t) =>
      t.rate === 2000 &&
      (context ? t.type === "both" || t.type === context : true) &&
      t.name.toLowerCase().includes("standard")
  );
  if (standard20) return standard20;

  // 2. Look for any rate with 2000 bp (20%) matching context
  const any20 = rates.find(
    (t) =>
      t.rate === 2000 &&
      (context ? t.type === "both" || t.type === context : true)
  );
  if (any20) return any20;

  // 3. Look for default rate matching context
  const def = rates.find(
    (t) =>
      t.isDefault &&
      (context ? t.type === "both" || t.type === context : true)
  );
  if (def) return def;

  // 4. Any rate named standard
  const standardNamed = rates.find(
    (t) =>
      t.name.toLowerCase().includes("standard") &&
      (context ? t.type === "both" || t.type === context : true)
  );
  if (standardNamed) return standardNamed;

  return undefined;
}

// Whether a purchase-side rate's input VAT can be reclaimed. Rates that don't
// carry a recoverable portion (exempt/no-vat) or are explicitly partial are
// flagged so users understand what they'll actually get back.
function reclaimHint(rate: TaxRateOption): string | null {
  const kind = rate.kind || "standard";
  if (rate.rate <= 0 || kind === "exempt" || kind === "no_vat" || kind === "sales_tax_us") {
    return "not reclaimable";
  }
  const recoverable = rate.recoverablePercent ?? 10000;
  if (recoverable <= 0) return "not reclaimable";
  if (recoverable < 10000) return `${formatRatePct(recoverable)}% reclaimable`;
  return "reclaimable";
}

async function prepareImageFile(file: File): Promise<File> {
  if (file.type === "image/png" || file.type === "image/jpeg") {
    return file;
  }
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(file);
          return;
        }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          const baseName = file.name.replace(/\.[^.]+$/, "");
          const converted = new File([blob], `${baseName}.png`, { type: "image/png" });
          resolve(converted);
        }, "image/png");
      } catch {
        resolve(file);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

function LineItemImageButton({
  imageUrl,
  onImageChange,
}: {
  imageUrl?: string | null;
  onImageChange: (url: string | null) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fileToUpload = await prepareImageFile(file);
      const formData = new FormData();
      formData.append("file", fileToUpload);
      const res = await fetch("/api/v1/uploads/image", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }
      const data = await res.json();
      onImageChange(data.url);
      toast.success("Image uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to upload image");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="relative group shrink-0">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />
      {imageUrl ? (
        <div className="relative">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            title="Click to change image"
            className="size-8 rounded-full overflow-hidden border border-border bg-muted/40 hover:opacity-85 transition-opacity focus:outline-none focus:ring-1 focus:ring-ring flex items-center justify-center shadow-xs"
          >
            <img
              src={imageUrl}
              alt=""
              className="size-full object-cover"
            />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onImageChange(null);
            }}
            title="Remove image"
            className="absolute -top-1 -right-1 size-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-[10px] shadow"
          >
            <X className="size-2.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          title="Upload line item image"
          className="size-8 rounded-full bg-muted/60 hover:bg-muted border border-dashed border-border flex items-center justify-center transition-colors focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        >
          {uploading ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          ) : (
            <ImageIcon className="size-3.5 text-muted-foreground" />
          )}
        </button>
      )}
    </div>
  );
}

export function LineItemsEditor({
  lines,
  onChange,
  accountTypeFilter,
  taxContext,
  defaultToStandardRate,
}: LineItemsEditorProps) {
  const [taxRates, setTaxRates] = useState<TaxRateOption[]>([]);
  const shouldDefaultStandard = defaultToStandardRate ?? (taxContext === "sales");
  const initialAppliedRef = useRef(false);

  // Fetch the org's tax rates once (org via x-organization-id, mirroring the
  // bank-flow tax dropdown). Best-effort: on failure only "No tax" is offered.
  useEffect(() => {
    const orgId = typeof window !== "undefined" ? localStorage.getItem("activeOrgId") : null;
    if (!orgId) return;
    fetch("/api/v1/tax-rates", { headers: { "x-organization-id": orgId } })
      .then((r) => r.json())
      .then((data) => {
        if (data.taxRates) {
          setTaxRates(data.taxRates);
          if (shouldDefaultStandard && !initialAppliedRef.current) {
            initialAppliedRef.current = true;
            const standardRate = findStandardTaxRate(data.taxRates, taxContext);
            if (standardRate) {
              onChange(
                lines.map((l) => (l.taxRateId ? l : { ...l, taxRateId: standardRate.id }))
              );
            }
          }
        }
      })
      .catch(() => {});
  }, []);

  function updateLine(index: number, field: keyof LineItem, value: string) {
    const updated = lines.map((l, i) =>
      i === index ? { ...l, [field]: value } : l
    );
    onChange(updated);
  }

  function addLine() {
    const standardRate = shouldDefaultStandard ? findStandardTaxRate(taxRates, taxContext) : undefined;
    onChange([
      ...lines,
      {
        description: "",
        shortDescription: "",
        quantity: "1",
        unitPrice: "",
        accountId: "",
        taxRateId: standardRate ? standardRate.id : "",
        imageUrl: null,
      },
    ]);
  }

  function removeLine(index: number) {
    if (lines.length <= 1) return;
    onChange(lines.filter((_, i) => i !== index));
  }

  function lineAmount(line: LineItem) {
    const qty = parseFloat(line.quantity) || 0;
    const price = parseFloat(line.unitPrice) || 0;
    return qty * price;
  }

  // Tax-EXCLUSIVE: tax is computed on top of qty*price, matching how the
  // invoice/bill routes post (taxAmount = round(amount * rateBp / 10000)).
  function lineTax(line: LineItem) {
    if (!line.taxRateId) return 0;
    const rate = taxRates.find((t) => t.id === line.taxRateId);
    if (!rate || rate.rate <= 0) return 0;
    return Math.round((lineAmount(line) * 100 * rate.rate) / 10000) / 100;
  }

  const subtotal = lines.reduce((sum, l) => sum + lineAmount(l), 0);
  const taxTotal = lines.reduce((sum, l) => sum + lineTax(l), 0);
  const total = subtotal + taxTotal;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border">
        <div className="grid grid-cols-[1fr_80px_100px_120px_40px] gap-2 border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
          <span>Description</span>
          <span className="text-right">Qty</span>
          <span className="text-right">Price</span>
          <span className="text-right">Amount</span>
          <span />
        </div>
        {lines.map((line, i) => {
          const selectedRate = line.taxRateId
            ? taxRates.find((t) => t.id === line.taxRateId)
            : undefined;
          const hint =
            taxContext === "purchase" && selectedRate ? reclaimHint(selectedRate) : null;
          return (
            <div
              key={i}
              className="grid grid-cols-[1fr_80px_100px_120px_40px] gap-2 border-b px-3 py-2 last:border-b-0"
            >
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <LineItemImageButton
                    imageUrl={line.imageUrl}
                    onImageChange={(url) => updateLine(i, "imageUrl", url || "")}
                  />
                  <Input
                    className="h-8 text-sm flex-1"
                    value={line.description}
                    onChange={(e) => updateLine(i, "description", e.target.value)}
                    placeholder="Item description *"
                  />
                </div>
                <Textarea
                  className="w-full min-h-[32px] py-1 px-2.5 text-xs text-muted-foreground placeholder:text-muted-foreground/60 resize-y leading-relaxed"
                  rows={1}
                  value={line.shortDescription || ""}
                  onChange={(e) => updateLine(i, "shortDescription", e.target.value)}
                  placeholder="Short description (optional, e.g. Size, specs)"
                />
                <AccountPicker
                  value={line.accountId}
                  onChange={(v) => updateLine(i, "accountId", v)}
                  typeFilter={accountTypeFilter}
                  placeholder="Account"
                />
                <Select
                  value={line.taxRateId || "none"}
                  onValueChange={(v) => updateLine(i, "taxRateId", v === "none" ? "" : v)}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="No tax" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No tax</SelectItem>
                    {taxRates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} ({formatRatePct(t.rate)}%)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {hint && (
                  <p className="text-[11px] text-muted-foreground">{hint}</p>
                )}
              </div>
              <Input
                className="h-8 text-right text-sm font-mono tabular-nums"
                type="number"
                step="1"
                min="1"
                value={line.quantity}
                onChange={(e) => updateLine(i, "quantity", e.target.value)}
              />
              <CurrencyInput
                size="sm"
                value={line.unitPrice}
                onChange={(v) => updateLine(i, "unitPrice", v)}
              />
              <span className="flex h-8 items-center justify-end text-sm font-mono font-medium tabular-nums">
                {lineAmount(line).toFixed(2)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => removeLine(i)}
                disabled={lines.length <= 1}
              >
                <Trash2 className="size-3.5 text-muted-foreground" />
              </Button>
            </div>
          );
        })}
        <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={addLine}
            className="text-xs"
          >
            <Plus className="mr-1 size-3" />
            Add line
          </Button>
          <div className="space-y-0.5 text-right text-sm font-mono tabular-nums">
            <div className="flex justify-between gap-6">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-muted-foreground">Tax</span>
              <span>{taxTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between gap-6 font-semibold">
              <span>Total</span>
              <span>{total.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
