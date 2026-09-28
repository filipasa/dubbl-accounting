import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api/auth-context";
import { handleError } from "@/lib/api/response";
import { nanoid } from "nanoid";
import fs from "fs/promises";
import path from "path";

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
    // Optional org / auth check if headers/cookie present
    const orgId = request.headers.get("x-organization-id") || "default";

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

    // Determine extension
    let ext = path.extname(file.name).toLowerCase();
    if (!ext) {
      if (file.type === "image/jpeg") ext = ".jpg";
      else if (file.type === "image/png") ext = ".png";
      else if (file.type === "image/webp") ext = ".webp";
      else if (file.type === "image/gif") ext = ".gif";
      else if (file.type === "image/svg+xml") ext = ".svg";
      else ext = ".png";
    }

    const uniqueId = nanoid(12);
    let finalFileName = `${uniqueId}${ext}`;
    const targetDir = path.join(process.cwd(), "public", "uploads", "line-items");

    await fs.mkdir(targetDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    const filePath = path.join(targetDir, finalFileName);
    await fs.writeFile(filePath, buffer);

    if (ext !== ".png" && ext !== ".jpg" && ext !== ".jpeg") {
      const pngFileName = `${uniqueId}.png`;
      const pngFilePath = path.join(targetDir, pngFileName);
      try {
        const { execSync } = await import("child_process");
        execSync(`sips -s format png "${filePath}" --out "${pngFilePath}"`, { stdio: "ignore" });
        finalFileName = pngFileName;
      } catch {
        // Fallback to original
      }
    }

    const publicUrl = `/uploads/line-items/${finalFileName}`;

    return NextResponse.json(
      {
        url: publicUrl,
        fileName: file.name,
        size: file.size,
      },
      { status: 201 }
    );
  } catch (err) {
    return handleError(err);
  }
}
