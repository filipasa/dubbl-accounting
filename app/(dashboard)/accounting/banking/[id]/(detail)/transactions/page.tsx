"use client";

import { useState, useMemo, useEffect } from "react";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { Clock3, LayoutList, Search, Table2, X, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AccountPicker } from "@/components/dashboard/account-picker";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatMoney } from "@/lib/money";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { BrandLoader } from "@/components/dashboard/brand-loader";
import { useDocumentTitle } from "@/lib/hooks/use-document-title";
import { useBankAccountContext } from "../layout";
import { TransactionRow, CashCodingGrid } from "../../_components";

export default function BankTransactionsPage() {
  const {
    account,
    transactions,
    summary,
    refetch,
    handleReconcile,
    handleExclude,
    handleUndo,
    handleOpenMatch,
    handleOpenExpense,
    handleOpenCategorize,
    handleOpenMatchInvoice,
    handleOpenMatchUnified,
    handleOpenTransfer,
    handleOpenSplit,
  } = useBankAccountContext();

  const cur = account.currencyCode;
  const orgId = typeof window !== "undefined" ? localStorage.getItem("activeOrgId") : null;

  useDocumentTitle("Accounting \u00B7 Bank Transactions");

  const [viewMode, setViewMode] = useState<"list" | "cash-coding">("list");
  const [statusFilter, setStatusFilter] = useState("all");
  const [txSearch, setTxSearch] = useState("");
  const debouncedTxSearch = useDebounce(txSearch);
  const [txDateFrom, setTxDateFrom] = useState("");
  const [txDateTo, setTxDateTo] = useState("");
  const [txSort, setTxSort] = useState("date:desc");
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Batch selection (list view): pick several to-do lines and categorize them at once.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchAccountId, setBatchAccountId] = useState("");
  const [batchSaving, setBatchSaving] = useState(false);

  // Stripe payout auto-matching
  const [stripeMatches, setStripeMatches] = useState<
    Array<{
      importedTransactionId: string;
      importedDescription: string;
      importedDate: string;
      importedAmount: number;
      stripeTransactionId: string;
      stripeJournalEntryId: string;
      stripeExternalTransactionId: string | null;
      stripeDate: string;
      confidence: number;
    }>
  >([]);
  const [matchingStripe, setMatchingStripe] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!orgId || !account.id) return;
    fetch(`/api/v1/bank-accounts/${account.id}/match-stripe-payouts`, {
      headers: { "x-organization-id": orgId },
    })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.matches)) {
          setStripeMatches(data.matches);
          setSelectedMatchIds(new Set(data.matches.map((m: { importedTransactionId: string }) => m.importedTransactionId)));
        } else {
          setStripeMatches([]);
        }
      })
      .catch(() => {});
  }, [orgId, account.id, transactions]);

  async function handleExecuteStripeMatch(idsToMatch?: string[]) {
    if (!orgId || !account.id || matchingStripe) return;
    setMatchingStripe(true);
    try {
      const res = await fetch(`/api/v1/bank-accounts/${account.id}/match-stripe-payouts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
        body: JSON.stringify(idsToMatch ? { transactionIds: idsToMatch } : {}),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to match Stripe payouts");
      const data = await res.json();
      toast.success(data.message || `Matched ${data.matched} Stripe payouts`);
      setReviewDialogOpen(false);
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to match Stripe payouts");
    } finally {
      setMatchingStripe(false);
    }
  }

  const txSearchPending = txSearch !== debouncedTxSearch;

  const filteredTx = useMemo(() => {
    let result = transactions;
    if (statusFilter !== "all") result = result.filter((tx) => tx.status === statusFilter);
    if (debouncedTxSearch) {
      const q = debouncedTxSearch.toLowerCase();
      result = result.filter(
        (tx) =>
          tx.description.toLowerCase().includes(q) ||
          tx.reference?.toLowerCase().includes(q) ||
          tx.payee?.toLowerCase().includes(q)
      );
    }
    if (txDateFrom) result = result.filter((tx) => tx.date >= txDateFrom);
    if (txDateTo) result = result.filter((tx) => tx.date <= txDateTo);
    const [sortKey, sortDir] = txSort.split(":");
    result = [...result].sort((a, b) => {
      const mul = sortDir === "asc" ? 1 : -1;
      if (sortKey === "date") return mul * a.date.localeCompare(b.date);
      if (sortKey === "amount") return mul * (Math.abs(a.amount) - Math.abs(b.amount));
      return 0;
    });
    return result;
  }, [transactions, statusFilter, debouncedTxSearch, txDateFrom, txDateTo, txSort]);

  const totalPages = pageSize === -1 ? 1 : Math.max(1, Math.ceil(filteredTx.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const displayedTx = useMemo(() => {
    if (pageSize === -1) return filteredTx;
    const start = (safePage - 1) * pageSize;
    return filteredTx.slice(start, start + pageSize);
  }, [filteredTx, safePage, pageSize]);

  // Only unreconciled ("To do") lines can be batch-categorized.
  const selectableTx = useMemo(
    () => displayedTx.filter((tx) => tx.status === "unreconciled"),
    [displayedTx]
  );
  const allVisibleSelected =
    selectableTx.length > 0 && selectableTx.every((tx) => selectedIds.has(tx.id));

  // Drop any selection when the visible set changes, so we never act on hidden lines.
  useEffect(() => {
    setSelectedIds(new Set());
    setBatchAccountId("");
    setCurrentPage(1);
  }, [statusFilter, debouncedTxSearch, txDateFrom, txDateTo, viewMode, txSort, pageSize]);

  function toggleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function toggleSelectAll(checked: boolean) {
    setSelectedIds(checked ? new Set(selectableTx.map((tx) => tx.id)) : new Set());
  }
  function clearSelection() {
    setSelectedIds(new Set());
    setBatchAccountId("");
  }

  async function applyBatchCategorize() {
    if (!orgId || !batchAccountId || selectedIds.size === 0) return;
    setBatchSaving(true);
    try {
      const items = [...selectedIds].map((transactionId) => ({
        transactionId,
        accountId: batchAccountId,
      }));
      const res = await fetch("/api/v1/bulk/bank-transactions/categorize", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Couldn't categorize");
      const data = await res.json();
      const ok = data.summary?.succeeded ?? 0;
      const failed = data.summary?.failed ?? 0;
      toast.success(
        `Categorized ${ok} transaction${ok === 1 ? "" : "s"}${failed ? ` · ${failed} skipped` : ""}`
      );
      clearSelection();
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't categorize");
    } finally {
      setBatchSaving(false);
    }
  }

  async function batchIgnore() {
    if (!orgId || selectedIds.size === 0) return;
    const ids = [...selectedIds];
    setBatchSaving(true);
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/v1/bank-transactions/${id}/exclude`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-organization-id": orgId },
            body: JSON.stringify({}),
          })
        )
      );
      toast.success(`Ignored ${ids.length} transaction${ids.length === 1 ? "" : "s"}`);
      clearSelection();
      refetch();
    } catch {
      toast.error("Couldn't ignore some transactions");
    } finally {
      setBatchSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* View toggle: list vs cash-coding grid */}
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border p-0.5">
          {[
            { value: "list" as const, label: "List", icon: LayoutList },
            { value: "cash-coding" as const, label: "Assign in bulk", icon: Table2 },
          ].map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setViewMode(value)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                viewMode === value
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {viewMode === "cash-coding" ? (
        <CashCodingGrid
          transactions={transactions}
          currencyCode={cur}
          orgId={orgId}
          onDone={refetch}
        />
      ) : (
      <div className="space-y-4">
      {/* Stripe Payout Matches Banner */}
      {stripeMatches.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-indigo-200/80 bg-gradient-to-r from-indigo-50/80 via-indigo-50/40 to-white p-4 sm:flex-row sm:items-center sm:justify-between dark:border-indigo-900/60 dark:from-indigo-950/40 dark:via-indigo-950/20 dark:to-background">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm">
              <Sparkles className="size-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {stripeMatches.length} statement transaction{stripeMatches.length === 1 ? "" : "s"} match Stripe payouts in your books
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Stripe sync already recorded these payouts. Link them to the bank statement lines to avoid duplicate entries.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs border-indigo-200 hover:bg-indigo-50 dark:border-indigo-800 dark:hover:bg-indigo-950/50"
              onClick={() => setReviewDialogOpen(true)}
            >
              Review matches
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
              onClick={() => handleExecuteStripeMatch()}
              disabled={matchingStripe}
            >
              {matchingStripe ? "Matching..." : `Match all ${stripeMatches.length}`}
            </Button>
          </div>
        </div>
      )}

      {/* Status tabs + search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="unreconciled" title="Transactions you haven't dealt with yet">
              To do
              {summary.unreconciled > 0 && <span className="ml-1 tabular-nums text-amber-600">{summary.unreconciled}</span>}
            </TabsTrigger>
            <TabsTrigger value="reconciled" title="Transactions you've already dealt with">Done</TabsTrigger>
            <TabsTrigger value="excluded" title="Transactions left out of your books">Ignored</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search transactions..."
            value={txSearch}
            onChange={(e) => setTxSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Date range + sort */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground shrink-0">From</span>
          <DatePicker
            value={txDateFrom}
            onChange={(v) => setTxDateFrom(v)}
            placeholder="Start date"
            className="h-8 w-40 text-xs"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground shrink-0">To</span>
          <DatePicker
            value={txDateTo}
            onChange={(v) => setTxDateTo(v)}
            placeholder="End date"
            className="h-8 w-40 text-xs"
          />
        </div>
        <Select value={txSort} onValueChange={setTxSort}>
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue placeholder="Sort by..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="date:desc">Newest first</SelectItem>
            <SelectItem value="date:asc">Oldest first</SelectItem>
            <SelectItem value="amount:desc">Highest amount</SelectItem>
            <SelectItem value="amount:asc">Lowest amount</SelectItem>
          </SelectContent>
        </Select>
        {(txDateFrom || txDateTo || txSearch) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            onClick={() => { setTxDateFrom(""); setTxDateTo(""); setTxSearch(""); }}
          >
            <X className="mr-1 size-3" />
            Clear filters
          </Button>
        )}
      </div>

      {/* Results summary & page size selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted-foreground">
        <div className="flex items-center gap-3">
          {selectableTx.length > 0 && (
            <Checkbox
              checked={allVisibleSelected}
              onCheckedChange={(c) => toggleSelectAll(c === true)}
              aria-label="Select all to-do transactions"
            />
          )}
          <span>
            {pageSize === -1 || filteredTx.length <= pageSize ? (
              <>
                <span className="font-medium text-foreground tabular-nums">{filteredTx.length}</span> transactions
              </>
            ) : (
              <>
                Showing{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filteredTx.length)}
                </span>{" "}
                of{" "}
                <span className="font-medium text-foreground tabular-nums">{filteredTx.length}</span> transactions
              </>
            )}
          </span>
          {statusFilter !== "all" && (
            <>
              <span className="text-border">·</span>
              <span>
                {statusFilter === "unreconciled" ? "To do" : statusFilter === "reconciled" ? "Done" : "Ignored"}
              </span>
            </>
          )}
        </div>

        {filteredTx.length > 25 && (
          <div className="flex items-center gap-2">
            <span className="text-xs">Show:</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                setPageSize(Number(v));
                setCurrentPage(1);
              }}
            >
              <SelectTrigger className="h-7 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25 / page</SelectItem>
                <SelectItem value="50">50 / page</SelectItem>
                <SelectItem value="100">100 / page</SelectItem>
                <SelectItem value="-1">All ({filteredTx.length})</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Batch bar — categorize several to-do lines at once (great for repeat payees) */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <span className="text-border">·</span>
          <span className="shrink-0 text-xs text-muted-foreground">Categorize all as</span>
          <div className="w-56">
            <AccountPicker value={batchAccountId} onChange={setBatchAccountId} allowCreate />
          </div>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
            disabled={!batchAccountId || batchSaving}
            loading={batchSaving}
            onClick={applyBatchCategorize}
          >
            Apply to {selectedIds.size}
          </Button>
          <Button size="sm" variant="ghost" disabled={batchSaving} onClick={batchIgnore}>
            Ignore
          </Button>
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={clearSelection}>
            Clear
          </Button>
        </div>
      )}

      {txSearchPending ? (
        <BrandLoader className="h-auto py-16" />
      ) : filteredTx.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center">
          <Clock3 className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {statusFilter === "all" && !txSearch ? "No transactions yet." : "No transactions match your filters."}
          </p>
        </div>
      ) : (
        <>
          <motion.div
            key={`${statusFilter}-${debouncedTxSearch}-${txDateFrom}-${txDateTo}-${txSort}-${safePage}-${pageSize}`}
            initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-lg border"
          >
            {displayedTx.map((tx, i) => (
              <TransactionRow
                key={tx.id}
                tx={tx}
                cur={cur}
                isLast={i === displayedTx.length - 1}
                onReconcile={handleReconcile}
                onExclude={handleExclude}
                onMatchBill={handleOpenMatch}
                onCreateExpense={handleOpenExpense}
                onCategorize={handleOpenCategorize}
                onMatchInvoice={handleOpenMatchInvoice}
                onMatch={handleOpenMatchUnified}
                onTransfer={handleOpenTransfer}
                onSplit={handleOpenSplit}
                onUndo={handleUndo}
                selected={selectedIds.has(tx.id)}
                onSelectChange={toggleSelect}
              />
            ))}
          </motion.div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t pt-4 text-xs text-muted-foreground">
              <div>
                Page <span className="font-medium text-foreground">{safePage}</span> of{" "}
                <span className="font-medium text-foreground">{totalPages}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 text-xs"
                  disabled={safePage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 text-xs"
                  disabled={safePage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      </div>
      )}

      {/* Review Stripe Matches Dialog */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-5 text-indigo-600" />
              Stripe Payout Matches ({stripeMatches.length})
            </DialogTitle>
            <DialogDescription>
              We found bank statement lines matching payout journal entries pre-recorded by your Stripe integration. Matching links the statement lines and removes duplicate placeholder records.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between text-xs text-muted-foreground py-1 border-b">
            <span>{selectedMatchIds.size} of {stripeMatches.length} selected</span>
            <div className="space-x-2">
              <button
                type="button"
                className="text-indigo-600 hover:underline font-medium"
                onClick={() => setSelectedMatchIds(new Set(stripeMatches.map((m) => m.importedTransactionId)))}
              >
                Select all
              </button>
              <span>·</span>
              <button
                type="button"
                className="text-muted-foreground hover:underline"
                onClick={() => setSelectedMatchIds(new Set())}
              >
                Deselect all
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y pr-1 max-h-[50vh]">
            {stripeMatches.map((m) => {
              const checked = selectedMatchIds.has(m.importedTransactionId);
              return (
                <div
                  key={m.importedTransactionId}
                  className={cn(
                    "flex items-center gap-3 py-2.5 px-2 rounded-lg transition-colors cursor-pointer hover:bg-muted/50",
                    checked && "bg-indigo-50/40 dark:bg-indigo-950/20"
                  )}
                  onClick={() => {
                    const next = new Set(selectedMatchIds);
                    if (checked) next.delete(m.importedTransactionId);
                    else next.add(m.importedTransactionId);
                    setSelectedMatchIds(next);
                  }}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(c) => {
                      const next = new Set(selectedMatchIds);
                      if (c === true) next.add(m.importedTransactionId);
                      else next.delete(m.importedTransactionId);
                      setSelectedMatchIds(next);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-muted-foreground">Bank Statement Line</span>
                      <p className="font-medium truncate text-foreground">{m.importedDescription}</p>
                      <p className="text-muted-foreground">{m.importedDate}</p>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-indigo-600 dark:text-indigo-400">Stripe Books Entry</span>
                      <p className="font-medium truncate text-foreground">
                        {m.stripeExternalTransactionId || "Stripe Payout"}
                      </p>
                      <p className="text-muted-foreground">{m.stripeDate}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                      +{formatMoney(m.importedAmount, cur)}
                    </p>
                    <span className="inline-block text-[10px] font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950 px-1.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-800">
                      {m.confidence}% match
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <DialogFooter className="flex items-center justify-between sm:justify-between gap-2 pt-2 border-t">
            <Button variant="ghost" size="sm" onClick={() => setReviewDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
              disabled={selectedMatchIds.size === 0 || matchingStripe}
              onClick={() => handleExecuteStripeMatch([...selectedMatchIds])}
            >
              {matchingStripe ? "Matching..." : `Match ${selectedMatchIds.size} Selected`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
