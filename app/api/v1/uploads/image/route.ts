import { NextResponse } from "next/server";
import { handleError } from "@/lib/api/response";

const MAX_SIZE = 5 * 1024 * 1024; // 5MB

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!ALLOWED_MIME_TYPES.has(file.type) && !file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "Invalid file type. Please upload a valid image (PNG, JPG, WebP, GIF, SVG)." },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum image size is 5MB." },
        { status: 400 }
      );
    }

    // Convert image buffer to base64 data URL
    // Safe for serverless environments (read-only filesystem on Vercel / AWS Lambda)
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = file.type || "image/png";
    const base64Data = buffer.toString("base64");
    const dataUrl = `data:${mimeType};base64,${base64Data}`;

    return NextResponse.json(
      {
        url: dataUrl,
        fileName: file.name,
        size: file.size,
      },
      { status: 201 }
    );
  } catch (err) {
    return handleError(err);
  }
}
