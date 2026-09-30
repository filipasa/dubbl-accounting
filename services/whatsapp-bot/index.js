import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  Browsers,
} from "@whiskeysockets/baileys";
import qrcodeTerminal from "qrcode-terminal";
import QRCode from "qrcode";
import pino from "pino";
import path from "path";
import fs from "fs";
import { config } from "./config.js";
import { handleIncomingMessage } from "./command-handler.js";

const logger = pino({ level: "silent" });
const ARTIFACT_DIR =
  "/Users/filipvacarciuc/.gemini/antigravity/brain/bd336c71-3d58-4460-bf72-8da280083f3e";

// Keep track of messages sent by the bot to prevent echo loops
const botMessageIds = new Set();
const recentBotReplies = new Set();

let currentSock = null;
let reconnectTimer = null;
let isReconnecting = false;
let pairingCodeRequested = false;

/**
 * Robustly extracts the text payload from various WhatsApp message wrappers
 */
function extractMessageContent(msg) {
  if (!msg || !msg.message) return "";

  let m = msg.message;
  let depth = 0;
  while (m && depth < 6) {
    depth++;
    if (m.ephemeralMessage?.message) {
      m = m.ephemeralMessage.message;
    } else if (m.viewOnceMessage?.message) {
      m = m.viewOnceMessage.message;
    } else if (m.viewOnceMessageV2?.message) {
      m = m.viewOnceMessageV2.message;
    } else if (m.documentWithCaptionMessage?.message) {
      m = m.documentWithCaptionMessage.message;
    } else if (m.editedMessage?.message) {
      m = m.editedMessage.message;
    } else {
      break;
    }
  }

  const text =
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedButtonId ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    m.templateButtonReplyMessage?.selectedId ||
    "";

  return typeof text === "string" ? text.trim() : "";
}

