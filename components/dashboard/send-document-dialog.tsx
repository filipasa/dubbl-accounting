"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Send, Paperclip, Eye, Pencil, Mail, Loader2, CreditCard, FileText, ArrowLeft, Building2, ChevronsUpDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { formatMoney, calculateCommercialCardFee } from "@/lib/money";
import { formatDate } from "@/lib/date";

interface SendDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentType: "invoice" | "quote" | "credit_note" | "purchase_order" | "debit_note";
  documentId: string;
  documentNumber: string;
  contactEmail?: string | null;
  contactName?: string | null;
  organizationName?: string;
  amountDue?: number;
  dueDate?: string | null;
  issueDate?: string | null;
  currencyCode?: string;
  initialPaymentMethods?: string[] | null;
  sendApiUrl: string;
  onSent: () => void;
}

const documentTypeLabels: Record<string, string> = {
  invoice: "Invoice",
  quote: "Quote",
  credit_note: "Credit Note",
  purchase_order: "Purchase Order",
  debit_note: "Debit Note",
};

// Document types that have a server route which renders the document itself
// (not the email) so we can show a real preview of the PDF/document before sending.
// Maps documentType -> a function producing the render endpoint for a given id.
// Only include a mapping when the PDF route actually exists under app/api/v1;
// types without a PDF route are intentionally omitted so the preview button
// simply doesn't show for them (instead of pointing the iframe at a 404).
// Verified existing PDF routes: invoices, quotes, credit-notes, purchase-orders
// and debit-notes all expose [id]/pdf.
const documentRenderRoute: Partial<Record<string, (id: string) => string>> = {
  invoice: (id) => `/api/v1/invoices/${id}/pdf`,
  quote: (id) => `/api/v1/quotes/${id}/pdf`,
  credit_note: (id) => `/api/v1/credit-notes/${id}/pdf`,
  purchase_order: (id) => `/api/v1/purchase-orders/${id}/pdf`,
  debit_note: (id) => `/api/v1/debit-notes/${id}/pdf`,
};

function formatDateDisplay(dateStr: string | null | undefined) {
  if (!dateStr) return undefined;
  return formatDate(dateStr);
}

