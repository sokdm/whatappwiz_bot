// index.mjs
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  jidNormalizedUser
} from "@whiskeysockets/baileys";

import Pino from "pino";
import qrcode from "qrcode-terminal";

// ===== CONFIG =====
const forbiddenWords = ["badword1", "badword2"]; // Words to auto-remove
const authPath = "./auth_info"; // Keep inside bot folder for permissions

const scheduledTagalls = []; // { groupId, time }

// ===== START BOT =====
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(authPath);

  const sock = makeWASocket({
    auth: state,
    logger: Pino({ level: "warn" }),
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) qrcode.generate(qr, { small: true });

    if (connection === "open") console.log("✅ WhatsApp connected");

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("❌ Disconnected:", reason);

      if (reason !== DisconnectReason.loggedOut) {
        console.log("🔁 Reconnecting...");
        startBot();
      } else {
        console.log("❌ Logged out. Delete auth_info to scan QR again.");
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const msg = messages[0];
    if (!msg.message) return;

    const from = msg.key.remoteJid;
    const sender = msg.key.participant || from;
    const isGroup = from.endsWith("@g.us");
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
    if (!text) return;

    let meta, isAdmin = false;
    if (isGroup) {
      meta = await sock.groupMetadata(from);
      isAdmin = meta.participants.some(p => p.id === sender && p.admin);
    }

    // ===== AUTO-REMOVE FORBIDDEN WORDS / SPAM =====
    if (isGroup && !msg.key.fromMe) {
      for (const word of forbiddenWords) {
        if (text.toLowerCase().includes(word)) {
          if (isAdmin) continue;
          await sock.groupParticipantsUpdate(from, [sender], "remove");
          await sock.sendMessage(from, {
            text: `⚠️ @${sender.split("@")[0]} removed for forbidden word`,
            mentions: [sender]
          });
        }
      }
    }

    // ===== COMMANDS (ADMIN ONLY) =====
    if (isGroup && isAdmin) {
      // MENU
      if (text === "!menu") {
        const menu = [
          "📜 *BOT MENU* 📜",
          "1️⃣ !rules - Show group rules",
          "2️⃣ !info - Show group info",
          "3️⃣ !tagall - Tag all members",
          "4️⃣ !tagadmins - Tag all admins",
          "5️⃣ !kick @tag - Kick member",
          "6️⃣ DM reply - Auto reply in DM",
          "7️⃣ !tagall by HH:MM - Schedule tagall"
        ].join("\n");
        await sock.sendMessage(from, { text: menu });
      }

      // RULES
      if (text === "!rules") {
        const rules = [
          "📌 Always respect all members",
          "📌 No spam",
          "📌 Follow admins instructions",
          "📌 Failure to attend clan training = immediate removal",
          "⚠️ Violators will be removed"
        ].join("\n");
        await sock.sendMessage(from, { text: rules });
      }

      // INFO
      if (text === "!info") {
        let info = `👥 Group: ${meta.subject}\n🆔 ID: ${meta.id}\n👑 Admins:\n`;
        meta.participants.filter(p => p.admin).forEach(a => {
          info += `- @${a.id.split("@")[0]}\n`;
        });
        await sock.sendMessage(from, { text: info, mentions: meta.participants.filter(p => p.admin).map(p => p.id) });
      }

      // TAGALL
      if (text.startsWith("!tagall")) {
        if (text.includes("by ")) {
          // Scheduled tagall
          const match = text.match(/by (\d{1,2}:\d{2})/);
          if (match) {
            const time = match[1];
            scheduledTagalls.push({ groupId: from, time });
            await sock.sendMessage(from, { text: `⏰ Scheduled tagall at ${time}` });
          }
        } else {
          // Immediate tagall
          const msgText = "💠 Tagging all members:\n" + meta.participants.map(p => `@${p.id.split("@")[0]}`).join("\n");
          await sock.sendMessage(from, { text: msgText, mentions: meta.participants.map(p => p.id) });
        }
      }

      // TAGADMINS
      if (text === "!tagadmins") {
        const admins = meta.participants.filter(p => p.admin);
        const msgText = "💠 Tagging all admins:\n" + admins.map(a => `@${a.id.split("@")[0]}`).join("\n");
        await sock.sendMessage(from, { text: msgText, mentions: admins.map(a => a.id) });
      }

      // KICK
      if (text.startsWith("!kick")) {
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
        if (mentioned?.length) {
          await sock.groupParticipantsUpdate(from, mentioned, "remove");
          await sock.sendMessage(from, { text: `❌ Removed @${mentioned[0].split("@")[0]}`, mentions: mentioned });
        }
      }
    }

    // ===== DM AUTO-REPLY =====
    if (!isGroup) {
      await sock.sendMessage(from, { text: "📩 Auto-reply: I'm currently in a group. Admins only can send commands." });
    }
  });

  // ===== SCHEDULED TAGALL CHECK =====
  setInterval(async () => {
    const now = new Date();
    const timeStr = `${now.getHours()}:${now.getMinutes().toString().padStart(2, "0")}`;
    for (const task of scheduledTagalls) {
      if (task.time === timeStr) {
        const meta = await sock.groupMetadata(task.groupId);
        const msgText = "💠 Scheduled Tagall:\n" + meta.participants.map(p => `@${p.id.split("@")[0]}`).join("\n");
        await sock.sendMessage(task.groupId, { text: msgText, mentions: meta.participants.map(p => p.id) });
      }
    }
  }, 60_000); // Check every minute
}

startBot();
