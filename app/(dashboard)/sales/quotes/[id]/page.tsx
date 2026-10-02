"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Send, Check, X, FileText, Pencil } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ContactPicker } from "@/components/dashboard/contact-picker";
import { LineItemsEditor, type LineItem } from "@/components/dashboard/line-items-editor";
import { formatMoney, minorUnitsToDecimal } from "@/lib/money";
import { useEntityTitle } from "@/lib/hooks/use-entity-title";
import { SendDocumentDialog } from "@/components/dashboard/send-document-dialog";
import { EmailHistory } from "@/components/dashboard/email-history";
import { formatContactAddress } from "@/lib/documents/address";
import { resolveTaxLabel } from "@/lib/tax/tax-label";
import { formatDate } from "@/lib/date";
import { partitionDocumentLines } from "@/lib/documents/line-adjustments";
import Link from "next/link";

interface QuoteDetail {
  id: string;
  quoteNumber: string;
  issueDate: string;
  expiryDate: string;
  status: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  reference: string | null;
  notes: string | null;
  currencyCode?: string;
  contactId: string;
  contact: { name: string; email: string | null; taxNumber?: string | null; addresses?: any } | null;
  lines: {
    id: string;
    description: string;
    quantity: number;
    unitPrice: number;
    amount: number;
    taxAmount?: number;
    imageUrl?: string | null;
    shortDescription?: string | null;
    account: { id: string; code: string; name: string } | null;
    taxRate?: { id: string; name: string; rate: number } | null;
  }[];
}

const statusColors: Record<string, string> = {
  draft: "",
  sent: "border-blue-200 bg-blue-50 text-blue-700",
  accepted: "border-emerald-200 bg-emerald-50 text-emerald-700",
  declined: "border-red-200 bg-red-50 text-red-700",
  expired: "border-gray-200 bg-gray-50 text-gray-700",
  converted: "border-purple-200 bg-purple-50 text-purple-700",
};

// Plain-language status labels (end users aren't accountants).
const statusLabels: Record<string, string> = {
  draft: "draft",
  sent: "sent",
  accepted: "accepted",
  declined: "declined",
  expired: "expired",
  converted: "turned into an invoice",
};

