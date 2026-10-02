import zlib from "zlib";
import { qrcodegen } from "./qrcodegen";

// Fallback CRC32 calculation table
const crcTable: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function computeCrc32(buf: Buffer): number {
  if (typeof zlib.crc32 === "function") {
    return zlib.crc32(buf) >>> 0;
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, "ascii");
  data.copy(chunk, 8);

  const typeAndData = Buffer.alloc(4 + len);
  typeAndData.write(type, 0, 4, "ascii");
  data.copy(typeAndData, 4);
  const crc = computeCrc32(typeAndData);
  chunk.writeUInt32BE(crc, 8 + len);
  return chunk;
}

/**
 * Generates a standard PNG buffer containing the QR code for the given text.
 * Uses Nayuki's pure TypeScript QR Code model 2 with standard Deflate compression.
 */
export function generateQrCodePngBuffer(
  text: string,
  scale = 4,
  border = 4
): Buffer {
  if (!text) {
    throw new Error("Text is required to generate QR code");
  }

  const qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);
  const size = qr.size;
  const dim = (size + border * 2) * scale;
  const lineLength = 1 + dim;
  const rawData = Buffer.alloc(dim * lineLength);

  for (let y = 0; y < dim; y++) {
    const rowOffset = y * lineLength;
    rawData[rowOffset] = 0; // Filter method 0 (None)
    const moduleY = Math.floor(y / scale) - border;
    for (let x = 0; x < dim; x++) {
      const moduleX = Math.floor(x / scale) - border;
      let isDark = false;
      if (moduleX >= 0 && moduleX < size && moduleY >= 0 && moduleY < size) {
        isDark = qr.getModule(moduleX, moduleY);
      }
      rawData[rowOffset + 1 + x] = isDark ? 0 : 255;
    }
  }

  const deflated = zlib.deflateSync(rawData);

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(dim, 0);
  ihdrData.writeUInt32BE(dim, 4);
  ihdrData[8] = 8; // 8-bit depth
  ihdrData[9] = 0; // Grayscale
  ihdrData[10] = 0; // Deflate compression
  ihdrData[11] = 0; // Filter method
  ihdrData[12] = 0; // No interlace

  const ihdrChunk = makePngChunk("IHDR", ihdrData);
  const idatChunk = makePngChunk("IDAT", deflated);
  const iendChunk = makePngChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

/**
 * Generates a PNG Data URI (data:image/png;base64,...) for the given text.
 */
export function generateQrCodePngDataUri(
  text: string,
  scale = 4,
  border = 4
): string {
  const buf = generateQrCodePngBuffer(text, scale, border);
  return `data:image/png;base64,${buf.toString("base64")}`;
}
