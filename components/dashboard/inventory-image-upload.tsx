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

/**
 * Resizes and compresses an image in the browser to max 600x600 px.
 * Returns both a compressed File and a direct base64 data URL.
 */
async function processImage(file: File): Promise<{ file: File; dataUrl: string }> {
  return new Promise((resolve) => {
    // If it's SVG, don't downscale via canvas; read as data URL directly
    if (file.type === "image/svg+xml") {
      const reader = new FileReader();
      reader.onload = () => {
        resolve({ file, dataUrl: reader.result as string });
      };
      reader.onerror = () => {
        resolve({ file, dataUrl: "" });
      };
      reader.readAsDataURL(file);
      return;
    }

    const img = new Image();
    const blobUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(blobUrl);
      try {
        const MAX_DIM = 600;
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          const reader = new FileReader();
          reader.onload = () => resolve({ file, dataUrl: reader.result as string });
          reader.readAsDataURL(file);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        // Prefer image/webp if supported, else image/jpeg
        const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
        const quality = 0.85;
        const dataUrl = canvas.toDataURL(mimeType, quality);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve({ file, dataUrl });
              return;
            }
            const ext = mimeType === "image/png" ? "png" : "jpg";
            const baseName = file.name.replace(/\.[^.]+$/, "");
            const converted = new File([blob], `${baseName}.${ext}`, { type: mimeType });
            resolve({ file: converted, dataUrl });
          },
          mimeType,
          quality
        );
      } catch {
        const reader = new FileReader();
        reader.onload = () => resolve({ file, dataUrl: reader.result as string });
        reader.readAsDataURL(file);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      const reader = new FileReader();
      reader.onload = () => resolve({ file, dataUrl: reader.result as string });
      reader.readAsDataURL(file);
    };
    img.src = blobUrl;
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

    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large. Maximum size is 10MB");
      return;
    }

    setUploading(true);
    try {
      const { file: processedFile, dataUrl } = await processImage(file);

      // Attempt server upload
      const formData = new FormData();
      formData.append("file", processedFile);

      const orgId = typeof window !== "undefined" ? localStorage.getItem("activeOrgId") : null;
      let finalUrl = dataUrl;

      try {
        const res = await fetch("/api/v1/uploads/image", {
          method: "POST",
          headers: orgId ? { "x-organization-id": orgId } : {},
          body: formData,
        });

        if (res.ok) {
          const data = await res.json();
          if (data.url) {
            finalUrl = data.url;
          }
        }
      } catch {
        // Fallback to client-generated dataUrl
      }

      onChange(finalUrl);
      toast.success("Image updated successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to process image");
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
              Supports PNG, JPG, WebP up to 10MB. Automatically optimized.
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
              PNG, JPG, WebP up to 10MB
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
