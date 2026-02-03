import { 
  makeWASocket, fetchLatestBaileysVersion, useMultiFileAuthState, jidDecode, DisconnectReason 
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import P from 'pino';
import axios from 'axios';

const logger = P({ level: 'silent' });

// Ensure downloads folder exists
if(!fs.existsSync('./downloads')) fs.mkdirSync('./downloads');

// Persist auth state
const { state, saveCreds } = await useMultiFileAuthState('auth_info');

// WhatsApp version
const versionInfo = await fetchLatestBaileysVersion();
const version = versionInfo?.version || [2, 2314, 15];

// Track replied DMs to avoid spam
const repliedDMs = new Set();

let sock;

async function startSock() {
  sock = makeWASocket({ version, auth: state, logger });

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if(qr) {
      console.log('Scan this QR code:');
      qrcode.generate(qr, { small: true });
    }
    if(connection === 'open') console.log('✅ Bot connected!');
    if(connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode || 'unknown';
      console.log(`❌ Bot disconnected (${reason}), reconnecting in 5s...`);
      setTimeout(startSock, 5000);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if(type !== 'notify') return;

    const msg = messages[0];
    if(!msg.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
    const isGroup = sender.endsWith('@g.us');

    // --- DM Auto Reply ---
    if(!isGroup && text && !repliedDMs.has(sender)) {
      repliedDMs.add(sender);

      const dynamicReply = text.toLowerCase().includes('hi') 
        ? "Good thanks for messaging. Mr Wisdom is currently offline, he will respond once active."
        : "🤖 Hello! This is Mr Wisdom's bot. Your message has been recorded.";

      await sock.sendMessage(sender, { text: dynamicReply });
    }

    // --- Group Commands ---
    if(isGroup && text?.startsWith('.')) {
      const command = text.toLowerCase();
      let groupMetadata;
      try {
        groupMetadata = await sock.groupMetadata(sender);
      } catch {
        groupMetadata = { participants: [], subject: 'Unknown' };
      }

      // Show menu
      if(command === '.menu') {
        await sock.sendMessage(sender, { text: `🤖 *Mr Wisdom Bot Commands:*\n.tagall - Tag all members\n.info - Group info\n.rules - Show rules\n.sticker - Convert replied image/video to sticker\n.save <link> - Save media\n.menu - Show this menu` });
      }

      // Tag all vertically
      if(command === '.tagall') {
        const members = groupMetadata.participants.map(p => p.id);
        const mentions = members.map(m => `🎊@${m}`).join('\n');
        await sock.sendMessage(sender, { text: `You are all needed! (${members.length} members)\n${mentions}`, mentions: members });
      }

      // Group info
      if(command === '.info') {
        await sock.sendMessage(sender, { text: `*Group Info:*\nName: ${groupMetadata.subject}\nID: ${sender}\nMembers: ${groupMetadata.participants.length}` });
      }

      // Rules placeholder
      if(command === '.rules') {
        await sock.sendMessage(sender, { text: `*Group Rules:*\n1. Be nice\n2. No spam\n3. Follow admins` });
      }

      // Sticker conversion
      if(command.startsWith('.sticker')) {
        try {
          const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
          const media = quoted?.imageMessage || quoted?.videoMessage;
          if(media) {
            const buffer = Buffer.from(media?.jpegThumbnail || media?.caption, 'base64');
            await sock.sendMessage(sender, { sticker: { url: buffer } });
          } else {
            await sock.sendMessage(sender, { text: 'Reply to an image/video to create sticker.' });
          }
        } catch(e) {
          console.log('Sticker error:', e);
        }
      }

      // Save media
      if(command.startsWith('.save')) {
        const url = text.split(' ')[1];
        if(!url) return await sock.sendMessage(sender, { text: 'Provide a valid media URL.' });
        try {
          const filename = `./downloads/${Date.now()}.mp4`;
          const response = await axios({ url, responseType: 'arraybuffer' });
          fs.writeFileSync(filename, response.data);
          await sock.sendMessage(sender, { text: '✅ Here is your video without watermark!', video: { url: filename } });
        } catch(e) {
          console.log('Save media error:', e);
          await sock.sendMessage(sender, { text: '❌ Failed to save media' });
        }
      }
    }
  });
}

startSock();
