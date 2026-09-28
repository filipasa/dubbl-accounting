import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config(); // fallback to cwd .env as well

export const config = {
  dubblUrl: process.env.DUBBL_URL || "http://localhost:3001/api/mcp",
  dubblToken:
    process.env.DUBBL_TOKEN ||
    "mcp_at_90318ca773b0007f616d54b696a2961a0b676d6abdc7a063",
  botPhoneNumber: (process.env.BOT_PHONE_NUMBER || "").replace(/[^0-9]/g, ""),
  allowedNumbers: (process.env.ALLOWED_NUMBERS || "")
    .split(",")
    .map((n) => n.trim().replace(/[^0-9]/g, ""))
    .filter(Boolean),
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
};