export function SendDocumentDialog({
  open,
  onOpenChange,
  documentType,
  documentId,
  documentNumber,
  contactEmail,
  contactName,
  organizationName = "",
  amountDue,
  dueDate,
  issueDate,
  currencyCode = "GBP",
  initialPaymentMethods,
  sendApiUrl,
  onSent,
}: SendDocumentDialogProps) {
  const [recipientEmail, setRecipientEmail] = useState("");
  const [personalMessage, setPersonalMessage] = useState("");
  const [attachPdf, setAttachPdf] = useState(true);
  const [sending, setSending] = useState(false);
  const [markingAsSent, setMarkingAsSent] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  // Document (PDF) preview — shows the actual document the recipient receives.
  const [docPreviewing, setDocPreviewing] = useState(false);
  const [docPreviewUrl, setDocPreviewUrl] = useState("");
  const [docPreviewLoading, setDocPreviewLoading] = useState(false);
  const [docPreviewError, setDocPreviewError] = useState(false);
  const [selectedPaymentMethods, setSelectedPaymentMethods] = useState<string[]>(
    initialPaymentMethods && initialPaymentMethods.length > 0
      ? initialPaymentMethods
      : ["pay_by_bank"]
  );
  const [paymentPopoverOpen, setPaymentPopoverOpen] = useState(false);
  const [passProcessingFee, setPassProcessingFee] = useState(false);
  const [stripeConnected, setStripeConnected] = useState<boolean | null>(null);

  function togglePaymentMethod(method: string) {
    setSelectedPaymentMethods((prev) => {
      const next = prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method];
      if (!next.includes("card")) {
        setPassProcessingFee(false);
      }
      return next;
    });
  }

  const typeLabel = documentTypeLabels[documentType] || "Document";
  const renderRoute = documentRenderRoute[documentType];
  const canPreviewDocument = Boolean(renderRoute && documentId);
  const showAttachPdf = true;
  const isInvoice = documentType === "invoice";
  const isOnlinePaymentSelected = isInvoice && selectedPaymentMethods.includes("card");
  const effectivePassProcessingFee = isOnlinePaymentSelected && passProcessingFee;
  const currency = currencyCode || "GBP";
  const calculatedFee = isInvoice && amountDue && amountDue > 0
    ? calculateCommercialCardFee(amountDue, currency)
    : 0;
  const effectiveAmountDue = (amountDue ?? 0) + (effectivePassProcessingFee ? calculatedFee : 0);
  const effectiveAmountFormatted = effectiveAmountDue > 0
    ? formatMoney(effectiveAmountDue, currency)
    : amountDue != null
    ? formatMoney(amountDue, currency)
    : undefined;
  const dueDateFormatted = formatDateDisplay(dueDate);
  const issueDateFormatted = formatDateDisplay(issueDate);

  const orgId = typeof window !== "undefined" ? localStorage.getItem("activeOrgId") : null;

  // Check Stripe connection status for invoices
  useEffect(() => {
    if (open && isInvoice && orgId && stripeConnected === null) {
      fetch("/api/v1/integrations/stripe/status", {
        headers: { "x-organization-id": orgId },
      })
        .then((res) => res.json())
        .then((data) => {
          setStripeConnected(data.connected === true);
        })
        .catch(() => setStripeConnected(false));
    }
  }, [open, isInvoice, orgId, stripeConnected]);

  useEffect(() => {
    if (open) {
      setRecipientEmail(contactEmail || "");
      setPersonalMessage("");
      setAttachPdf(true);
      setPreviewing(false);
      setPreviewHtml("");
      setDocPreviewing(false);
      setDocPreviewError(false);
      setSelectedPaymentMethods(
        initialPaymentMethods && initialPaymentMethods.length > 0
          ? initialPaymentMethods
          : ["pay_by_bank"]
      );
      setPaymentPopoverOpen(false);
      setPassProcessingFee(false);
    }
  }, [open, contactEmail, documentType, initialPaymentMethods]);

  // Revoke the document preview blob URL whenever it changes or on unmount,
  // so we don't leak object URLs.
  useEffect(() => {
    return () => {
      if (docPreviewUrl) URL.revokeObjectURL(docPreviewUrl);
    };
  }, [docPreviewUrl]);

  // Reset stripe status when dialog closes so it re-fetches next time
  useEffect(() => {
    if (!open) {
      setStripeConnected(null);
      setSelectedPaymentMethods(["pay_by_bank"]);
      setPaymentPopoverOpen(false);
      setPassProcessingFee(false);
    }
  }, [open]);

  const getPreviewButton = useCallback(() => {
    if (isInvoice && selectedPaymentMethods.length > 0) {
      return { viewUrl: "#", buttonLabel: "Pay invoice" };
    }
    if (documentType === "quote") {
      return { viewUrl: "#", buttonLabel: "View quote" };
    }
    return {};
  }, [isInvoice, selectedPaymentMethods, documentType]);

  const buildTemplateProps = useCallback((forPreview = false) => ({
    organizationName,
    contactName: contactName || "there",
    documentType,
    documentNumber,
    personalMessage: personalMessage || undefined,
    amountFormatted: effectiveAmountFormatted,
    dueDateFormatted,
    issueDateFormatted,
    ...(forPreview ? getPreviewButton() : {}),
  }), [organizationName, contactName, documentType, documentNumber, personalMessage, effectiveAmountFormatted, dueDateFormatted, issueDateFormatted, getPreviewButton]);

  async function handlePreview() {
    if (!orgId) return;
    setPreviewing(true);
    setPreviewLoading(true);
    try {
      const res = await fetch("/api/v1/document-emails/preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-organization-id": orgId,
        },
        body: JSON.stringify(buildTemplateProps(true)),
      });
      if (res.ok) {
        const data = await res.json();
        setPreviewHtml(data.html);
      } else {
        toast.error("Failed to load preview");
        setPreviewing(false);
      }
    } catch {
      toast.error("Failed to load preview");
      setPreviewing(false);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleDocumentPreview() {
    if (!orgId || !renderRoute || !documentId) return;
    setDocPreviewing(true);
    setDocPreviewLoading(true);
    setDocPreviewError(false);
    try {
      // Fetch via fetch() (not a raw iframe src) so we can send the
      // x-organization-id header the document route requires, then render
      // the response through a blob URL.
      const feeParam = effectivePassProcessingFee ? "&passProcessingFee=true" : "";
      const res = await fetch(`${renderRoute(documentId)}?format=pdf${feeParam}`, {
        headers: { "x-organization-id": orgId },
      });
      if (!res.ok) {
        setDocPreviewError(true);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      // Replace any previous URL (effect cleanup revokes the old one).
      setDocPreviewUrl(url);
    } catch {
      setDocPreviewError(true);
    } finally {
      setDocPreviewLoading(false);
    }
  }

  async function handleSendEmail() {
    if (!orgId || !recipientEmail) {
      toast.error("Recipient email is required");
      return;
    }

    setSending(true);
    try {
      const res = await fetch(sendApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-organization-id": orgId,
        },
        body: JSON.stringify({
          sendEmail: true,
          recipientEmail,
          subject: `${typeLabel} ${documentNumber} from ${organizationName}`,
          templateProps: buildTemplateProps(),
          attachPdf: isInvoice ? true : attachPdf,
          ...(isInvoice
            ? {
                includePaymentLink: selectedPaymentMethods.length > 0,
                paymentMethods: selectedPaymentMethods,
                passProcessingFee: effectivePassProcessingFee,
              }
            : {}),
        }),
      });

      if (res.ok) {
        toast.success(`${typeLabel} sent via email`);
        onOpenChange(false);
        onSent();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(typeof data.error === "string" ? data.error : `Failed to send ${typeLabel.toLowerCase()}`);
      }
    } finally {
      setSending(false);
    }
  }

  async function handleMarkAsSent() {
    if (!orgId) return;
    setMarkingAsSent(true);
    try {
      const res = await fetch(sendApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-organization-id": orgId,
        },
        body: JSON.stringify({
          ...(isInvoice ? { passProcessingFee: effectivePassProcessingFee } : {}),
        }),
      });

      if (res.ok) {
        toast.success(`${typeLabel} marked as sent`);
        onOpenChange(false);
        onSent();
      } else {
        toast.error(`Failed to mark ${typeLabel.toLowerCase()} as sent`);
      }
    } finally {
      setMarkingAsSent(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg w-full p-0 flex flex-col">
        <SheetHeader className="px-4 pt-4 pb-3 sm:px-6 sm:pt-6 sm:pb-4 border-b space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
              <Mail className="size-5" />
            </div>
            <div>
              <SheetTitle className="text-lg">Send {typeLabel}</SheetTitle>
              <SheetDescription>{documentNumber}</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {docPreviewing ? (
            /* ---- Document (PDF) Preview ---- */
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-between px-4 py-2.5 sm:px-6 border-b bg-muted/30">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {typeLabel} Preview
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => setDocPreviewing(false)}
                >
                  <ArrowLeft className="size-3" />
                  Back
                </Button>
              </div>
              {docPreviewLoading ? (
                <div className="flex-1 flex items-center justify-center py-20">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : docPreviewError ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 py-20 px-6 text-center">
                  <FileText className="size-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Couldn&apos;t load the {typeLabel.toLowerCase()} preview.
                  </p>
                  <Button variant="outline" size="sm" onClick={handleDocumentPreview}>
                    Try again
                  </Button>
                </div>
              ) : (
                <div className="flex-1 bg-[#525659] p-2">
                  <iframe
                    src={docPreviewUrl}
                    className="w-full h-full border-0 rounded-lg bg-white"
                    style={{ minHeight: 700 }}
                    title={`${typeLabel} preview`}
                  />
                </div>
              )}
            </div>
          ) : previewing ? (
            /* ---- Email Preview ---- */
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-between px-4 py-2.5 sm:px-6 border-b bg-muted/30">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email Preview</p>
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5" onClick={() => setPreviewing(false)}>
                  <Pencil className="size-3" />
                  Edit
                </Button>
              </div>
              {previewLoading ? (
                <div className="flex-1 flex items-center justify-center py-20">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto bg-[#f4f7fa] dark:bg-muted/20 p-4">
                  <iframe
                    srcDoc={previewHtml}
                    className="w-full border-0 rounded-lg"
                    style={{ minHeight: 700 }}
                    title="Email preview"
                    sandbox="allow-same-origin"
                    onLoad={(e) => {
                      const frame = e.currentTarget;
                      const doc = frame.contentDocument;
                      if (doc?.body) {
                        frame.style.height = doc.body.scrollHeight + "px";
                      }
                    }}
                  />
                </div>
              )}
            </div>
          ) : (
            /* ---- Compose Form ---- */
            <div className="space-y-5 px-4 py-4 sm:px-6 sm:py-5">
              {/* Recipient */}
              <div className="space-y-2">
                <Label className="text-xs">To</Label>
                <Input
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="recipient@example.com"
                />
              </div>

              {/* Document summary (read-only, shows what the email will contain) */}
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Email will include
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[11px] text-muted-foreground">{typeLabel}</p>
                    <p className="text-sm font-mono font-semibold">{documentNumber}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">From</p>
                    <p className="text-sm font-medium">{organizationName || "-"}</p>
                  </div>
                  {effectiveAmountFormatted && (
                    <div>
                      <p className="text-[11px] text-muted-foreground">
                        {documentType === "quote" ? "Total" : "Amount Due"}
                      </p>
                      <p className="text-sm font-mono font-semibold">{effectiveAmountFormatted}</p>
                      {effectivePassProcessingFee && calculatedFee > 0 && (
                        <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                          Includes {formatMoney(calculatedFee, currency)} fee
                        </p>
                      )}
                    </div>
                  )}
                  {dueDateFormatted && documentType !== "quote" && (
                    <div>
                      <p className="text-[11px] text-muted-foreground">Due Date</p>
                      <p className="text-sm font-medium">{dueDateFormatted}</p>
                    </div>
                  )}
                  {issueDateFormatted && (
                    <div>
                      <p className="text-[11px] text-muted-foreground">
                        {documentType === "quote" ? "Valid Until" : "Issue Date"}
                      </p>
                      <p className="text-sm font-medium">{issueDateFormatted}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-[11px] text-muted-foreground">Recipient</p>
                    <p className="text-sm font-medium">{contactName || "-"}</p>
                  </div>
                </div>
              </div>

              {/* Personal message */}
              <div className="space-y-2">
                <Label className="text-xs">Personal Message (optional)</Label>
                <Textarea
                  value={personalMessage}
                  onChange={(e) => setPersonalMessage(e.target.value)}
                  rows={4}
                  className="text-sm"
                  placeholder={`Add a note for ${contactName || "the recipient"}...`}
                />
                <p className="text-[11px] text-muted-foreground">
                  This message will appear above the document details in the email.
                </p>
              </div>

              {/* Payment option (invoices only) */}
              {isInvoice && (
                <div className="space-y-2">
                  <Label className="text-xs">Payment</Label>
                  <Popover open={paymentPopoverOpen} onOpenChange={setPaymentPopoverOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs ring-offset-background placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-ring text-left cursor-pointer"
                      >
                        <span className="flex items-center gap-2 truncate">
                          {selectedPaymentMethods.length === 0 ? (
                            <span className="text-muted-foreground">No payment link</span>
                          ) : selectedPaymentMethods.length === 2 ? (
                            <span className="flex items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 text-xs font-medium border border-emerald-200 dark:border-emerald-800">
                                <Building2 className="size-3" />
                                Pay by Bank
                              </span>
                              <span className="inline-flex items-center gap-1 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 text-xs font-medium border border-blue-200 dark:border-blue-800">
                                <CreditCard className="size-3" />
                                Online payment
                              </span>
                            </span>
                          ) : selectedPaymentMethods.includes("pay_by_bank") ? (
                            <span className="flex items-center gap-1.5">
                              <Building2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                              <span>Pay by Bank (Stripe)</span>
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5">
                              <CreditCard className="size-3.5 text-blue-600 dark:text-blue-400" />
                              <span>Online payment (Stripe)</span>
                            </span>
                          )}
                        </span>
                        <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-(--radix-popover-trigger-width) p-1.5" align="start">
                      <div className="space-y-1">
                        {/* Option: Pay by Bank */}
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => togglePaymentMethod("pay_by_bank")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              togglePaymentMethod("pay_by_bank");
                            }
                          }}
                          className="flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-md hover:bg-muted cursor-pointer text-sm select-none transition-colors"
                        >
                          <div className="flex items-center gap-2.5">
                            <Checkbox
                              id="method-pay-by-bank"
                              checked={selectedPaymentMethods.includes("pay_by_bank")}
                              onCheckedChange={() => togglePaymentMethod("pay_by_bank")}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <label
                              htmlFor="method-pay-by-bank"
                              className="flex items-center gap-2 cursor-pointer font-medium"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Building2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                              Pay by Bank (Stripe)
                            </label>
                          </div>
                          {selectedPaymentMethods.includes("pay_by_bank") && (
                            <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                          )}
                        </div>

                        {/* Option: Online payment */}
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => togglePaymentMethod("card")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              togglePaymentMethod("card");
                            }
                          }}
                          className="flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-md hover:bg-muted cursor-pointer text-sm select-none transition-colors"
                        >
                          <div className="flex items-center gap-2.5">
                            <Checkbox
                              id="method-card"
                              checked={selectedPaymentMethods.includes("card")}
                              onCheckedChange={() => togglePaymentMethod("card")}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <label
                              htmlFor="method-card"
                              className="flex items-center gap-2 cursor-pointer font-medium"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <CreditCard className="size-3.5 text-blue-600 dark:text-blue-400" />
                              Online payment (Stripe)
                            </label>
                          </div>
                          {selectedPaymentMethods.includes("card") && (
                            <Check className="size-3.5 text-blue-600 dark:text-blue-400" />
                          )}
                        </div>

                        <div className="border-t border-border my-1" />

                        {/* Clear all / No payment link */}
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPaymentMethods([]);
                            setPassProcessingFee(false);
                            setPaymentPopoverOpen(false);
                          }}
                          className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-muted text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                        >
                          No payment link (clear all)
                        </button>
                      </div>
                    </PopoverContent>
                  </Popover>

                  {selectedPaymentMethods.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      No payment link or QR code will be included on the email or invoice PDF.
                    </p>
                  ) : selectedPaymentMethods.includes("pay_by_bank") && selectedPaymentMethods.includes("card") ? (
                    <p className="text-[11px] text-muted-foreground">
                      A &quot;Pay invoice&quot; button and QR code will be included, offering both Stripe Pay by Bank and card payments.
                    </p>
                  ) : selectedPaymentMethods.includes("pay_by_bank") ? (
                    <p className="text-[11px] text-muted-foreground">
                      A &quot;Pay invoice&quot; button and QR code will be included, with Stripe Pay by Bank only.
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      A &quot;Pay invoice&quot; button and QR code will be included, with standard Stripe online payment options.
                    </p>
                  )}

                  {/* Pass on commercial card processing fees - only shown when Online payment (Stripe) is selected */}
                  {isOnlinePaymentSelected && (
                    <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-2">
                      <div className="flex items-start gap-2.5">
                        <Checkbox
                          id="pass-processing-fee"
                          checked={passProcessingFee}
                          onCheckedChange={(checked) => setPassProcessingFee(checked === true)}
                          className="mt-0.5"
                        />
                        <div className="space-y-1">
                          <label
                            htmlFor="pass-processing-fee"
                            className="text-xs font-medium cursor-pointer flex items-center gap-1.5"
                          >
                            Pass on commercial card processing fees
                            {passProcessingFee && (
                              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                (+{formatMoney(calculatedFee, currency)})
                              </span>
                            )}
                          </label>
                          <p className="text-[11px] text-muted-foreground">
                            {passProcessingFee
                              ? `Adds a new line "Payment Processing Fee: ${formatMoney(calculatedFee, currency)}" (1.9% + 20p) to the invoice total.`
                              : "Adds a new line called Payment Processing Fee to calculate and pass on the commercial card processing fee (1.9% + 20p)."}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Options */}
              <div className="space-y-3">
                {showAttachPdf && (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="attach-pdf"
                      checked={attachPdf}
                      onCheckedChange={(checked) => setAttachPdf(checked === true)}
                    />
                    <label htmlFor="attach-pdf" className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <Paperclip className="size-3.5 text-muted-foreground" />
                      Attach PDF
                    </label>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={handlePreview}
                  >
                    <Eye className="size-3.5" />
                    Preview Email
                  </Button>
                  {canPreviewDocument && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={handleDocumentPreview}
                    >
                      <FileText className="size-3.5" />
                      Preview {typeLabel}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="sticky bottom-0 z-10 flex items-center gap-2 border-t bg-background/80 backdrop-blur-sm px-4 py-3 sm:px-6 sm:py-4">
          <Button
            onClick={handleSendEmail}
            loading={sending}
            disabled={markingAsSent || !recipientEmail}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700"
          >
            <Send className="mr-2 size-4" />
            Send Email
          </Button>
          <Button
            variant="outline"
            onClick={handleMarkAsSent}
            loading={markingAsSent}
            disabled={sending}
          >
            Mark as Sent
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
