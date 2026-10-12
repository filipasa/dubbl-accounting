"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  Building2,
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  Loader2,
  Lock,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Unlink,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/date";
import { getBrowserTelemetry } from "@/lib/integrations/hmrc/browser-telemetry";
import type { HmrcObligation, HmrcVatSubmissionResponse } from "@/lib/integrations/hmrc/types";

interface VatBox {
  box: string;
  label: string;
  amount: number;
}

interface HmrcStatus {
  isConfigured: boolean;
  connected: boolean;
  environment: "sandbox" | "production";
  vrn: string | null;
  tokenExpiresAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  recentSubmissions: Array<{
    id: string;
    periodKey: string;
    formBundleNumber: string | null;
    paymentIndicator: string | null;
    status: string;
    submittedAt: string;
  }>;
}

interface HmrcMtdDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boxes: VatBox[];
  startDate: string;
  endDate: string;
  basis: "accrual" | "cash";
  onDatesSelected?: (start: string, end: string) => void;
  onSubmittedSuccess?: () => void;
}

export function HmrcMtdDialog({
  open,
  onOpenChange,
  boxes,
  startDate,
  endDate,
  basis,
  onDatesSelected,
  onSubmittedSuccess,
}: HmrcMtdDialogProps) {
  const [status, setStatus] = useState<HmrcStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  // Connection flow state
  const [vrnInput, setVrnInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Obligations state
  const [obligations, setObligations] = useState<HmrcObligation[]>([]);
  const [loadingObligations, setLoadingObligations] = useState(false);
  const [selectedPeriodKey, setSelectedPeriodKey] = useState<string>("");

  // Submission state
  const [declarationAccepted, setDeclarationAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<HmrcVatSubmissionResponse | null>(null);

  const fetchStatus = useCallback(async () => {
    const orgId = localStorage.getItem("activeOrgId");
    if (!orgId) return;

    try {
      setLoadingStatus(true);
      const res = await fetch("/api/v1/integrations/hmrc/status", {
        headers: { "x-organization-id": orgId },
      });
      if (!res.ok) throw new Error("Failed to load HMRC status");
      const data: HmrcStatus = await res.json();
      setStatus(data);
      if (data.vrn) {
        setVrnInput(data.vrn);
      }
    } catch (err: unknown) {
      console.error(err);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  const fetchObligations = useCallback(async () => {
    const orgId = localStorage.getItem("activeOrgId");
    if (!orgId) return;

    try {
      setLoadingObligations(true);
      const res = await fetch("/api/v1/integrations/hmrc/obligations?status=O", {
        headers: { "x-organization-id": orgId },
      });
      if (!res.ok) throw new Error("Failed to load HMRC obligations");
      const data = await res.json();
      const list: HmrcObligation[] = data.obligations || [];
      setObligations(list);

      // If an obligation matches the current dates or if there's only one, select it
      if (list.length > 0) {
        const matching = list.find((o) => o.start === startDate && o.end === endDate);
        if (matching) {
          setSelectedPeriodKey(matching.periodKey);
        } else if (!selectedPeriodKey) {
          setSelectedPeriodKey(list[0].periodKey);
        }
      }
    } catch (err: unknown) {
      console.warn(err);
    } finally {
      setLoadingObligations(false);
    }
  }, [startDate, endDate, selectedPeriodKey]);

  useEffect(() => {
    if (open) {
      setReceipt(null);
      setDeclarationAccepted(false);
      fetchStatus();
    }
  }, [open, fetchStatus]);

  useEffect(() => {
    if (status?.connected) {
      fetchObligations();
    }
  }, [status?.connected, fetchObligations]);

  const handleConnect = async () => {
    const orgId = localStorage.getItem("activeOrgId");
    if (!orgId) return;

    const cleanVrn = vrnInput.replace(/[^0-9]/g, "");
    if (!cleanVrn || cleanVrn.length < 9) {
      toast.error("Please enter a valid 9-digit UK VAT Registration Number (VRN)");
      return;
    }

    if (status && !status.isConfigured) {
      toast.error("HMRC API credentials are not yet active on the server. Please wait for deployment to complete.");
      return;
    }

    try {
      setConnecting(true);
      const res = await fetch(`/api/v1/integrations/hmrc/authorize?vrn=${cleanVrn}`, {
        headers: { "x-organization-id": orgId },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to initiate HMRC authorization");
      }
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      toast.error(msg);
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    const orgId = localStorage.getItem("activeOrgId");
    if (!orgId) return;

    try {
      setDisconnecting(true);
      const res = await fetch("/api/v1/integrations/hmrc/disconnect", {
        method: "POST",
        headers: { "x-organization-id": orgId },
      });
      if (!res.ok) throw new Error("Failed to disconnect");
      toast.success("Disconnected from HMRC");
      fetchStatus();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Disconnection failed";
      toast.error(msg);
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSelectObligation = (key: string) => {
    setSelectedPeriodKey(key);
    const ob = obligations.find((o) => o.periodKey === key);
    if (ob && onDatesSelected) {
      onDatesSelected(ob.start, ob.end);
      toast.info(`VAT return period set to ${ob.start} – ${ob.end}`);
    }
  };

  const handleSubmitReturn = async () => {
    const orgId = localStorage.getItem("activeOrgId");
    if (!orgId) return;

    if (!selectedPeriodKey) {
      toast.error("Please select or enter an HMRC period key (e.g. 18A1)");
      return;
    }

    if (!declarationAccepted) {
      toast.error("You must confirm the legal declaration before submitting to HMRC.");
      return;
    }

    try {
      setSubmitting(true);

      const boxMap: Record<string, number> = {};
      for (const b of boxes) {
        boxMap[`box${b.box}`] = b.amount;
      }

      const clientTelemetry = getBrowserTelemetry();

      const res = await fetch("/api/v1/tax/vat-return/submit-hmrc", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-organization-id": orgId,
        },
        body: JSON.stringify({
          periodKey: selectedPeriodKey,
          startDate,
          endDate,
          basis,
          finalised: true,
          boxes: {
            box1: boxMap.box1 || 0,
            box2: boxMap.box2 || 0,
            box3: boxMap.box3 || 0,
            box4: boxMap.box4 || 0,
            box5: boxMap.box5 || 0,
            box6: boxMap.box6 || 0,
            box7: boxMap.box7 || 0,
            box8: boxMap.box8 || 0,
            box9: boxMap.box9 || 0,
          },
          clientTelemetry,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "HMRC rejected the return");
      }

      setReceipt(data.submission);
      toast.success("VAT Return submitted successfully to HMRC!");
      if (onSubmittedSuccess) {
        onSubmittedSuccess();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Submission failed";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const box1 = boxes.find((b) => b.box === "1")?.amount || 0;
  const box2 = boxes.find((b) => b.box === "2")?.amount || 0;
  const box3 = boxes.find((b) => b.box === "3")?.amount || 0;
  const box4 = boxes.find((b) => b.box === "4")?.amount || 0;
  const netVat = boxes.find((b) => b.box === "5")?.amount || 0;
  const box6 = boxes.find((b) => b.box === "6")?.amount || 0;
  const box7 = boxes.find((b) => b.box === "7")?.amount || 0;
  const box8 = boxes.find((b) => b.box === "8")?.amount || 0;
  const box9 = boxes.find((b) => b.box === "9")?.amount || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Building2 className="size-5 text-emerald-600" />
            <DialogTitle className="text-lg">HMRC Making Tax Digital (MTD)</DialogTitle>
          </div>
          <DialogDescription>
            Submit your VAT Return figures directly to HM Revenue &amp; Customs under Making Tax Digital.
          </DialogDescription>
        </DialogHeader>

        {loadingStatus ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
            <Loader2 className="size-6 animate-spin text-primary" />
            <span className="text-xs">Checking HMRC connection status...</span>
          </div>
        ) : !status?.connected ? (
          /* Step 1: Connect to HMRC */
          <div className="space-y-5 py-2">
            <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900 dark:bg-blue-950/20">
              <div className="flex items-start gap-3">
                <ShieldCheck className="size-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                <div className="space-y-1 text-xs">
                  <p className="font-semibold text-blue-900 dark:text-blue-300">
                    Connect your HMRC Government Gateway account
                  </p>
                  <p className="text-blue-700 dark:text-blue-400 leading-relaxed">
                    Fixbooks connects securely to HMRC via OAuth 2.0 to check your VAT obligations and submit quarterly returns. Your credentials are never stored.
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    {status?.environment === "sandbox" && (
                      <Badge variant="outline" className="text-[10px] bg-background">
                        Environment: HMRC Sandbox (Test Mode)
                      </Badge>
                    )}
                    {status && !status.isConfigured && (
                      <Badge variant="destructive" className="text-[10px]">
                        Credentials not loaded on server
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="vrn" className="text-xs font-medium">
                VAT Registration Number (VRN)
              </Label>
              <Input
                id="vrn"
                placeholder="e.g. 123456789"
                value={vrnInput}
                onChange={(e) => setVrnInput(e.target.value)}
                className="font-mono text-sm max-w-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                9-digit UK VAT number issued on your VAT registration certificate.
              </p>
            </div>

            <div className="pt-2">
              <Button
                onClick={handleConnect}
                disabled={connecting || !vrnInput.trim()}
                className="gap-2"
              >
                {connecting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Redirecting to HMRC...
                  </>
                ) : (
                  <>
                    <ExternalLink className="size-4" />
                    Connect to HMRC Government Gateway
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : receipt ? (
          /* Submission Success Receipt */
          <div className="space-y-6 py-2">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-5 dark:border-emerald-900 dark:bg-emerald-950/30 text-center space-y-2">
              <CheckCircle2 className="size-10 text-emerald-600 mx-auto" />
              <h3 className="text-lg font-bold text-emerald-950 dark:text-emerald-200">
                VAT Return Submitted to HMRC
              </h3>
              <p className="text-xs text-emerald-800 dark:text-emerald-300 max-w-md mx-auto">
                HMRC has received and processed your VAT return for period key{" "}
                <span className="font-mono font-bold">{selectedPeriodKey}</span>.
              </p>
            </div>

            <div className="rounded-lg border bg-card p-4 space-y-3 text-xs">
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">HMRC Form Bundle Number</span>
                <span className="font-mono font-bold text-foreground">
                  {receipt.formBundleNumber}
                </span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Processing Timestamp</span>
                <span className="font-mono text-foreground">
                  {receipt.processingDate ? new Date(receipt.processingDate).toLocaleString("en-GB") : "Recorded"}
                </span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Payment Method</span>
                <span className="font-medium text-foreground">
                  {receipt.paymentIndicator === "DD" ? "Direct Debit on file" : "Bank Transfer / BACS"}
                </span>
              </div>
              {receipt.chargeRefNumber && (
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">HMRC Charge Reference</span>
                  <span className="font-mono font-semibold text-foreground">
                    {receipt.chargeRefNumber}
                  </span>
                </div>
              )}
              <div className="flex justify-between pt-1 font-semibold text-sm">
                <span>{netVat >= 0 ? "Amount Due to HMRC" : "Refund Claimed"}</span>
                <span className="font-mono text-primary font-bold">
                  {formatMoney(Math.abs(netVat))}
                </span>
              </div>
            </div>

            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Close &amp; Done</Button>
            </DialogFooter>
          </div>
        ) : (
          /* Step 2: Review & Submit */
          <div className="space-y-5 py-2">
            {/* Status bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border bg-muted/40 p-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-medium">HMRC Connected</span>
                <Badge variant="outline" className="font-mono text-[10px]">
                  VRN: {status.vrn}
                </Badge>
                {status.environment === "sandbox" && (
                  <Badge variant="secondary" className="text-[10px]">
                    Sandbox
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1 text-muted-foreground"
                  onClick={fetchObligations}
                  disabled={loadingObligations}
                >
                  <RefreshCw className={loadingObligations ? "size-3 animate-spin" : "size-3"} />
                  Sync Obligations
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-red-600 hover:text-red-700"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                >
                  <Unlink className="size-3 mr-1" />
                  Disconnect
                </Button>
              </div>
            </div>

            {/* Obligations Selector */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">
                  HMRC VAT Obligation / Period Key
                </Label>
                {obligations.length === 0 && !loadingObligations && (
                  <span className="text-[11px] text-muted-foreground">
                    No open obligations returned by HMRC
                  </span>
                )}
              </div>
              {obligations.length > 0 ? (
                <Select value={selectedPeriodKey} onValueChange={handleSelectObligation}>
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue placeholder="Select an HMRC open quarter" />
                  </SelectTrigger>
                  <SelectContent>
                    {obligations.map((ob) => (
                      <SelectItem key={ob.periodKey} value={ob.periodKey} className="text-xs">
                        <span className="font-mono font-bold mr-2">[{ob.periodKey}]</span>
                        {formatDate(ob.start)} – {formatDate(ob.end)} (Due: {formatDate(ob.due)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g. 18A1 or 24AA"
                    value={selectedPeriodKey}
                    onChange={(e) => setSelectedPeriodKey(e.target.value.toUpperCase())}
                    className="font-mono text-xs max-w-xs"
                  />
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                HMRC requires the specific 4-character period identifier issued for this quarter.
              </p>
            </div>

            {/* 9-Box Review Table */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold">
                Summary of Figures to Submit (HMRC 9 Boxes)
              </Label>
              <div className="rounded-lg border overflow-hidden text-xs">
                <div className="grid grid-cols-12 bg-muted/50 p-2 font-medium border-b text-muted-foreground">
                  <div className="col-span-2">Box</div>
                  <div className="col-span-7">Description</div>
                  <div className="col-span-3 text-right">Amount</div>
                </div>
                <div className="divide-y">
                  <div className="grid grid-cols-12 p-2 items-center">
                    <div className="col-span-2 font-mono font-bold">Box 1</div>
                    <div className="col-span-7 text-muted-foreground">VAT due on sales</div>
                    <div className="col-span-3 font-mono text-right font-medium">
                      {formatMoney(box1)}
                    </div>
                  </div>
                  <div className="grid grid-cols-12 p-2 items-center">
                    <div className="col-span-2 font-mono font-bold">Box 2</div>
                    <div className="col-span-7 text-muted-foreground">VAT due on acquisitions from EU</div>
                    <div className="col-span-3 font-mono text-right font-medium">
                      {formatMoney(box2)}
                    </div>
                  </div>
                  <div className="grid grid-cols-12 p-2 items-center bg-muted/20 font-semibold">
                    <div className="col-span-2 font-mono">Box 3</div>
                    <div className="col-span-7">Total VAT due (Box 1 + Box 2)</div>
                    <div className="col-span-3 font-mono text-right">{formatMoney(box3)}</div>
                  </div>
                  <div className="grid grid-cols-12 p-2 items-center">
                    <div className="col-span-2 font-mono font-bold">Box 4</div>
                    <div className="col-span-7 text-muted-foreground">VAT reclaimed on purchases</div>
                    <div className="col-span-3 font-mono text-right font-medium">
                      {formatMoney(box4)}
                    </div>
                  </div>
                  <div className="grid grid-cols-12 p-2.5 items-center bg-primary/5 font-bold border-y-2 border-primary/20">
                    <div className="col-span-2 font-mono text-primary">Box 5</div>
                    <div className="col-span-7 text-primary">
                      {netVat >= 0 ? "Net VAT to pay to HMRC" : "Net VAT to reclaim from HMRC"}
                    </div>
                    <div className="col-span-3 font-mono text-right text-sm text-primary">
                      {formatMoney(Math.abs(netVat))}
                    </div>
                  </div>
                  <div className="grid grid-cols-12 p-2 items-center">
                    <div className="col-span-2 font-mono font-bold">Box 6</div>
                    <div className="col-span-7 text-muted-foreground">Total sales ex-VAT (whole pounds)</div>
                    <div className="col-span-3 font-mono text-right font-medium">
                      £{Math.round(box6 / 100).toLocaleString("en-GB")}
                    </div>
                  </div>
                  <div className="grid grid-cols-12 p-2 items-center">
                    <div className="col-span-2 font-mono font-bold">Box 7</div>
                    <div className="col-span-7 text-muted-foreground">Total purchases ex-VAT (whole pounds)</div>
                    <div className="col-span-3 font-mono text-right font-medium">
                      £{Math.round(box7 / 100).toLocaleString("en-GB")}
                    </div>
                  </div>
                  <div className="grid grid-cols-12 p-2 items-center">
                    <div className="col-span-2 font-mono font-bold">Box 8</div>
                    <div className="col-span-7 text-muted-foreground">Total supplies to EU ex-VAT</div>
                    <div className="col-span-3 font-mono text-right font-medium">
                      £{Math.round(box8 / 100).toLocaleString("en-GB")}
                    </div>
                  </div>
                  <div className="grid grid-cols-12 p-2 items-center">
                    <div className="col-span-2 font-mono font-bold">Box 9</div>
                    <div className="col-span-7 text-muted-foreground">Total acquisitions from EU ex-VAT</div>
                    <div className="col-span-3 font-mono text-right font-medium">
                      £{Math.round(box9 / 100).toLocaleString("en-GB")}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Legal Declaration Checkbox */}
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3.5 dark:border-amber-900/60 dark:bg-amber-950/20 space-y-2">
              <div className="flex items-start gap-2.5">
                <Checkbox
                  id="declaration"
                  checked={declarationAccepted}
                  onCheckedChange={(checked) => setDeclarationAccepted(checked === true)}
                  className="mt-0.5"
                />
                <label
                  htmlFor="declaration"
                  className="text-xs leading-relaxed text-amber-950 dark:text-amber-200 cursor-pointer select-none"
                >
                  <span className="font-semibold block mb-0.5">HMRC Legal Declaration:</span>
                  &ldquo;I declare that the information given above is true and complete. I understand that submitting false statements can lead to penalties and prosecution.&rdquo;
                </label>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmitReturn}
                disabled={submitting || !declarationAccepted || !selectedPeriodKey}
                className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Transmitting to HMRC...
                  </>
                ) : (
                  <>
                    <Send className="size-4" />
                    Submit Return to HMRC
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
