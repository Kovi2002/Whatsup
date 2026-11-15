// WhatsApp -> Claude auto-reply bot
// Poveže se na WhatsApp (kot "povezana naprava"), posluša sporočila in samodejno odgovarja s Claudom.

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import Anthropic from '@anthropic-ai/sdk';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';

// ---------- Nastavitve (.env) ----------
const AUTH_DIR = process.env.AUTH_DIR || './auth';
const HISTORY_FILE = process.env.HISTORY_FILE || path.join(AUTH_DIR, 'history.json');
const MODEL = process.env.MODEL || 'claude-haiku-5-5';
const PAIRING_NUMBER = (process.env.PAIRING_NUMBER || '').replace(/\D/g, ''); // npr. 38641123456
// Kdo dobi odgovore: seznam številk (brez +), ločenih z vejico. Prazno = vsi zasebni pogovori.
const ALLOWED = (process.env.ALLOWED_NUMBERS || '')
  .split(',')
  .map((n) => n.replace(/\D/g, ''))
  .filter(Boolean);
// Komu odgovarja po imenu (WhatsApp profilno ime sogovornika), ločeno z vejico, ne razlikuje velikih črk.
const ALLOWED_NAMES = (process.env.ALLOWED_NAMES || '')
  .split(',')
  .map((n) => n.trim().toLowerCase())
  .filter(Boolean);
const MAX_HISTORY =Number(process.env.MAX_HISTORY || 30);
const DEBOUNCE_MS = Number(process.env.DEBOUNCE_MS || 6000); // počakaj, če oseba pošlje več sporočil zapored
const AI_DISCLOSURE = (process.env.AI_DISCLOSURE || 'true') === 'true';
const DISCLOSURE_TEXT =
  process.env.DISCLOSURE_TEXT ||
  '🤖 (Samodejni odgovor – trenutno odgovarja AI asistent.)';
const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  `Si prijazen asistent, ki odgovarja na WhatsApp sporočila v imenu lastnika telefona.
Piši kratko in naravno, kot v klepetu (1–3 stavki), v jeziku, v katerem piše sogovornik.
Ne izmišljuj si dogovorov, terminov ali obljub v imenu lastnika – če nekaj zahteva njegovo odločitev,
povej, da mu boš sporočilo predal in se bo oglasil sam.`;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Manjka ANTHROPIC_API_KEY v .env');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });

// ---------- Zgodovina pogovorov (shranjena na disk) ----------
fs.mkdirSync(AUTH_DIR, { recursive: true });
let history = {};
try {
  history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
} catch {
  history = {};
}
const disclosed = new Set(Object.keys(history).filter((k) => history[k]?.__disclosed));

function saveHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history));
  } catch (e) {
    console.error('Napaka pri shranjevanju zgodovine:', e.message);
  }
}

function pushMsg(jid, role, text) {
  const h = (history[jid] ||= { msgs: [] });
  const last = h.msgs[h.msgs.length - 1];
  // Claude zahteva izmenične vloge -> zaporedna sporočila iste vloge združimo
  if (last && last.role === role) last.content += '\n' + text;
  else h.msgs.push({ role, content: text });
  if (h.msgs.length > MAX_HISTORY) h.msgs = h.msgs.slice(-MAX_HISTORY);
  while (h.msgs.length && h.msgs[0].role !== 'user') h.msgs.shift();
  saveHistory();
}

// ---------- Pomožne funkcije ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function digitsOf(jid = '') {
  return jid.split('@')[0].split(':')[0].replace(/\D/g, '');
}

function isAllowed(jid, altJid, pushName) {
  if (!ALLOWED.length && !ALLOWED_NAMES.length) return true;
  if ([jid, altJid].filter(Boolean).some((j) => ALLOWED.includes(digitsOf(j)))) return true;
  // Pogovor, ki je bil že enkrat prepoznan po imenu, ostane dovoljen (tudi če oseba zamenja ime)
  if (history[jid]?.__nameMatch) return true;
  if (pushName && ALLOWED_NAMES.includes(pushName.trim().toLowerCase())) {
    (history[jid] ||= { msgs: [] }).__nameMatch = true;
    console.log(`✅ Prepoznan po imenu "${pushName}" -> ${jid}${altJid ? ' / ' + altJid : ''}`);
    return true;
  }
  return false;
}

