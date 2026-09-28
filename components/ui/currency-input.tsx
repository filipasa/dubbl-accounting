"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { getCurrencySymbol } from "@/lib/currency/iso4217";
import { getDefaultCurrency } from "@/lib/money";

interface CurrencyInputProps {
  value: string | number;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  prefix?: string;
  size?: "sm" | "default";
  disabled?: boolean;
  name?: string;
  id?: string;
}

export function CurrencyInput({
  value,
  onChange,
  placeholder = "0.00",
  className,
  prefix,
  size = "default",
  disabled,
  name,
  id,
}: CurrencyInputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  // If prefix is not specified, or was passed as "$", resolve to the active organization's currency symbol (e.g. £ for GBP)
  const resolvedPrefix =
    prefix && prefix !== "$"
      ? prefix
      : getCurrencySymbol(getDefaultCurrency());

  return (
    <div
      className={cn(
        "border-input flex items-center rounded-md border bg-transparent shadow-xs transition-[color,box-shadow]",
        "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
        disabled && "pointer-events-none opacity-50",
        size === "sm" ? "h-8" : "h-9",
        className,
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {resolvedPrefix && (
        <span className={cn(
          "select-none text-muted-foreground pl-2.5 font-mono",
          size === "sm" ? "text-xs" : "text-sm",
        )}>
          {resolvedPrefix}
        </span>
      )}
      {name && <input type="hidden" name={name} value={value} />}
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "" || /^-?\d*\.?\d{0,2}$/.test(v)) {
            onChange(v);
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          "flex-1 min-w-0 bg-transparent text-right font-mono tabular-nums outline-none placeholder:text-muted-foreground",
          size === "sm" ? "text-xs px-2 py-1" : "text-sm px-3 py-1 md:text-sm",
        )}
      />
    </div>
  );
}
