import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode-terminal/vendor/QRCode/index.js';
import env from '../config/env.js';
import { logger, baileysLogger } from '../utils/logger.js';
import { pool } from '../db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authDir = path.resolve(env.DATA_DIR, 'auth_info');
const publicDir = path.resolve(__dirname, '../../public');

let sock = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let isStopping = false;
let messageHandler = null;

const status = {
  state: 'disconnected', // 'disconnected' | 'connecting' | 'qr_ready' | 'connected' | 'logged_out'
  since: null,
  lastQrAt: null,
  rawQr: null,
  droppedCount: 0,
};

/**
 * Membuat SVG QR Code yang tajam tanpa dependensi eksternal.
 * @param {string} text
 * @param {number} [border=4]
 * @returns {string}
 */
function generateQrSvg(text, border = 4) {
  const qr = new QRCode(-1, 1);
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const size = count + border * 2;
  let paths = '';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        paths += `M${c + border},${r + border}h1v1h-1z `;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#ffffff"/><path d="${paths}" fill="#000000"/></svg>`;
}

/**
 * Menyimpan QR Code dalam format SVG dan HTML agar mudah dibuka & discan di browser.
 * @param {string} qrString
 */
async function saveQrArtifacts(qrString) {
  try {
    const svg = generateQrSvg(qrString);
    const html = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="20">
  <title>Scan WhatsApp QR</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0b141a; color: #e9edef; }
    .card { background: #111b21; padding: 2.5rem 2rem; border-radius: 16px; text-align: center; max-width: 440px; box-shadow: 0 8px 30px rgba(0,0,0,0.6); }
    .qr-box { background: white; padding: 20px; border-radius: 12px; margin: 1.5rem auto; display: inline-block; line-height: 0; }
    svg { width: 320px; height: 320px; display: block; }
    h2 { margin: 0 0 0.5rem; color: #25d366; font-size: 1.5rem; }
    p { color: #8696a0; font-size: 0.95rem; line-height: 1.5; margin: 0.5rem 0; }
    .badge { display: inline-block; background: #202c33; color: #00a884; padding: 4px 10px; border-radius: 999px; font-size: 0.8rem; margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Scan WhatsApp QR</h2>
    <p>Buka WhatsApp di HP nomor cadangan &gt; <b>Perangkat Tertaut</b> &gt; <b>Tautkan Perangkat</b>, lalu scan kode di bawah:</p>
    <div class="qr-box">
      ${svg}
    </div>
    <p>Halaman ini otomatis merefresh saat ada QR baru.</p>
    <div class="badge">AsPri — Fase 1</div>
  </div>
</body>
</html>`;

    await fs.writeFile(path.resolve(env.DATA_DIR, 'qr.svg'), svg, 'utf-8');
    await fs.writeFile(path.resolve(publicDir, 'qr.svg'), svg, 'utf-8');
    await fs.writeFile(path.resolve(publicDir, 'qr.html'), html, 'utf-8');
    await fs.writeFile(path.resolve(env.DATA_DIR, 'qr_raw.txt'), qrString, 'utf-8');
    logger.info('QR Code telah disimpan ke public/qr.html dan public/qr.svg');
  } catch (err) {
    logger.warn({ err: err.message }, 'Gagal menyimpan berkas QR SVG/HTML');
  }
}

/**
 * Membersihkan berkas QR setelah berhasil terhubung.
 */
async function cleanQrArtifacts() {
  const files = [
    path.resolve(env.DATA_DIR, 'qr.svg'),
    path.resolve(publicDir, 'qr.svg'),
    path.resolve(publicDir, 'qr.html'),
    path.resolve(env.DATA_DIR, 'qr_raw.txt'),
  ];
  for (const f of files) {
    try {
      await fs.unlink(f);
    } catch {}
  }
}

/**
 * Mendaftarkan callback untuk menangani pesan masuk (messages.upsert).
 * @param {(upsert: any) => Promise<void>} handler
 */
export function registerMessageHandler(handler) {
  messageHandler = handler;
}

/**
 * Mengambil status koneksi bot saat ini.
 * @returns {{ state: string, since: string|null, lastQrAt: string|null, droppedCount: number }}
 */
export function getStatus() {
  return { ...status };
}

/**
 * Menambah hitungan pesan yang dibuang (dropped).
 */
export function incrementDroppedCount() {
  status.droppedCount++;
}

/**
 * Mengambil instance socket Baileys yang sedang aktif.
 * @returns {any}
 */
export function getSocket() {
  return sock;
}

/**
 * Mencatat event bot ke database (tabel bot_events).
 * @param {string} type
 * @param {string|null} [detail=null]
 */
async function logBotEvent(type, detail = null) {
  try {
    await pool.query('INSERT INTO bot_events (type, detail) VALUES ($1, $2)', [type, detail]);
  } catch (err) {
    logger.warn({ err: err.message, type }, 'Gagal mencatat bot_event ke database');
  }
}

/**
 * Memulai koneksi Baileys WhatsApp.
 */
export async function startBot() {
  if (sock) {
    logger.warn('Socket sudah ada, batalkan inisialisasi ganda');
    return sock;
  }

  isStopping = false;
  status.state = 'connecting';
  logger.info('Menginisialisasi koneksi WhatsApp (Baileys)...');

  await fs.mkdir(authDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
    },
    logger: baileysLogger,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    printQRInTerminal: false,
  });

  // Jika BOT_PHONE_NUMBER diisi dan belum terdaftar, minta Pairing Code 8 digit (tanpa kamera)
  if (!state.creds.registered && env.BOT_PHONE_NUMBER) {
    const cleanPhone = env.BOT_PHONE_NUMBER.replace(/\D/g, '').replace(/^0/, '62');
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(cleanPhone);
        console.log('\n======================================================');
        console.log('📱 KODE TAUTKAN WHATSAPP (8 DIGIT):');
        console.log(`\n           👉  ${code}  👈\n`);
        console.log('Cara masukkan di HP nomor cadangan:');
        console.log('1. Buka WhatsApp > Perangkat Tertaut > Tautkan Perangkat');
        console.log('2. Di bagian bawah layar scan kamera, klik:');
        console.log('   "Tautkan dengan nomor telepon saja" (Link with phone number)');
        console.log(`3. Masukkan kode: ${code}`);
        console.log('======================================================\n');
      } catch (err) {
        logger.error({ err: err.message }, 'Gagal meminta pairing code dari WhatsApp');
      }
    }, 3000);
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      status.state = 'qr_ready';
      status.lastQrAt = new Date().toISOString();
      status.rawQr = qr;
      await logBotEvent('qr');

      if (!env.BOT_PHONE_NUMBER) {
        logger.info('QR Code diterima. Silakan scan dengan WhatsApp cadangan di terminal:');
        qrcode.generate(qr, { small: true });
      }
      await saveQrArtifacts(qr);
    }

    if (connection === 'open') {
      reconnectAttempts = 0;
      status.state = 'connected';
      status.since = new Date().toISOString();
      status.rawQr = null;
      await cleanQrArtifacts();
      await logBotEvent('connected');
      logger.info('WhatsApp Bot BERHASIL TERHUBUNG (open)');
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;

      sock = null;

      if (isStopping) {
        status.state = 'disconnected';
        return;
      }

      if (isLoggedOut) {
        status.state = 'logged_out';
        await logBotEvent('logged_out', 'StatusCode: 401');
        logger.error(
          '❌ Sesi WhatsApp terputus (loggedOut / 401). Scan QR ulang diperlukan. Hapus folder data/auth_info bila perlu.'
        );
        return;
      }

      const isRestartRequired = statusCode === DisconnectReason.restartRequired;
      if (isRestartRequired) {
        logger.info('Restart required oleh Baileys, langsung menghubungkan ulang...');
        startBot().catch((err) => logger.error({ err }, 'Gagal restart Baileys'));
        return;
      }

      // Reconnect exponential backoff: 2s, 4s, 8s, ... maks 60s
      reconnectAttempts++;
      const delay = Math.min(60000, 2000 * Math.pow(2, reconnectAttempts - 1));
      status.state = 'disconnected';
      await logBotEvent('disconnected', `StatusCode: ${statusCode || 'unknown'}, retry in ${delay}ms`);
      logger.warn(
        { statusCode, reconnectAttempts, delayMs: delay },
        `Koneksi WhatsApp terputus. Mencoba menghubungkan ulang dalam ${delay / 1000} detik...`
      );

      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        startBot().catch((err) => logger.error({ err }, 'Gagal reconnect Baileys'));
      }, delay);
    }
  });

  sock.ev.on('messages.upsert', async (upsert) => {
    if (typeof messageHandler === 'function') {
      try {
        await messageHandler(upsert);
      } catch (err) {
        logger.error({ err: err.message }, 'Error pada messageHandler');
      }
    }
  });

  return sock;
}

/**
 * Menghentikan koneksi Baileys secara aman.
 */
export async function stopBot() {
  isStopping = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (sock) {
    try {
      sock.end(undefined);
    } catch (err) {
      logger.warn({ err: err.message }, 'Error saat menutup socket Baileys');
    }
    sock = null;
  }
  status.state = 'disconnected';
  logger.info('WhatsApp socket ditutup.');
}
