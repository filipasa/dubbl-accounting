"use client";

import React, { useState, useRef } from "react";
import { Image as ImageIcon, Upload, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface InventoryImageUploadProps {
  value?: string | null;
  onChange: (url: string | null) => void;
  className?: string;
  disabled?: boolean;
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

export function InventoryImageUpload({
  value,
  onChange,
  className,
  disabled = false,
}: InventoryImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please select a valid image file");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("File too large. Maximum size is 5MB");
      return;
    }

    setUploading(true);
    try {
      const fileToUpload = await prepareImageFile(file);
      const formData = new FormData();
      formData.append("file", fileToUpload);

      const orgId = typeof window !== "undefined" ? localStorage.getItem("activeOrgId") : null;
      const res = await fetch("/api/v1/uploads/image", {
        method: "POST",
        headers: orgId ? { "x-organization-id": orgId } : {},
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to upload image");
      }

      const data = await res.json();
      onChange(data.url);
      toast.success("Image uploaded successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to upload image");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={disabled || uploading}
        onChange={handleFileSelect}
      />

      {value ? (
        <div className="flex items-center gap-4">
          <div className="relative group size-20 sm:size-24 rounded-xl border border-border bg-muted/30 overflow-hidden shadow-xs shrink-0">
            <img
              src={value}
              alt="Inventory item"
              className="size-full object-cover"
            />
            {uploading && (
              <div className="absolute inset-0 bg-background/70 backdrop-blur-xs flex items-center justify-center">
                <Loader2 className="size-5 animate-spin text-primary" />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={disabled || uploading}
                onClick={() => inputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer disabled:opacity-50"
              >
                {uploading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Upload className="size-3.5" />
                )}
                Change image
              </button>
              <button
                type="button"
                disabled={disabled || uploading}
                onClick={() => onChange(null)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-destructive hover:bg-destructive/10 transition-colors cursor-pointer disabled:opacity-50"
                title="Remove image"
              >
                <X className="size-3.5" />
                Remove
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              PNG, JPG, WebP up to 5MB. Displayed in inventory and quotes/invoices.
            </p>
          </div>
        </div>
      ) : (
        <div
          onClick={() => !disabled && !uploading && inputRef.current?.click()}
          className={cn(
            "group relative flex items-center gap-3.5 p-3 rounded-xl border border-dashed border-border bg-muted/20 hover:bg-muted/40 hover:border-muted-foreground/40 transition-all cursor-pointer",
            disabled && "opacity-50 pointer-events-none"
          )}
        >
          <div className="size-12 rounded-lg bg-background border border-border flex items-center justify-center text-muted-foreground group-hover:text-foreground shrink-0 shadow-2xs transition-colors">
            {uploading ? (
              <Loader2 className="size-5 animate-spin text-primary" />
            ) : (
              <ImageIcon className="size-5" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <span>Upload item image</span>
              <span className="text-[10px] text-muted-foreground font-normal">(optional)</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
              PNG, JPG, WebP up to 5MB
            </p>
          </div>
          <div className="shrink-0 pr-1">
            <span className="inline-flex items-center text-xs font-medium text-primary group-hover:underline">
              Browse
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