function extractText(message) {
  if (!message) return null;
  const m = message.ephemeralMessage?.message || message.viewOnceMessage?.message || message;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    (m.audioMessage ? '[poslal glasovno sporočilo]' : null) ||
    (m.imageMessage ? '[poslal sliko]' : null) ||
    (m.stickerMessage ? '[poslal nalepko]' : null) ||
    null
  );
}

async function askClaude(jid) {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: history[jid].msgs,
  });
  return res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

// ---------- WhatsApp ----------
const timers = new Map();
let sock;

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: ['Claude Bot', 'Chrome', '1.0'],
    markOnlineOnConnect: false, // da telefon še vedno dobi obvestila
  });

  sock.ev.on('creds.update', saveCreds);

  // Povezava s kodo namesto QR (priročno na Railwayu)
  if (PAIRING_NUMBER && !sock.authState.creds.registered) {
    await sleep(3000);
    try {
      const code = await sock.requestPairingCode(PAIRING_NUMBER);
      console.log(`\n>>> KODA ZA POVEZAVO: ${code}`);
      console.log('Na telefonu: WhatsApp > Povezane naprave > Poveži napravo > Poveži s telefonsko številko\n');
    } catch (e) {
      console.error('Ne morem pridobiti kode za povezavo:', e.message);
    }
  }

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr && !PAIRING_NUMBER) {
      console.log('\nSkeniraj QR kodo: WhatsApp > Povezane naprave > Poveži napravo\n');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      console.log('✅ Povezan na WhatsApp. Bot posluša.');
      const who = [...ALLOWED, ...ALLOWED_NAMES];
      console.log(who.length ? `Odgovarjam samo: ${who.join(', ')}` : 'Odgovarjam vsem zasebnim pogovorom.');
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.error('❌ Odjavljen. Izbriši mapo auth in se poveži znova.');
        process.exit(1);
      }
      console.log('Povezava prekinjena, ponovno povezujem ...', code ?? '');
      setTimeout(start, 3000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      const jid = msg.key.remoteJid;
      if (!jid || msg.key.fromMe) continue;
      if (jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@newsletter')) continue;

      const altJid = msg.key.senderPn || msg.key.remoteJidAlt || msg.key.participantPn;
      const text = extractText(msg.message);
      console.log(`📩 ${msg.pushName || ''} [${jid}${altJid ? ' / ' + altJid : ''}]: ${text ?? '(brez besedila)'}`);

      if (!text || !isAllowed(jid, altJid, msg.pushName)) continue;

      pushMsg(jid, 'user', text);

      // Debounce: počakaj, da oseba konča s pisanjem, potem odgovori enkrat
      clearTimeout(timers.get(jid));
      timers.set(
        jid,
        setTimeout(() => reply(jid, msg).catch((e) => console.error('Napaka pri odgovoru:', e.message)), DEBOUNCE_MS)
      );
    }
  });
}

async function reply(jid, lastMsg) {
  timers.delete(jid);
  await sock.readMessages([lastMsg.key]);
  await sock.sendPresenceUpdate('composing', jid);

  let answer;
  try {
    answer = await askClaude(jid);
  } catch (e) {
    console.error('Claude API napaka:', e.message);
    await sock.sendPresenceUpdate('paused', jid);
    return;
  }
  if (!answer) return;

  // Naraven zamik "tipkanja" (max 8 s)
  await sleep(Math.min(8000, 1000 + answer.length * 40));
  await sock.sendPresenceUpdate('paused', jid);

  let out = answer;
  if (AI_DISCLOSURE && !disclosed.has(jid)) {
    out = `${DISCLOSURE_TEXT}\n\n${answer}`;
    disclosed.add(jid);
    history[jid].__disclosed = true;
  }

  await sock.sendMessage(jid, { text: out });
  pushMsg(jid, 'assistant', answer);
  console.log(`🤖 -> ${jid}: ${answer}`);
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
