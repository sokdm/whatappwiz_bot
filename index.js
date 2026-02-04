import { default as makeWASocket, useMultiFileAuthState, jidNormalizedUser, DisconnectReason, delay } from "@adiwajshing/baileys";
import Pino from "pino";

// Load auth state (session folder)
const { state, saveCreds } = await useMultiFileAuthState("./auth_info");

let sock = makeWASocket({
    auth: state,
    logger: Pino({ level: "warn" })
});

// Save credentials
sock.ev.on('creds.update', saveCreds);

// Auto-reconnect
sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if(qr){
        console.log("🔗 New QR received, scan to login");
    }

    if(connection === "close"){
        const reason = lastDisconnect?.error?.output?.statusCode;
        console.log("Disconnected:", reason);
        if(reason !== DisconnectReason.loggedOut){
            console.log("Reconnecting...");
            sock = makeWASocket({ auth: state, logger: Pino({ level: "warn" }) });
            sock.ev.on('creds.update', saveCreds);
        } else {
            console.log("❌ Logged out, need to scan QR");
        }
    } else if(connection === "open"){
        console.log("✅ Bot connected successfully!");
    }
});

// Forbidden words
const forbiddenWords = ["spam", "disrespect"];

// Listen for messages
sock.ev.on('messages.upsert', async (m) => {
    if(!m.messages) return;
    const msg = m.messages[0];
    if(!msg.message) return;

    const sender = msg.key.remoteJid;
    const fromMe = msg.key.fromMe;
    const isGroup = sender.endsWith("@g.us");
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

    let meta = null;
    let isAdmin = false;
    if(isGroup){
        meta = await sock.groupMetadata(sender);
        isAdmin = meta.participants.some(p => p.jid === msg.key.participant && p.admin !== "none");
    }

    // Auto-remove violators
    if(isGroup && !fromMe){
        for(let word of forbiddenWords){
            if(text.toLowerCase().includes(word)){
                await sock.groupParticipantsUpdate(sender, [msg.key.participant], "remove");
                await sock.sendMessage(sender, { text: `⚠️ @${msg.key.participant.split("@")[0]} removed for violating group rules` }, { quoted: msg, mentions: [msg.key.participant] });
            }
        }
    }

    // ----- COMMANDS -----
    if(text === "!menu"){
        let menu = "📜 *Menu* 📜\n";
        menu += "1️⃣ !rules - Show group rules\n";
        menu += "2️⃣ !info - Group info\n";
        menu += "3️⃣ !tagall - Tag all members vertically\n";
        menu += "4️⃣ !tagadmins - Tag all admins\n";
        menu += "5️⃣ !kick @tag - Kick member (admin only)\n";
        menu += "6️⃣ DM reply\n";
        await sock.sendMessage(sender, { text: menu });
    }
    else if(text === "!rules" && isGroup){
        const rules = [
            "Always respect all members",
            "No spam",
            "Follow admins instructions",
            "Failure to attend clan training = immediate removal",
            "⚠️ Violators will be removed"
        ];
        await sock.sendMessage(sender, { text: `📌 Group Rules:\n${rules.map((r,i)=>`${i+1}. ${r}`).join("\n")}` });
    }
    else if(text === "!info" && isGroup){
        let info = `👥 Group Name: ${meta.subject}\n🆔 Group ID: ${meta.id}\n👑 Admins:\n`;
        meta.participants.filter(p => p.admin !== "none").forEach(a => info += `- @${a.jid.split("@")[0]}\n`);
        await sock.sendMessage(sender, { text: info, mentions: meta.participants.filter(p => p.admin !== "none").map(a=>a.jid) });
    }
    else if(text.startsWith("!tagall") && isGroup && isAdmin){
        let msgText = "💠 Tagging all members:\n";
        meta.participants.forEach(p => msgText += `@${p.jid.split("@")[0]}\n`);
        await sock.sendMessage(sender, { text: msgText, mentions: meta.participants.map(p=>p.jid) });
    }
    else if(text.startsWith("!tagadmins") && isGroup && isAdmin){
        let msgText = "👑 Tagging admins:\n";
        meta.participants.filter(p => p.admin !== "none").forEach(p => msgText += `@${p.jid.split("@")[0]}\n`);
        await sock.sendMessage(sender, { text: msgText, mentions: meta.participants.filter(p => p.admin !== "none").map(p=>p.jid) });
    }
    else if(text.startsWith("!kick") && isGroup && isAdmin){
        const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if(mentions.length === 0) return await sock.sendMessage(sender, { text: "⚠️ Mention the user to kick" });
        await sock.groupParticipantsUpdate(sender, mentions, "remove");
    }
    else if(!isGroup){
        await sock.sendMessage(sender, { text: `🤖 Hello! I got your message:\n"${text}"` });
    }
});
