import {
  makeWASocket,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  DisconnectReason
} from "@whiskeysockets/baileys";

import qrcode from "qrcode-terminal";
import fs from "fs";
import P from "pino";
import axios from "axios";
import express from "express";

// ================= KEEP ALIVE (REPLIT / RENDER) =================
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("🤖 Mr Wisdom WhatsApp Bot is running");
});

app.listen(PORT, () => {
  console.log("🌐 Keep-alive server running");
});

// ================= BASIC SETUP =================
const logger = P({ level: "silent" });

if (!fs.existsSync("./downloads")) fs.mkdirSync("./downloads");

let sock;

// ================= SMART DM REPLIES =================
function smartReply(text) {
  const t = text.toLowerCase();

  if (["hi", "hello", "hey", "afa"].includes(t)) {
    const replies = [
      "Hey 👋 How are you?",
      "Hello 😄 What’s up?",
      "Hi there! Need help?",
      "Yo 👀 How can I help?"
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }

  if (t.includes("help")) {
    return "🤖 I’m Mr Wisdom’s bot.\nSend *menu* in a group to see commands.";
  }

  return "🤖 Hello! This is Mr Wisdom’s bot.\nYour message has been received ✅";
}

// ================= START BOT =================
async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    auth: state,
    version,
    logger
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) qrcode.generate(qr, { small: true });

    if (connection === "open") console.log("✅ Bot connected successfully!");

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("❌ Disconnected. Reconnecting...");
      setTimeout(startSock, 5000);
    }
  });

  // ================= MESSAGE HANDLER =================
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    const isGroup = sender.endsWith("@g.us");

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    const body = text.trim().toLowerCase();

    // ================= DM HANDLER =================
    if (!isGroup) {
      const reply = smartReply(body);
      await sock.sendMessage(sender, { text: reply });
      return;
    }

    // ================= GROUP HANDLER =================
    if (!body.startsWith(".")) return;

    let groupMetadata;
    try {
      groupMetadata = await sock.groupMetadata(sender);
    } catch {
      return;
    }

    const senderId = msg.key.participant;
    const admins = groupMetadata.participants
      .filter(p => p.admin)
      .map(p => p.id);

    const isAdmin = admins.includes(senderId);

    // ===== ADMIN CHECK =====
    if (!isAdmin) {
      await sock.sendMessage(sender, {
        text: "❌ Only *group admins* can use bot commands."
      });
      return;
    }

    // ===== MENU =====
    if (body === ".menu") {
      await sock.sendMessage(sender, {
        text:
`🤖 *Mr Wisdom Bot Menu*

.admin commands only

.tagall – Tag all members
.info – Group info
.rules – Group rules
.save <link> – Save media
.kick @user – Kick mentioned user(s)

✨ Powered by Mr Wisdom`
      });
    }

    // ===== TAGALL WITH RANDOM SYMBOL =====
    if (body === ".tagall") {
      const members = groupMetadata.participants.map(p => p.id);
      const symbols = ["💠", "🔹", "🔸", "⭐", "✨", "⚡️"];
      const tagText = members
        .map(m => `${symbols[Math.floor(Math.random() * symbols.length)]}@${m.split("@")[0]}`)
        .join("\n");

      await sock.sendMessage(sender, {
        text: `📢 *Attention Everyone!*\n\n👥 Total Members: *${members.length}*\n\n${tagText}`,
        mentions: members
      });
    }

    // ===== INFO =====
    if (body === ".info") {
      await sock.sendMessage(sender, {
        text:
`ℹ️ *Group Information*

📛 Name: ${groupMetadata.subject}
👥 Members: ${groupMetadata.participants.length}
👑 Admins: ${admins.length}`
      });
    }

    // ===== RULES =====
    if (body === ".rules") {
      await sock.sendMessage(sender, {
        text:
`📜 *Group Rules*

1️⃣ Be respectful  
2️⃣ No spam  
3️⃣ No insults  
4️⃣ Follow admin instructions  

⚠️ Violators may be removed`
      });
    }

    // ===== SAVE MEDIA =====
    if (body.startsWith(".save")) {
      const url = text.split(" ")[1];
      if (!url) {
        await sock.sendMessage(sender, { text: "❌ Usage: .save <direct media link>" });
        return;
      }

      try {
        const filename = `./downloads/${Date.now()}.mp4`;
        const res = await axios.get(url, { responseType: "arraybuffer" });
        fs.writeFileSync(filename, res.data);

        await sock.sendMessage(sender, {
          video: fs.readFileSync(filename),
          caption: "✅ Media saved successfully"
        });
      } catch {
        await sock.sendMessage(sender, { text: "❌ Failed to download media" });
      }
    }

    // ===== KICK COMMAND =====
    if (body.startsWith(".kick")) {
      const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
      if (!mentioned.length) {
        await sock.sendMessage(sender, {
          text: "❌ You must mention the user(s) to kick. Example: .kick @username"
        });
        return;
      }

      try {
        for (const user of mentioned) {
          await sock.groupParticipantsUpdate(sender, [user], "remove");
        }
        await sock.sendMessage(sender, { text: "✅ User(s) kicked successfully!" });
      } catch (err) {
        console.log(err);
        await sock.sendMessage(sender, {
          text: "❌ Failed to kick user(s). Make sure the bot is an admin."
        });
      }
    }
  });
}

startSock();
