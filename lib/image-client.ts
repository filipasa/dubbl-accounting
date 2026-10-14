"use client";

/**
 * Resizes and compresses an image in the browser (default max 600x600 px).
 * SVG files are preserved as vector data URLs without canvas rasterization.
 */
export async function processImage(
  file: File,
  maxDim = 600
): Promise<{ file: File; dataUrl: string }> {
  return new Promise((resolve) => {
    // If it's SVG, don't downscale via canvas; read as data URL directly
    if (file.type === "image/svg+xml") {
      const reader = new FileReader();
      reader.onload = () => {
        resolve({ file, dataUrl: (reader.result as string) || "" });
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
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          const reader = new FileReader();
          reader.onload = () => resolve({ file, dataUrl: (reader.result as string) || "" });
          reader.readAsDataURL(file);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

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
        reader.onload = () => resolve({ file, dataUrl: (reader.result as string) || "" });
        reader.readAsDataURL(file);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      const reader = new FileReader();
      reader.onload = () => resolve({ file, dataUrl: (reader.result as string) || "" });
      reader.readAsDataURL(file);
    };
    img.src = blobUrl;
  });
}

/**
 * Uploads an image file to the image upload endpoint, falling back
 * to a client-compressed data URL if the server is unreachable.
 */
export async function uploadImage(file: File, orgId?: string | null): Promise<string> {
  const { file: processedFile, dataUrl } = await processImage(file);

  const formData = new FormData();
  formData.append("file", processedFile);

  try {
    const res = await fetch("/api/v1/uploads/image", {
      method: "POST",
      headers: orgId ? { "x-organization-id": orgId } : {},
      body: formData,
    });

    if (res.ok) {
      const data = await res.json();
      if (data.url) {
        return data.url;
      }
    }
  } catch {
    // Fallback to dataUrl on fetch failure
  }

  return dataUrl;
}
