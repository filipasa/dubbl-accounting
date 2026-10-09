"use client";

import React from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface TablePaginationProps {
  page: number; // 1-indexed
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  disabled?: boolean;
  className?: string;
  itemLabel?: string;
}

export function TablePagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  disabled = false,
  className,
  itemLabel = "entries",
}: TablePaginationProps) {
  const safeTotalPages = Math.max(1, totalPages);
  const safePage = Math.min(Math.max(1, page), safeTotalPages);

  const start = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(safePage * pageSize, totalItems);

  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 text-xs text-muted-foreground border-t",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span>
          {totalItems === 0 ? (
            `No ${itemLabel} found`
          ) : (
            <>
              Showing{" "}
              <span className="font-medium text-foreground">
                {start.toLocaleString()}
              </span>
              {"–"}
              <span className="font-medium text-foreground">
                {end.toLocaleString()}
              </span>{" "}
              of{" "}
              <span className="font-medium text-foreground">
                {totalItems.toLocaleString()}
              </span>{" "}
              {itemLabel}
            </>
          )}
        </span>

        {onPageSizeChange && pageSizeOptions && pageSizeOptions.length > 0 && (
          <div className="flex items-center gap-1.5 ml-1 sm:ml-2">
            <span className="text-[11px]">Per page:</span>
            <Select
              value={String(pageSize)}
              onValueChange={(val) => onPageSizeChange(Number(val))}
              disabled={disabled}
            >
              <SelectTrigger className="h-7 w-[70px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((opt) => (
                  <SelectItem key={opt} value={String(opt)}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {safeTotalPages > 1 && (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={safePage <= 1 || disabled}
            onClick={() => onPageChange(1)}
            title="First page"
          >
            <ChevronsLeft className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={safePage <= 1 || disabled}
            onClick={() => onPageChange(Math.max(1, safePage - 1))}
          >
            <ChevronLeft className="size-3.5 mr-0.5" />
            Previous
          </Button>

          <div className="px-2 text-xs tabular-nums">
            Page <span className="font-medium text-foreground">{safePage}</span>{" "}
            of{" "}
            <span className="font-medium text-foreground">
              {safeTotalPages}
            </span>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={safePage >= safeTotalPages || disabled}
            onClick={() => onPageChange(Math.min(safeTotalPages, safePage + 1))}
          >
            Next
            <ChevronRight className="size-3.5 ml-0.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={safePage >= safeTotalPages || disabled}
            onClick={() => onPageChange(safeTotalPages)}
            title="Last page"
          >
            <ChevronsRight className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
