"use client";

import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  CreditCard,
  ArrowDownToLine,
  ArrowLeftRight,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  Calendar,
  Sparkles,
  Pause,
} from "lucide-react";
import { toast } from "sonner";
import { SyncStage, SyncPeriod, SyncChunkResult, SYNC_STAGES } from "@/lib/integrations/stripe/chunked-sync";

interface StripeSyncDialogProps {
  isOpen: boolean;
  onClose: () => void;
  integrationId: string;
  accountName: string;
  onSyncCompleted?: () => void;
}

interface StageConfig {
  key: SyncStage;
  label: string;
  description: string;
  icon: typeof Users;
}

const STAGE_CONFIGS: StageConfig[] = [
  {
    key: "customers",
    label: "Customers & Contacts",
    description: "Import customer profiles, billing addresses and phone numbers",
    icon: Users,
  },
  {
    key: "charges",
    label: "Charges & Revenue",
    description: "Import successful charges, processing fees and journal entries",
    icon: CreditCard,
  },
  {
    key: "payouts",
    label: "Bank Payouts",
    description: "Match payouts to your bank accounts and clear suspense",
    icon: ArrowDownToLine,
  },
  {
    key: "transfers",
    label: "Transfers",
    description: "Sync connected account transfers and reversals",
    icon: ArrowLeftRight,
  },
  {
    key: "creditNotes",
    label: "Credit Notes & Refunds",
    description: "Record customer refunds, adjustments and credit memos",
    icon: FileText,
  },
];

const PERIOD_OPTIONS: { id: SyncPeriod; title: string; subtitle: string; badge?: string }[] = [
  { id: "30d", title: "Last 30 Days", subtitle: "Fastest • Recommended for recent transactions", badge: "Popular" },
  { id: "90d", title: "Last 90 Days", subtitle: "Import last quarter's accounting activity" },
  { id: "180d", title: "Last 6 Months", subtitle: "Import 6 months of historical transactions" },
  { id: "365d", title: "Last 12 Months", subtitle: "Import full financial year history" },
  { id: "all", title: "All Time", subtitle: "Import complete historical records using chunked cursor" },
  { id: "custom", title: "Custom Range", subtitle: "Select a custom date window" },
];

function getOrgId() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("activeOrgId") || "";
}

