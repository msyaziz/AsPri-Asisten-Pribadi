/**
 * Halaman Status Bot & Pairing WhatsApp.
 * Sesuai prd.md §14.
 */

import { api } from '../api.js';
import { formatDateWib, escapeHtml } from '../utils/format.js';
import { showToast } from '../state.js';

export async function renderBot(container) {
  const [statusRes, pendingRes] = await Promise.all([
    api.get('/api/bot/status'),
    api.get('/api/pending').catch(() => ({ data: [] })),
  ]);

  const bot = statusRes.data || {};
  const pending = pendingRes.data || [];

  let qrData = null;
  if (bot.state === 'qr_ready') {
    try {
      const qrRes = await api.get('/api/bot/qr');
      qrData = qrRes.data;
    } catch {}
  }

  container.innerHTML = `
    <div class="space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-white tracking-tight">Status Bot WhatsApp</h1>
          <p class="text-sm text-slate-400 mt-0.5">Pantau status koneksi Baileys dan kelola pairing WhatsApp</p>
        </div>
        <button
          id="restart-bot-btn"
          class="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold flex items-center gap-2 border border-slate-700 transition-colors"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
          <span>Restart Koneksi Bot</span>
        </button>
      </div>

      <!-- Kartu Status -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="bg-slate-900 border border-slate-800 p-5 rounded-xl">
          <div class="text-xs font-medium text-slate-400">Status Koneksi</div>
          <div class="text-lg font-bold text-white mt-2 flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full ${bot.state === 'connected' ? 'bg-emerald-400' : 'bg-amber-400'}"></span>
            <span class="capitalize">${escapeHtml(bot.state || 'disconnected')}</span>
          </div>
          <div class="text-xs text-slate-500 mt-1">
            ${bot.since ? `Terhubung sejak: ${formatDateWib(bot.since, true)}` : 'Belum terhubung'}
          </div>
        </div>

        <div class="bg-slate-900 border border-slate-800 p-5 rounded-xl">
          <div class="text-xs font-medium text-slate-400">Pesan Ditolak (Dropped)</div>
          <div class="text-lg font-bold text-slate-200 mt-2">${bot.droppedCount || 0}</div>
          <div class="text-xs text-slate-500 mt-1">Pesan dari non-whitelist / grup</div>
        </div>

        <div class="bg-slate-900 border border-slate-800 p-5 rounded-xl">
          <div class="text-xs font-medium text-slate-400">Konfirmasi Menunggu (Pending)</div>
          <div class="text-lg font-bold text-amber-400 mt-2">${pending.length}</div>
          <div class="text-xs text-slate-500 mt-1">Aksi sensitif butuh ya/tidak</div>
        </div>
      </div>

      <!-- Area Pairing QR (hanya jika qr_ready) -->
      ${qrData ? `
        <div class="bg-slate-900 border border-amber-500/30 rounded-xl p-6 text-center">
          <div class="max-w-xs mx-auto">
            <h3 class="text-base font-bold text-white mb-2">Scan QR WhatsApp</h3>
            <p class="text-xs text-slate-400 mb-4">Buka WhatsApp di HP nomor bot &gt; Perangkat Tertaut &gt; Tautkan Perangkat</p>
            <div class="bg-white p-4 rounded-xl shadow-inner inline-block">
              ${qrData.svg || ''}
            </div>
            <p class="text-[11px] text-slate-500 mt-3">QR otomatis diperbarui saat ada sesi baru.</p>
          </div>
        </div>
      ` : bot.state === 'connected' ? `
        <div class="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center text-slate-400 text-xs">
          <div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-400 mb-2">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
          </div>
          <p class="text-sm font-semibold text-white">Bot Aktif & Terhubung</p>
          <p class="mt-0.5">Sesi WhatsApp aman. Tidak ada pairing yang diperlukan saat ini.</p>
        </div>
      ` : ''}

      <!-- Antrean Pending Actions -->
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 class="text-base font-semibold text-white mb-4">Antrean Konfirmasi Pengguna (${pending.length})</h2>
        ${pending.length === 0 ? '<p class="text-sm text-slate-500 py-6 text-center">Tidak ada aksi menunggu konfirmasi.</p>' : `
          <div class="divide-y divide-slate-800">
            ${pending.map((p) => `
              <div class="py-3 flex items-center justify-between">
                <div>
                  <div class="text-sm font-medium text-white flex items-center gap-2">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/20 text-amber-400">${escapeHtml(p.type)}</span>
                    <span class="text-slate-300 font-mono text-xs">${escapeHtml(JSON.stringify(p.payload))}</span>
                  </div>
                  <div class="text-xs text-slate-500 mt-1">Kedaluwarsa: ${formatDateWib(p.expires_at, true)}</div>
                </div>
                <span class="text-xs px-2 py-1 rounded bg-slate-800 text-amber-400 font-semibold">${escapeHtml(p.status)}</span>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    </div>
  `;

  container.querySelector('#restart-bot-btn').onclick = async () => {
    try {
      await api.post('/api/bot/restart');
      showToast('Perintah restart bot telah dikirim.', 'info');
      setTimeout(() => renderBot(container), 2000);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };
}
