// index.mjs
import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState
} from "@whiskeysockets/baileys";

import Pino from "pino";
import qrcode from "qrcode-terminal";

// ===== CONFIG =====
const forbiddenWords = ["badword1", "badword2"];
const dmAutoReplyText = "Hello! I am a bot and cannot chat here. Please contact group admins.";

// Scheduled tagall storage
const scheduledTagAlls = {}; // { groupId: timeoutId }

// ===== START BOT =====
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("./auth_info");

    const sock = makeWASocket({
        auth: state,
        logger: Pino({ level: "warn" }),
    });

    sock.ev.on("creds.update", saveCreds);

    // Connection updates
    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
        if (qr) qrcode.generate(qr, { small: true }); // print QR if needed

        if (connection === "open") console.log("✅ WhatsApp connected successfully!");

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

    // ===== MESSAGE HANDLER =====
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;
        const msg = messages[0];
        if (!msg.message) return;

        const from = msg.key.remoteJid;
        const sender = msg.key.participant || from;
        const isGroup = from.endsWith("@g.us");
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (!text) {
            // DM auto-reply
            if (!isGroup && !msg.key.fromMe) {
                await sock.sendMessage(from, { text: dmAutoReplyText });
            }
            return;
        }

        let meta, isAdmin = false;
        if (isGroup) {
            meta = await sock.groupMetadata(from);
            isAdmin = meta.participants.some(p => p.id === sender && p.admin);
        }

        // ===== AUTO REMOVAL FOR FORBIDDEN WORDS / SPAM =====
        if (isGroup && !msg.key.fromMe) {
            for (const word of forbiddenWords) {
                if (text.toLowerCase().includes(word)) {
                    if (isAdmin) continue;
                    await sock.groupParticipantsUpdate(from, [sender], "remove");
                    await sock.sendMessage(from, {
                        text: `⚠️ @${sender.split("@")[0]} removed for forbidden word/spam.`,
                        mentions: [sender]
                    });
                    return; // stop further processing
                }
            }
        }

        // ===== COMMANDS =====
        if (!isGroup || !isAdmin) return; // Only admins can use commands

        // ===== MENU =====
        if (text === "!menu") {
            const menu = [
                "📜 *Bot Menu* 📜",
                "1️⃣ !rules - Show group rules",
                "2️⃣ !info - Show group info",
                "3️⃣ !tagall - Tag all members",
                "4️⃣ !tagall by HH:MM - Schedule tagall",
                "5️⃣ !kick @user - Kick member",
                "6️⃣ DM auto-reply active"
            ].join("\n");
            await sock.sendMessage(from, { text: menu });
        }

        // ===== RULES =====
        else if (text === "!rules") {
            const rules = [
                "📌 Always respect all members",
                "📌 No spam",
                "📌 Follow admins instructions",
                "📌 Failure to attend clan training = immediate removal",
                "⚠️ Violators will be removed"
            ].join("\n");
            await sock.sendMessage(from, { text: rules });
        }

        // ===== INFO =====
        else if (text === "!info") {
            let info = `👥 Group: ${meta.subject}\n🆔 ID: ${meta.id}\n👑 Admins:\n`;
            const admins = meta.participants.filter(p => p.admin);
            admins.forEach(a => info += `- @${a.id.split("@")[0]}\n`);
            await sock.sendMessage(from, {
                text: info,
                mentions: admins.map(a => a.id)
            });
        }

        // ===== TAGALL =====
        else if (text.startsWith("!tagall")) {
            const byTime = text.match(/by (\d{1,2}):(\d{2})/); // e.g., !tagall by 21:00

            if (byTime) {
                const hour = parseInt(byTime[1]);
                const minute = parseInt(byTime[2]);

                const now = new Date();
                const targetTime = new Date();
                targetTime.setHours(hour, minute, 0, 0);
                if (targetTime < now) targetTime.setDate(targetTime.getDate() + 1);

                const delay = targetTime - now;

                if (scheduledTagAlls[from]) clearTimeout(scheduledTagAlls[from]); // cancel previous

                scheduledTagAlls[from] = setTimeout(async () => {
                    const meta = await sock.groupMetadata(from);
                    const msgText = meta.participants.map(p => `💠 @${p.id.split("@")[0]}`).join("\n");
                    await sock.sendMessage(from, {
                        text: msgText,
                        mentions: meta.participants.map(p => p.id)
                    });
                    delete scheduledTagAlls[from];
                }, delay);

                await sock.sendMessage(from, { text: `⏰ Scheduled tagall at ${hour}:${minute}.` });
            } else {
                const msgText = meta.participants.map(p => `💠 @${p.id.split("@")[0]}`).join("\n");
                await sock.sendMessage(from, {
                    text: msgText,
                    mentions: meta.participants.map(p => p.id)
                });
            }
        }

        // ===== KICK =====
        else if (text.startsWith("!kick")) {
            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
            if (mentioned?.length) {
                await sock.groupParticipantsUpdate(from, mentioned, "remove");
                await sock.sendMessage(from, {
                    text: `❌ Removed @${mentioned[0].split("@")[0]}`,
                    mentions: mentioned
                });
            }
        }
    });
}

startBot();