async function connectToWhatsApp() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // Cleanly close any existing socket before opening a new connection
  if (currentSock) {
    try {
      currentSock.ev.removeAllListeners();
      currentSock.ws?.close();
    } catch {
      // ignore cleanup errors
    }
    currentSock = null;
  }

  const { state, saveCreds } = await useMultiFileAuthState(
    "./auth_info_baileys"
  );

  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: !config.botPhoneNumber,
    browser: Browsers.macOS("Chrome"),
    keepAliveIntervalMs: 25000,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    syncFullHistory: false,
    markOnlineOnConnect: true,
  });

  currentSock = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // If QR is emitted, save image for optional QR scanning
    if (qr) {
      try {
        const localImgPath = path.resolve("./whatsapp_qr.png");
        await QRCode.toFile(localImgPath, qr, { width: 320 });
        if (fs.existsSync(ARTIFACT_DIR)) {
          const artifactImgPath = path.join(ARTIFACT_DIR, "whatsapp_qr.png");
          await QRCode.toFile(artifactImgPath, qr, { width: 320 });
        }
      } catch (err) {
        console.error("Failed to save QR image:", err.message);
      }
    }

    // Request Pairing Code if BOT_PHONE_NUMBER is set and not yet registered
    const isAlreadyPaired = Boolean(state.creds?.me?.id);
    if (
      config.botPhoneNumber &&
      !isAlreadyPaired &&
      !pairingCodeRequested
    ) {
      pairingCodeRequested = true;
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(config.botPhoneNumber);
          console.log("\n" + "=".repeat(60));
          console.log(`📲 LINKING TO NUMBER: +${config.botPhoneNumber}`);
          console.log(`🔑 YOUR 8-CHARACTER PAIRING CODE IS:`);
          console.log(`\n       👉   ${code}   👈\n`);
          console.log("HOW TO LINK ON YOUR PHONE:");
          console.log(`1. Open WhatsApp on device +${config.botPhoneNumber}`);
          console.log("2. Go to Settings > Linked Devices > Link a Device");
          console.log('3. Tap "Link with phone number instead" at the bottom');
          console.log(`4. Enter the code above: ${code}`);
          console.log("=".repeat(60) + "\n");
        } catch (err) {
          console.error("Failed to request pairing code:", err);
          pairingCodeRequested = false;
        }
      }, 3000);
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(
        `[Connection] Closed. Reason: ${lastDisconnect?.error?.message || "unknown"} (code ${statusCode}). Reconnecting: ${shouldReconnect}`
      );

      if (shouldReconnect && !isReconnecting) {
        isReconnecting = true;
        reconnectTimer = setTimeout(() => {
          isReconnecting = false;
          connectToWhatsApp().catch(console.error);
        }, 3000);
      } else if (!shouldReconnect) {
        console.log(
          "Session logged out permanently. Delete ./auth_info_baileys to reconnect."
        );
      }
    } else if (connection === "open") {
      isReconnecting = false;
      pairingCodeRequested = false;
      console.log("\n" + "=".repeat(60));
      console.log("🚀 Fixbooks Personal WhatsApp Bot is ONLINE!");
      console.log(`Connected to Fixbooks at: ${config.dubblUrl}`);
      console.log(
        config.geminiApiKey
          ? "🤖 Natural Language AI (Gemini) is ENABLED."
          : "⚠️ Natural Language AI key is not set; shortcut commands active."
      );
      console.log("=".repeat(60) + "\n");
    }
  });

  sock.ev.on("messages.upsert", async (m) => {
    try {
      if (!m.messages || m.messages.length === 0) return;

      for (const msg of m.messages) {
        if (!msg || !msg.message) continue;

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid || remoteJid === "status@broadcast") continue;

        // 1. Loop prevention: check if this message ID was sent by our bot
        if (msg.key.id && botMessageIds.has(msg.key.id)) {
          continue;
        }

        // 2. Extract message text
        let text = extractMessageContent(msg);
        let isNonTextMessage = false;

        if (!text) {
          const mContent = msg.message;
          const hasMedia = Boolean(
            mContent?.audioMessage ||
            mContent?.voiceMessage ||
            mContent?.imageMessage ||
            mContent?.videoMessage ||
            mContent?.stickerMessage ||
            mContent?.documentMessage ||
            mContent?.locationMessage ||
            mContent?.contactMessage
          );

          if (hasMedia) {
            isNonTextMessage = true;
          } else {
            // Receipt / reaction / sync notification with no user text
            continue;
          }
        }

        // 3. Loop prevention: check if the exact text was recently sent by our bot (only for fromMe)
        if (msg.key.fromMe && recentBotReplies.has(text)) {
          continue;
        }

        // 4. Resolve identities
        const myPhone = (sock.user?.id || state.creds?.me?.id || "")
          .split(":")[0]
          .replace(/[^0-9]/g, "");
        const myLid = (sock.user?.lid || state.creds?.me?.lid || "")
          .split(":")[0]
          .replace(/[^0-9]/g, "");
        const remoteNumber = remoteJid.replace(/[^0-9]/g, "");

        const isSelfChat =
          (myPhone && remoteNumber === myPhone) ||
          (myLid && remoteNumber === myLid);

        // If message is fromMe:
        // Only process if it is in self-chat. If chatting with external contacts, ignore.
        if (msg.key.fromMe && !isSelfChat) {
          continue;
        }

        // Security check: Whitelisted phone numbers (if configured and not self)
        if (
          !msg.key.fromMe &&
          config.allowedNumbers.length > 0 &&
          !config.allowedNumbers.includes(remoteNumber)
        ) {
          console.log(
            `[Security] Ignored message from unauthorized sender: ${remoteNumber}`
          );
          continue;
        }

        console.log(
          `\n📩 Received message from ${remoteNumber}: "${text || "[Non-text Media]"}"`
        );

        // Indicate typing in WhatsApp
        await sock.sendPresenceUpdate("composing", remoteJid).catch(() => {});

        // 5. Dispatch command or AI processing with timeout & generic error fallback
        let reply = "";
        if (isNonTextMessage) {
          reply =
            "👋 I can only understand text messages right now. Please type your request (e.g. _\"Create an invoice for Filip for 2 oak doors @ £250\"_) or type `!help` for available commands.";
        } else {
          try {
            // 25-second timeout to avoid any silent hangs
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error("REQUEST_TIMEOUT")), 25000)
            );

            reply = await Promise.race([
              handleIncomingMessage(text, remoteNumber),
              timeoutPromise,
            ]);
          } catch (handlerErr) {
            console.error("Error processing message:", handlerErr);
            if (handlerErr.message === "REQUEST_TIMEOUT") {
              reply =
                "⏳ I'm taking longer than usual to process that. Please try again in a moment, or type `!help` for instant shortcut commands.";
            } else {
              reply =
                "⚠️ Something went wrong on my end while processing that. Please try again in a moment, or type `!help` for available commands.";
            }
          }
        }

        // 6. Guarantee non-empty user-facing reply
        if (
          !reply ||
          typeof reply !== "string" ||
          !reply.trim() ||
          reply.includes("ApiError") ||
          reply.includes("ECONNREFUSED")
        ) {
          reply =
            "⚠️ Something went wrong while processing your request. Please try again or type `!help` for available commands.";
        }

        // Record reply text to prevent echo loops
        recentBotReplies.add(reply.trim());
        if (recentBotReplies.size > 100) {
          const first = recentBotReplies.values().next().value;
          recentBotReplies.delete(first);
        }

        // 7. Send reply back to the chat with fallback retry
        let sent = null;
        try {
          sent = await sock.sendMessage(
            remoteJid,
            { text: reply },
            { quoted: msg }
          );
        } catch (sendErr) {
          console.warn(
            "Failed to send quoted reply, retrying without quote:",
            sendErr.message
          );
          try {
            sent = await sock.sendMessage(remoteJid, { text: reply });
          } catch (retryErr) {
            console.error("Critical: Could not send reply:", retryErr.message);
          }
        }

        if (sent?.key?.id) {
          botMessageIds.add(sent.key.id);
          if (botMessageIds.size > 500) {
            const first = botMessageIds.values().next().value;
            botMessageIds.delete(first);
          }
        }

        await sock.sendPresenceUpdate("paused", remoteJid).catch(() => {});
        console.log(`📤 Reply sent to ${remoteNumber}`);
      }
    } catch (err) {
      console.error("Error in messages.upsert handler:", err);
    }
  });
}

connectToWhatsApp().catch(console.error);
