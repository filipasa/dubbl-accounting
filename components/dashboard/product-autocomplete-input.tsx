"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Package, Sparkles, Loader2, ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/lib/hooks/use-debounce";

export interface InventoryItemOption {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  shortDescription?: string | null;
  salePrice: number; // in cents
  imageUrl?: string | null;
  category?: string | null;
  revenueAccountId?: string | null;
}

interface ProductAutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onSelectProduct: (product: InventoryItemOption) => void;
  placeholder?: string;
  className?: string;
  currencySymbol?: string;
}

export function ProductAutocompleteInput({
  value,
  onChange,
  onSelectProduct,
  placeholder = "Item description *",
  className,
  currencySymbol = "£",
}: ProductAutocompleteInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<InventoryItemOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedQuery = useDebounce(value, 150);
  const fetchIdRef = useRef(0);

  // Fetch suggestions based on input or initial focus
  const fetchSuggestions = useCallback(async (searchQuery: string) => {
    const fetchId = ++fetchIdRef.current;
    setLoading(true);

    try {
      const orgId = typeof window !== "undefined" ? localStorage.getItem("activeOrgId") : null;
      const params = new URLSearchParams({ limit: "8" });
      if (searchQuery.trim()) {
        params.set("search", searchQuery.trim());
      }

      const res = await fetch(`/api/v1/inventory?${params.toString()}`, {
        headers: orgId ? { "x-organization-id": orgId } : {},
      });

      if (!res.ok) throw new Error("Failed to fetch suggestions");
      const data = await res.json();

      if (fetchId === fetchIdRef.current && Array.isArray(data.data)) {
        setSuggestions(data.data);
      }
    } catch (err) {
      if (fetchId === fetchIdRef.current) {
        setSuggestions([]);
      }
    } finally {
      if (fetchId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // When debounced query changes, refetch if open
  useEffect(() => {
    if (isOpen) {
      fetchSuggestions(debouncedQuery);
    }
  }, [debouncedQuery, isOpen, fetchSuggestions]);

  // Click outside listener to close dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleFocus = () => {
    setIsOpen(true);
    fetchSuggestions(value);
  };

  const handleSelect = (item: InventoryItemOption) => {
    onSelectProduct(item);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === "ArrowDown") {
        setIsOpen(true);
        fetchSuggestions(value);
        e.preventDefault();
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev < suggestions.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === "Enter") {
      if (highlightedIndex >= 0 && suggestions[highlightedIndex]) {
        e.preventDefault();
        handleSelect(suggestions[highlightedIndex]);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
      e.preventDefault();
    }
  };

  return (
    <div ref={containerRef} className="relative flex-1">
      <Input
        ref={inputRef}
        className={cn("h-8 text-sm w-full", className)}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (!isOpen) setIsOpen(true);
        }}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
      />

      {isOpen && (
        <div
          className="absolute left-0 top-full mt-1.5 w-full min-w-[320px] max-w-lg z-50 rounded-lg border bg-popover text-popover-foreground shadow-xl overflow-hidden animate-in fade-in-0 zoom-in-95 duration-100"
          style={{ maxHeight: "320px" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/40 text-[11px] font-medium text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Sparkles className="size-3 text-amber-500" />
              Product Catalog Suggestions
            </span>
            {loading && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
          </div>

          {/* Suggestions List */}
          <div className="overflow-y-auto max-h-[260px] p-1 divide-y divide-border/40">
            {suggestions.length > 0 ? (
              suggestions.map((item, idx) => {
                const isSelected = idx === highlightedIndex;
                const priceFormatted = (item.salePrice / 100).toFixed(2);
                const subtext = item.shortDescription || item.description;

                return (
                  <div
                    key={item.id}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelect(item);
                    }}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    className={cn(
                      "flex items-center gap-3 px-2.5 py-2 rounded-md cursor-pointer transition-colors text-left",
                      isSelected
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-muted/70 text-foreground"
                    )}
                  >
                    {/* Thumbnail Image or Icon */}
                    <div className="size-9 rounded border bg-background shrink-0 flex items-center justify-center overflow-hidden shadow-xs">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          className="size-full object-cover"
                        />
                      ) : (
                        <Package className="size-4 text-muted-foreground/60" />
                      )}
                    </div>

                    {/* Product Name & Specs */}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold truncate leading-tight">
                        {item.name}
                      </div>
                      {subtext ? (
                        <div className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">
                          {subtext}
                        </div>
                      ) : (
                        <div className="text-[10px] text-muted-foreground/60 truncate font-mono mt-0.5">
                          {item.code}
                        </div>
                      )}
                    </div>

                    {/* Price Tag Badge */}
                    <div className="shrink-0 flex items-center gap-1.5">
                      {item.salePrice > 0 ? (
                        <div className="rounded bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/60 px-2 py-0.5 text-xs font-mono font-bold text-emerald-700 dark:text-emerald-400">
                          {currencySymbol}{priceFormatted}
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">--</span>
                      )}
                      <ArrowRight className="size-3 text-muted-foreground/40 hidden group-hover:block" />
                    </div>
                  </div>
                );
              })
            ) : !loading ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                <p className="font-medium text-foreground/80">
                  {value.trim() ? `No matching product for "${value}"` : "No products in catalog yet"}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Typing any new product will automatically store it when you save this document.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
