"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useParams } from "next/navigation";
import {
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { motion, MotionConfig } from "motion/react";
import { DataTable, type Column } from "@/components/dashboard/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDocumentTitle } from "@/lib/hooks/use-document-title";

interface LedgerEntry {
  entryId: string;
  entryNumber: number;
  date: string;
  description: string;
  debitAmount: string;
  creditAmount: string;
  balance: string;
}

const ledgerColumns: Column<LedgerEntry>[] = [
  {
    key: "number",
    header: "#",
    sortKey: "number",
    className: "w-16",
    render: (r) => (
      <a
        href={`/accounting/${r.entryId}`}
        className="font-mono text-xs text-emerald-600 hover:underline"
      >
        {r.entryNumber}
      </a>
    ),
  },
  {
    key: "date",
    header: "Date",
    sortKey: "date",
    className: "w-28",
    render: (r) => <span className="text-sm">{r.date}</span>,
  },
  {
    key: "description",
    header: "Description",
    render: (r) => <span className="text-sm">{r.description}</span>,
  },
  {
    key: "debit",
    header: "Debit",
    className: "w-28 text-right",
    render: (r) => {
      const val = parseFloat(r.debitAmount);
      return (
        <span className="font-mono text-sm tabular-nums">
          {val > 0
            ? val.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
            : ""}
        </span>
      );
    },
  },
  {
    key: "credit",
    header: "Credit",
    className: "w-28 text-right",
    render: (r) => {
      const val = parseFloat(r.creditAmount);
      return (
        <span className="font-mono text-sm tabular-nums">
          {val > 0
            ? val.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
            : ""}
        </span>
      );
    },
  },
  {
    key: "balance",
    header: "Balance",
    className: "w-28 text-right",
    render: (r) => {
      const val = parseFloat(r.balance);
      return (
        <span className="font-mono text-sm font-medium tabular-nums">
          {isNaN(val)
            ? ""
            : val.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
        </span>
      );
    },
  },
];

export default function AccountLedgerPage() {
  const { id } = useParams<{ id: string }>();
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState("date:desc");
  const [entryType, setEntryType] = useState("all");

  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [refetching, setRefetching] = useState(false);
  const [fetchKey, setFetchKey] = useState(0);

  const orgId = typeof window !== "undefined" ? localStorage.getItem("activeOrgId") : null;

  useDocumentTitle("Accounting \u00B7 Account Details");

  const pendingSearch = search !== debouncedSearch;

  const buildParams = useCallback(
    (pageNum: number, limitNum: number) => {
      const [sortBy, sortOrder] = sort.split(":");
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      if (entryType !== "all") params.set("entryType", entryType);
      params.set("sortBy", sortBy);
      params.set("sortOrder", sortOrder);
      params.set("page", String(pageNum));
      params.set("limit", String(limitNum));
      return params;
    },
    [debouncedSearch, dateFrom, dateTo, entryType, sort]
  );

  const prevDebouncedSearchRef = useRef(debouncedSearch);
  useEffect(() => {
    if (prevDebouncedSearchRef.current !== debouncedSearch) {
      prevDebouncedSearchRef.current = debouncedSearch;
      setPage(1);
    }
  }, [debouncedSearch]);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    setRefetching(true);

    fetch(`/api/v1/accounts/${id}?${buildParams(page, pageSize)}`, {
      headers: { "x-organization-id": orgId },
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.data) setLedger(data.data);
        if (data.pagination) {
          setTotal(data.pagination.total);
          setTotalPages(
            data.pagination.totalPages ||
              Math.ceil((data.pagination.total || 0) / pageSize) ||
              1
          );
        }
      })
      .catch((err) => {
        if (!cancelled) console.error("Failed to load account ledger:", err);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setRefetching(false);
          setFetchKey((k) => k + 1);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id, orgId, page, pageSize, debouncedSearch, dateFrom, dateTo, entryType, sort, buildParams]);

  const handlePageSizeChange = (val: string) => {
    setPageSize(Number(val));
    setPage(1);
  };

  const handleClearFilters = () => {
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setEntryType("all");
    setPage(1);
  };

  const [sortKey, sortOrder] = sort.split(":");
  const handleColumnSort = (key: string) => {
    if (sortKey === key) {
      setSort(`${key}:${sortOrder === "asc" ? "desc" : "asc"}`);
    } else {
      setSort(`${key}:asc`);
    }
    setPage(1);
  };

  const hasFilters = Boolean(search || dateFrom || dateTo || entryType !== "all");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Transactions</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {total.toLocaleString()} {total === 1 ? "entry" : "entries"}
        </span>
      </div>

      <Tabs
        value={entryType}
        onValueChange={(val) => {
          setEntryType(val);
          setPage(1);
        }}
      >
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger
            value="debits"
            title="The left column. For cash and what you're owed, this is money in; for income and what you owe, it's money out."
          >
            Debits
          </TabsTrigger>
          <TabsTrigger
            value="credits"
            title="The right column. For cash and what you're owed, this is money out; for income and what you owe, it's money in."
          >
            Credits
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search description or entry #..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground shrink-0">From</span>
          <DatePicker
            value={dateFrom}
            onChange={(v) => {
              setDateFrom(v);
              setPage(1);
            }}
            placeholder="Start date"
            className="h-8 w-40 text-xs"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground shrink-0">To</span>
          <DatePicker
            value={dateTo}
            onChange={(v) => {
              setDateTo(v);
              setPage(1);
            }}
            placeholder="End date"
            className="h-8 w-40 text-xs"
          />
        </div>
        <Select
          value={sort}
          onValueChange={(val) => {
            setSort(val);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue placeholder="Sort by..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="date:desc">Newest first</SelectItem>
            <SelectItem value="date:asc">Oldest first</SelectItem>
            <SelectItem value="number:desc">Entry # (high-low)</SelectItem>
            <SelectItem value="number:asc">Entry # (low-high)</SelectItem>
            <SelectItem value="amount:desc">Largest amount</SelectItem>
            <SelectItem value="amount:asc">Smallest amount</SelectItem>
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            onClick={handleClearFilters}
          >
            <X className="mr-1 size-3" />
            Clear filters
          </Button>
        )}
      </div>

      <MotionConfig reducedMotion="never">
        <motion.div
          key={fetchKey}
          initial={{ opacity: 0, y: 12, filter: "blur(10px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.8, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
          style={{ willChange: "opacity, transform, filter" }}
          className="overflow-x-auto"
        >
          <DataTable
            columns={ledgerColumns}
            data={ledger}
            loading={loading || refetching || pendingSearch}
            sortBy={sortKey}
            sortOrder={sortOrder as "asc" | "desc"}
            onSort={handleColumnSort}
            emptyMessage={
              hasFilters
                ? "No entries match your filters."
                : "No transactions in this account yet."
            }
          />
        </motion.div>
      </MotionConfig>

      {/* Pagination controls */}
      {total > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              Showing{" "}
              <span className="font-medium text-foreground">
                {((page - 1) * pageSize + 1).toLocaleString()}
              </span>
              {"–"}
              <span className="font-medium text-foreground">
                {Math.min(page * pageSize, total).toLocaleString()}
              </span>{" "}
              of{" "}
              <span className="font-medium text-foreground">
                {total.toLocaleString()}
              </span>{" "}
              entries
            </span>

            <div className="flex items-center gap-1.5 ml-2">
              <span className="text-[11px]">Per page:</span>
              <Select
                value={String(pageSize)}
                onValueChange={handlePageSizeChange}
              >
                <SelectTrigger className="h-7 w-[70px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="250">250</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0"
                disabled={page <= 1 || refetching}
                onClick={() => setPage(1)}
                title="First page"
              >
                <ChevronsLeft className="size-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={page <= 1 || refetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="size-3.5 mr-0.5" />
                Previous
              </Button>

              <div className="px-2 text-xs tabular-nums">
                Page <span className="font-medium text-foreground">{page}</span> of{" "}
                <span className="font-medium text-foreground">{totalPages}</span>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={page >= totalPages || refetching}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
                <ChevronRight className="size-3.5 ml-0.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0"
                disabled={page >= totalPages || refetching}
                onClick={() => setPage(totalPages)}
                title="Last page"
              >
                <ChevronsRight className="size-3.5" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