export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [q, setQ] = useState<QuoteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [emailHistoryKey, setEmailHistoryKey] = useState(0);
  const [orgName, setOrgName] = useState("");
  useEntityTitle(q?.quoteNumber);
  const orgId = typeof window !== "undefined" ? localStorage.getItem("activeOrgId") : null;

  useEffect(() => {
    if (!orgId) return;
    fetch(`/api/v1/quotes/${id}`, { headers: { "x-organization-id": orgId } })
      .then((r) => r.json())
      .then((data) => {
        if (data.quote) setQ(data.quote);
      })
      .finally(() => setLoading(false));

    fetch("/api/v1/organization", { headers: { "x-organization-id": orgId } })
      .then((r) => r.json())
      .then((data) => {
        if (data.organization?.name) setOrgName(data.organization.name);
      })
      .catch(() => {});
  }, [id, orgId]);

  function refetchQuote() {
    if (!orgId) return;
    fetch(`/api/v1/quotes/${id}`, { headers: { "x-organization-id": orgId } })
      .then((r) => r.json())
      .then((data) => {
        if (data.quote) setQ(data.quote);
      });
  }

  async function action(path: string) {
    if (!orgId) return;
    const res = await fetch(`/api/v1/quotes/${id}/${path}`, {
      method: "POST",
      headers: { "x-organization-id": orgId },
    });
    if (res.ok) {
      const data = await res.json();
      setQ((prev) => (prev ? { ...prev, ...(data.quote || {}) } : prev));
      toast.success("Done");
    } else {
      toast.error("Failed");
    }
  }

  function handleSendComplete() {
    refetchQuote();
    setEmailHistoryKey((k) => k + 1);
  }

  async function handleConvert() {
    if (!orgId) return;
    const res = await fetch(`/api/v1/quotes/${id}/convert`, {
      method: "POST",
      headers: { "x-organization-id": orgId },
    });
    if (res.ok) {
      const data = await res.json();
      toast.success("Invoice created from this quote");
      router.push(`/sales/${data.invoice.id}`);
    } else {
      toast.error("Couldn't create an invoice from this quote");
    }
  }

  if (loading) return <div className="space-y-6"><PageHeader title="Loading..." /></div>;
  if (!q) return <div className="space-y-6"><PageHeader title="Quote not found" /></div>;

  const contactAddress = formatContactAddress(q.contact?.addresses);
  const hasAnyLineImage = q.lines.some((l) => !!l.imageUrl);

  return (
    <div className="space-y-6">
      <PageHeader
        title={q.quoteNumber}
        description={`To: ${q.contact?.name || "Unknown"}${contactAddress ? ` · ${contactAddress}` : ""}`}
      >
        <Button variant="outline" size="sm" asChild>
          <Link href="/sales/quotes"><ArrowLeft className="mr-2 size-4" />Back</Link>
        </Button>
        {q.status === "draft" && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditOpen(true)}
              title="Edit this draft quote"
            >
              <Pencil className="mr-2 size-4" />Edit
            </Button>
            <Button
              size="sm"
              onClick={() => setSendDialogOpen(true)}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <Send className="mr-2 size-4" />Send
            </Button>
          </>
        )}
        {q.status === "sent" && (
          <>
            <Button size="sm" onClick={() => action("accept")} className="bg-emerald-600 hover:bg-emerald-700">
              <Check className="mr-2 size-4" />Accept
            </Button>
            <Button size="sm" variant="outline" onClick={() => action("decline")} className="text-red-600">
              <X className="mr-2 size-4" />Decline
            </Button>
          </>
        )}
        {q.status === "accepted" && (
          <Button
            size="sm"
            onClick={handleConvert}
            className="bg-emerald-600 hover:bg-emerald-700"
            title="Turn this accepted quote into an invoice you can send and get paid on"
          >
            <FileText className="mr-2 size-4" />Create an invoice from this quote
          </Button>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <Badge variant="outline" className={statusColors[q.status] || ""}>
          {statusLabels[q.status] || q.status}
        </Badge>
        <span className="text-xs sm:text-sm text-muted-foreground">
          Issued {formatDate(q.issueDate)} · Expires {formatDate(q.expiryDate)}
        </span>
      </div>

      {/* Parties Card (From / Quote for) */}
      <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-[11px] text-muted-foreground mb-1">From</p>
            <p className="text-sm font-medium">{orgName || "Company"}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground mb-1">Quote for</p>
            <p className="text-sm font-medium">{q.contact?.name || "-"}</p>
            {contactAddress && (
              <p className="text-xs text-muted-foreground">{contactAddress}</p>
            )}
            {q.contact?.email && (
              <p className="text-xs text-muted-foreground">{q.contact.email}</p>
            )}
            {q.contact?.taxNumber && (
              <p className="text-xs text-muted-foreground">Tax: {q.contact.taxNumber}</p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <p className="text-xl font-bold font-mono">{formatMoney(q.total, q.currencyCode || "GBP")}</p>
      </div>

      <div className="rounded-lg border overflow-hidden">
        {(() => {
          const { itemLines, discountLines, shippingLines, hasAdjustments, itemsSubtotal } =
            partitionDocumentLines(q.lines);
          return (
            <>
              <div className="overflow-x-auto">
                <div className="grid min-w-[550px] grid-cols-[1fr_80px_100px_100px_120px] gap-2 border-b bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground">
                  <span>Description</span>
                  <span className="text-right">Qty</span>
                  <span className="text-right">Price</span>
                  <span className="text-right">Tax</span>
                  <span className="text-right">Amount</span>
                </div>
                {itemLines.map((line) => (
                  <div key={line.id} className="grid min-w-[550px] grid-cols-[1fr_80px_100px_100px_120px] gap-2 border-b px-4 py-3 last:border-b-0 items-center">
                    <div className="flex items-center gap-3">
                      {line.imageUrl ? (
                        <img
                          src={line.imageUrl}
                          alt=""
                          className="size-9 rounded-full object-cover border shrink-0 bg-muted"
                        />
                      ) : hasAnyLineImage ? (
                        <div className="size-9 shrink-0" />
                      ) : null}
                      <div>
                        <p className="text-sm font-medium">{line.description}</p>
                        {line.shortDescription && (
                          <p className="text-xs text-muted-foreground whitespace-pre-line mt-0.5">
                            {line.shortDescription}
                          </p>
                        )}
                        {line.account && (
                          <p className="text-xs text-muted-foreground/70 mt-0.5">
                            {line.account.code} &middot; {line.account.name}
                          </p>
                        )}
                      </div>
                    </div>
                    <span className="text-right text-sm font-mono">{(line.quantity / 100).toFixed(0)}</span>
                    <span className="text-right text-sm font-mono text-muted-foreground">{formatMoney(line.unitPrice, q.currencyCode || "GBP")}</span>
                    <div className="text-right text-sm font-mono text-muted-foreground">
                      {line.taxRate ? (
                        <div>
                          <span>{(line.taxRate.rate / 100).toFixed(0)}%</span>
                          {(line.taxAmount ?? 0) > 0 && (
                            <p className="text-[11px] text-muted-foreground/70">
                              {formatMoney(line.taxAmount!, q.currencyCode || "GBP")}
                            </p>
                          )}
                        </div>
                      ) : (line.taxAmount ?? 0) > 0 ? (
                        <span>{formatMoney(line.taxAmount!, q.currencyCode || "GBP")}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">0%</span>
                      )}
                    </div>
                    <span className="text-right text-sm font-mono font-medium">{formatMoney(line.amount, q.currencyCode || "GBP")}</span>
                  </div>
                ))}
              </div>

              {/* Totals Underneath */}
              <div className="border-t bg-muted/10 px-4 py-3 sm:px-6 sm:py-4">
                <div className="flex justify-end">
                  <div className="w-full max-w-xs space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span className="font-mono tabular-nums">
                        {formatMoney(hasAdjustments ? itemsSubtotal : q.subtotal, q.currencyCode || "GBP")}
                      </span>
                    </div>
                    {discountLines.map((d, idx) => (
                      <div key={`d-${idx}`} className="flex justify-between text-sm text-emerald-600 dark:text-emerald-400">
                        <span>{d.description}</span>
                        <span className="font-mono tabular-nums">
                          -{formatMoney(Math.abs(d.amount), q.currencyCode || "GBP")}
                        </span>
                      </div>
                    ))}
                    {shippingLines.map((s, idx) => (
                      <div key={`s-${idx}`} className="flex justify-between text-sm text-muted-foreground">
                        <span>{s.description}</span>
                        <span className="font-mono tabular-nums">
                          +{formatMoney(Math.abs(s.amount), q.currencyCode || "GBP")}
                        </span>
                      </div>
                    ))}
                    {(q.taxTotal || 0) > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{resolveTaxLabel(itemLines, q.taxTotal) || "Tax"}</span>
                        <span className="font-mono tabular-nums">{formatMoney(q.taxTotal || 0, q.currencyCode || "GBP")}</span>
                      </div>
                    )}
                    <div className="h-px bg-border my-1" />
                    <div className="flex justify-between text-base font-semibold">
                      <span>Total</span>
                      <span className="font-mono tabular-nums text-foreground">{formatMoney(q.total, q.currencyCode || "GBP")}</span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          );
        })()}
      </div>

      <EmailHistory key={emailHistoryKey} documentType="quote" documentId={id} />

      <SendDocumentDialog
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        documentType="quote"
        documentId={id}
        documentNumber={q.quoteNumber}
        contactEmail={q.contact?.email}
        contactName={q.contact?.name}
        organizationName={orgName}
        amountDue={q.total}
        dueDate={q.expiryDate}
        issueDate={q.issueDate}
        sendApiUrl={`/api/v1/quotes/${id}/send`}
        onSent={handleSendComplete}
      />

      <EditQuoteSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        quote={q}
        onSaved={refetchQuote}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Quote Drawer
// ---------------------------------------------------------------------------

function EditQuoteSheet({
  open,
  onClose,
  quote: q,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  quote: QuoteDetail;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [contactId, setContactId] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineItem[]>([]);

  useEffect(() => {
    if (open && q) {
      setContactId(q.contactId || "");
      setIssueDate(q.issueDate || "");
      setExpiryDate(q.expiryDate || "");
      setReference(q.reference || "");
      setNotes(q.notes || "");
      setLines(
        q.lines && q.lines.length > 0
          ? q.lines.map((l) => ({
              description: l.description,
              quantity: String(l.quantity / 100),
              unitPrice: minorUnitsToDecimal(l.unitPrice, q.currencyCode || "GBP"),
              accountId: l.account?.id || (l as any).accountId || "",
              taxRateId: (l as any).taxRate?.id || (l as any).taxRateId || "",
              imageUrl: (l as any).imageUrl || null,
              shortDescription: (l as any).shortDescription || "",
            }))
          : [{ description: "", shortDescription: "", quantity: "1", unitPrice: "", accountId: "", taxRateId: "", imageUrl: null }]
      );
    }
  }, [open, q]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!contactId) {
      toast.error("Please select a customer");
      return;
    }
    if (lines.length === 0 || lines.some((l) => !l.description.trim() || !l.unitPrice)) {
      toast.error("All lines need a description and price");
      return;
    }
    const orgId = typeof window !== "undefined" ? localStorage.getItem("activeOrgId") : null;
    if (!orgId) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/v1/quotes/${q.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-organization-id": orgId,
        },
        body: JSON.stringify({
          contactId,
          issueDate,
          expiryDate,
          reference: reference || null,
          notes: notes || null,
          lines: lines.map((l) => ({
            description: l.description,
            quantity: parseFloat(l.quantity) || 1,
            unitPrice: parseFloat(l.unitPrice) || 0,
            accountId: l.accountId || null,
            taxRateId: l.taxRateId || null,
            imageUrl: l.imageUrl || null,
            shortDescription: l.shortDescription || null,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update quote");
      }

      toast.success("Quote updated");
      onClose();
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update quote");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="sm:max-w-2xl w-full p-0 flex flex-col">
        <SheetHeader className="px-4 pt-4 pb-3 sm:px-6 sm:pt-6 sm:pb-4 border-b space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
              <FileText className="size-5" />
            </div>
            <div>
              <SheetTitle className="text-lg">Edit Quote {q.quoteNumber}</SheetTitle>
              <SheetDescription>Update quote details, line items, or customer.</SheetDescription>
            </div>
          </div>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto space-y-6 px-4 py-4 sm:px-6 sm:py-5">
            <div className="space-y-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Quote Details
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Customer *</Label>
                  <ContactPicker value={contactId} onChange={setContactId} type="customer" />
                </div>
                <div className="space-y-2">
                  <Label>Reference</Label>
                  <Input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="Quote reference"
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Issue Date</Label>
                  <DatePicker value={issueDate} onChange={setIssueDate} placeholder="Issue date" />
                </div>
                <div className="space-y-2">
                  <Label>Expiry Date</Label>
                  <DatePicker value={expiryDate} onChange={setExpiryDate} placeholder="Expiry date" />
                </div>
              </div>
            </div>

            <div className="h-px bg-border" />

            <div className="space-y-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Line Items
              </p>
              <LineItemsEditor
                lines={lines}
                onChange={setLines}
                accountTypeFilter={["revenue"]}
                taxContext="sales"
                defaultToStandardRate={false}
              />
            </div>

            <div className="h-px bg-border" />

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Terms, validity period, special conditions..."
                rows={3}
              />
            </div>
          </div>

          <div className="sticky bottom-0 z-10 flex items-center justify-end gap-3 border-t bg-background/80 px-4 py-3 sm:px-6 sm:py-4 backdrop-blur-sm">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
