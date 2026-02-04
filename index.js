import makeWASocket, {
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    jidNormalizedUser,
    DisconnectReason,
    delay
} from "@whiskeysockets/baileys";
import Pino from "pino";

// --------- AUTH STATE ---------
const { state, saveCreds } = await useMultiFileAuthState("./session");

// --------- CREATE SOCKET ---------
const sock = makeWASocket({
    auth: state,
    logger: Pino({ level: "warn" }),
    printQRInTerminal: true
});

// Save creds automatically
sock.ev.on('creds.update', saveCreds);

// --------- RECONNECT HANDLER ---------
sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if(connection === 'close') {
        console.log("🔌 Disconnected, reconnecting...");
    } else if(connection === 'open') {
        console.log("✅ Bot connected successfully!");
    }
});

// --------- FORBIDDEN WORDS ---------
const forbiddenWords = ["spam", "disrespect"];

// --------- LISTEN FOR MESSAGES ---------
sock.ev.on('messages.upsert', async (m) => {
    if (!m.messages) return;
    const msg = m.messages[0];
    if (!msg.message) return;

    const sender = msg.key.remoteJid;
    const fromMe = msg.key.fromMe;
    const isGroup = sender.endsWith("@g.us");
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

    let meta = null;
    let isAdmin = false;
    if(isGroup) {
        meta = await sock.groupMetadata(sender);
        isAdmin = meta.participants.some(p => p.jid === msg.key.participant && p.admin !== "none");
    }

    // --------- AUTO REMOVE FOR VIOLATORS ---------
    if(isGroup && !fromMe){
        for(let word of forbiddenWords){
            if(text.toLowerCase().includes(word)){
                await sock.groupParticipantsUpdate(sender, [msg.key.participant], "remove");
                await sock.sendMessage(sender, { 
                    text: `⚠️ @${msg.key.participant.split("@")[0]} removed for violating group rules`
                }, { quoted: msg, mentions: [msg.key.participant] });
            }
        }
    }

    // --------- COMMANDS ---------
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

    // ----- RULES -----
    else if(text === "!rules" && isGroup){
        const rules = [
            "1️⃣ Always respect all members",
            "2️⃣ No spam",
            "3️⃣ Follow admins instructions",
            "4️⃣ Failure to attend clan training = immediate removal",
            "⚠️ Violators will be removed"
        ];
        await sock.sendMessage(sender, { text: "📌 Group Rules:\n" + rules.join("\n") });
    }

    // ----- GROUP INFO -----
    else if(text === "!info" && isGroup){
        let info = `👥 Group Name: ${meta.subject}\n🆔 Group ID: ${meta.id}\n👑 Admins:\n`;
        const admins = meta.participants.filter(p => p.admin !== "none");
        admins.forEach(a => info += `- @${a.jid.split("@")[0]}\n`);
        await sock.sendMessage(sender, { text: info, mentions: admins.map(a => a.jid) });
    }

    // ----- TAG ALL MEMBERS -----
    else if(text.startsWith("!tagall") && isGroup && isAdmin){
        let msgText = "💠 Tagging all members:\n";
        meta.participants.forEach(p => msgText += `@${p.jid.split("@")[0]}\n`);
        await sock.sendMessage(sender, { text: msgText, mentions: meta.participants.map(p=>p.jid) });
    }

    // ----- TAG ADMINS -----
    else if(text.startsWith("!tagadmins") && isGroup && isAdmin){
        let msgText = "👑 Tagging admins:\n";
        const admins = meta.participants.filter(p => p.admin !== "none");
        admins.forEach(p => msgText += `@${p.jid.split("@")[0]}\n`);
        await sock.sendMessage(sender, { text: msgText, mentions: admins.map(p => p.jid) });
    }

    // ----- KICK COMMAND -----
    else if(text.startsWith("!kick") && isGroup && isAdmin){
        const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if(mentions.length === 0) return await sock.sendMessage(sender, { text: "⚠️ Mention the user to kick" });
        await sock.groupParticipantsUpdate(sender, mentions, "remove");
    }

    // ----- DM REPLY -----
    else if(!isGroup){
        await sock.sendMessage(sender, { text: `🤖 Hello! I got your message:\n"${text}"` });
    }
});