export function StripeSyncDialog({
  isOpen,
  onClose,
  integrationId,
  accountName,
  onSyncCompleted,
}: StripeSyncDialogProps) {
  const [phase, setPhase] = useState<"select" | "syncing" | "completed" | "error">("select");
  const [period, setPeriod] = useState<SyncPeriod>("30d");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  const [currentStage, setCurrentStage] = useState<SyncStage>("customers");
  const [completedStages, setCompletedStages] = useState<Set<SyncStage>>(new Set());
  const [stageCounts, setStageCounts] = useState<Record<SyncStage, number>>({
    customers: 0,
    charges: 0,
    payouts: 0,
    transfers: 0,
    creditNotes: 0,
  });
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [batchNumber, setBatchNumber] = useState(0);
  const [isStopping, setIsStopping] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const stopRequestedRef = useRef(false);

  function resetDialog() {
    setPhase("select");
    setPeriod("30d");
    setCurrentStage("customers");
    setCompletedStages(new Set());
    setStageCounts({
      customers: 0,
      charges: 0,
      payouts: 0,
      transfers: 0,
      creditNotes: 0,
    });
    setCurrentCursor(null);
    setBatchNumber(0);
    setIsStopping(false);
    setErrorMessage(null);
    stopRequestedRef.current = false;
  }

  function handleClose() {
    if (phase === "syncing") {
      const confirmStop = confirm(
        "A sync is currently in progress. Closing this dialog will pause the sync. All records synced so far are safely saved in your database. Do you want to stop?"
      );
      if (!confirmStop) return;
      stopRequestedRef.current = true;
    }
    onClose();
    resetDialog();
  }

  async function runBatchSync(resumeStage?: SyncStage, resumeCursor?: string | null) {
    setPhase("syncing");
    setIsStopping(false);
    setErrorMessage(null);
    stopRequestedRef.current = false;

    let stage: SyncStage = resumeStage || currentStage;
    let cursor: string | null = resumeCursor !== undefined ? resumeCursor : currentCursor;
    const counts = { ...stageCounts };
    const doneStages = new Set(completedStages);
    let batchCounter = batchNumber;

    try {
      while (true) {
        if (stopRequestedRef.current) {
          setIsStopping(false);
          setPhase("select");
          toast.info("Sync paused. Already synced records remain safely recorded.");
          break;
        }

        batchCounter += 1;
        setBatchNumber(batchCounter);
        setCurrentStage(stage);
        setCurrentCursor(cursor);

        const res = await fetch("/api/v1/integrations/stripe/sync", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-organization-id": getOrgId(),
          },
          body: JSON.stringify({
            integrationId,
            stage,
            cursor,
            limit: 50,
            period,
            startDate: period === "custom" && customStartDate ? customStartDate : undefined,
            endDate: period === "custom" && customEndDate ? customEndDate : undefined,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Sync error on stage ${stage}`);
        }

        const data: SyncChunkResult = await res.json();

        // Increment count for this stage
        counts[stage] = (counts[stage] || 0) + (data.batchCount || 0);
        setStageCounts({ ...counts });

        if (data.isComplete) {
          doneStages.add(stage);
          setCompletedStages(new Set(doneStages));
          setPhase("completed");
          toast.success("Stripe synchronization completed!");
          onSyncCompleted?.();
          break;
        }

        if (data.nextStage && data.nextStage !== stage) {
          // Current stage finished, advance to next stage
          doneStages.add(stage);
          setCompletedStages(new Set(doneStages));
          stage = data.nextStage;
          cursor = null;
        } else {
          cursor = data.nextCursor;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sync encountered an unexpected error";
      setErrorMessage(msg);
      setPhase("error");
      toast.error(msg);
    }
  }

  function handleStop() {
    setIsStopping(true);
    stopRequestedRef.current = true;
  }

  // Calculate overall progress percentage
  const totalStages = STAGE_CONFIGS.length;
  const finishedCount = completedStages.size;
  const progressPercent = phase === "completed"
    ? 100
    : Math.min(Math.round((finishedCount / totalStages) * 100) + (phase === "syncing" ? 10 : 0), 95);

  const totalSyncedRecords = Object.values(stageCounts).reduce((a, b) => a + b, 0);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-xl p-0 overflow-hidden">
        {/* Header */}
        <div className="border-b bg-muted/30 px-6 py-4">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                <Sparkles className="h-4 w-4" />
              </span>
              <div>
                <DialogTitle className="text-base font-semibold">
                  {phase === "completed"
                    ? "Sync Completed"
                    : phase === "syncing"
                    ? "Syncing Stripe Data"
                    : "Sync Stripe Data"}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {accountName}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        {/* Phase 1: Select Period */}
        {phase === "select" && (
          <div className="p-6 space-y-5">
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                1. Select Historical Sync Period
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Choose how far back to import historical transactions into your accounting ledger.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {PERIOD_OPTIONS.map((opt) => {
                const isSelected = period === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setPeriod(opt.id)}
                    className={`text-left p-3 rounded-lg border transition-all ${
                      isSelected
                        ? "border-violet-600 bg-violet-50/50 dark:border-violet-500 dark:bg-violet-950/20 ring-1 ring-violet-600 dark:ring-violet-500"
                        : "border-border hover:border-muted-foreground/30 bg-card"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm text-foreground">{opt.title}</span>
                      {opt.badge && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {opt.badge}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{opt.subtitle}</p>
                  </button>
                );
              })}
            </div>

            {/* Custom Date Range Picker */}
            {period === "custom" && (
              <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border bg-muted/20">
                <div>
                  <Label className="text-xs">From Date</Label>
                  <Input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="h-8 text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">To Date</Label>
                  <Input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="h-8 text-xs mt-1"
                  />
                </div>
              </div>
            )}

            {/* Notice info */}
            <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <Calendar className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                <span>Chunked Cursor Architecture</span>
              </div>
              <p>
                Transactions are processed in fast 50-item batches with automatic deduplication.
                If any record has already been synced, it is verified and skipped without creating duplicates.
              </p>
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-2">
              <Button variant="outline" size="sm" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-violet-600 hover:bg-violet-700 text-white"
                onClick={() => runBatchSync("customers", null)}
              >
                Start Sync
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Phase 2: Live Syncing */}
        {phase === "syncing" && (
          <div className="p-6 space-y-5">
            {/* Overall Progress Bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-600" />
                  Syncing {STAGE_CONFIGS.find((s) => s.key === currentStage)?.label}...
                </span>
                <span className="tabular-nums font-mono text-muted-foreground">
                  {progressPercent}%
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-violet-600 dark:bg-violet-500 transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Batch #{batchNumber} • Total {totalSyncedRecords} records imported so far
              </p>
            </div>

            {/* Stage List */}
            <div className="space-y-2 rounded-lg border divide-y bg-card">
              {STAGE_CONFIGS.map((stage) => {
                const isCurrent = currentStage === stage.key;
                const isDone = completedStages.has(stage.key);
                const count = stageCounts[stage.key] || 0;
                const Icon = stage.icon;

                return (
                  <div
                    key={stage.key}
                    className={`flex items-center justify-between p-3 text-xs transition-colors ${
                      isCurrent
                        ? "bg-violet-50/40 dark:bg-violet-950/20"
                        : ""
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`h-7 w-7 rounded-md flex items-center justify-center ${
                          isDone
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                            : isCurrent
                            ? "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div>
                        <div className="font-medium text-foreground">{stage.label}</div>
                        <div className="text-[11px] text-muted-foreground">{stage.description}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isDone ? (
                        <Badge variant="outline" className="text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 text-[10px]">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          {count} synced
                        </Badge>
                      ) : isCurrent ? (
                        <Badge variant="outline" className="text-violet-700 border-violet-200 bg-violet-50 dark:bg-violet-950/30 dark:border-violet-800 text-[10px]">
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          {count > 0 ? `${count} processed` : "Scanning..."}
                        </Badge>
                      ) : (
                        <span className="flex items-center text-muted-foreground/60 text-[11px]">
                          <Clock className="h-3 w-3 mr-1" />
                          Pending
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <DialogFooter className="pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleStop}
                disabled={isStopping}
                className="text-muted-foreground hover:text-foreground"
              >
                {isStopping ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    Pausing after current batch...
                  </>
                ) : (
                  <>
                    <Pause className="h-3.5 w-3.5 mr-1.5" />
                    Pause Sync
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Phase 3: Completed */}
        {phase === "completed" && (
          <div className="p-6 space-y-5 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-6 w-6" />
            </div>

            <div>
              <h3 className="text-base font-semibold">Synchronization Complete!</h3>
              <p className="text-xs text-muted-foreground mt-1">
                All records for the selected period have been imported and mapped into your accounting books.
              </p>
            </div>

            {/* Results Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-left">
              {STAGE_CONFIGS.map((stage) => {
                const count = stageCounts[stage.key] || 0;
                const Icon = stage.icon;
                return (
                  <div key={stage.key} className="rounded-lg border p-3 bg-card">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Icon className="h-3.5 w-3.5" />
                      <span className="truncate">{stage.label}</span>
                    </div>
                    <div className="text-lg font-bold mt-1 text-foreground tabular-nums">
                      {count}
                    </div>
                  </div>
                );
              })}
            </div>

            <DialogFooter className="sm:justify-center pt-2">
              <Button
                size="sm"
                className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={handleClose}
              >
                Done
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Phase 4: Error State */}
        {phase === "error" && (
          <div className="p-6 space-y-5">
            <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/20">
              <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <div className="text-xs">
                <h4 className="font-semibold text-red-900 dark:text-red-300">Sync Paused Due to Error</h4>
                <p className="text-red-700 dark:text-red-400 mt-1">{errorMessage}</p>
                <p className="text-muted-foreground mt-2">
                  All {totalSyncedRecords} items synced prior to this error remain safely saved. You can resume from where it stopped.
                </p>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-2">
              <Button variant="outline" size="sm" onClick={handleClose}>
                Close
              </Button>
              <Button
                size="sm"
                className="bg-violet-600 hover:bg-violet-700 text-white"
                onClick={() => runBatchSync(currentStage, currentCursor)}
              >
                Resume Sync
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
