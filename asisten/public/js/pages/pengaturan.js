/**
 * Halaman Pengaturan Sistem.
 * Sesuai prd.md §14.
 */

import { api } from '../api.js';
import { escapeHtml } from '../utils/format.js';
import { showToast } from '../state.js';

export async function renderPengaturan(container) {
  const settingsRes = await api.get('/api/settings').catch(() => ({ data: { settings: {} } }));
  const settings = settingsRes.data?.settings || {};

  container.innerHTML = `
    <div class="space-y-6 max-w-4xl">
      <div>
        <h1 class="text-2xl font-bold text-white tracking-tight">Pengaturan Sistem</h1>
        <p class="text-sm text-slate-400 mt-0.5">Konfigurasi preferensi asisten, ambang batas, dan jadwal</p>
      </div>

      <div class="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <form id="settings-form" class="space-y-6 text-xs">
          <!-- Zona Waktu -->
          <div>
            <label class="block text-slate-300 font-semibold mb-1">Zona Waktu (Timezone)</label>
            <input
              type="text"
              id="set-timezone"
              value="${escapeHtml(settings.timezone || 'Asia/Jakarta')}"
              class="w-full max-w-md px-3.5 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white"
            />
            <p class="text-[11px] text-slate-500 mt-1">Zona waktu default untuk waktu transaksi dan agenda.</p>
          </div>

          <!-- Jam Briefing Pagi -->
          <div>
            <label class="block text-slate-300 font-semibold mb-1">Jam Briefing Pagi</label>
            <input
              type="text"
              id="set-briefing-hour"
              placeholder="07:00"
              value="${escapeHtml(settings.briefing_morning_time || '07:00')}"
              class="w-full max-w-md px-3.5 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white"
            />
            <p class="text-[11px] text-slate-500 mt-1">Format HH:mm (WIB). Waktu bot mengirimkan ringkasan pagi.</p>
          </div>

          <!-- Ambang Konfirmasi Transaksi Besar -->
          <div>
            <label class="block text-slate-300 font-semibold mb-1">Ambang Konfirmasi Transaksi Besar (Rp)</label>
            <input
              type="number"
              id="set-large-threshold"
              min="0"
              placeholder="1000000"
              value="${settings.large_tx_threshold || 1000000}"
              class="w-full max-w-md px-3.5 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white font-mono"
            />
            <p class="text-[11px] text-slate-500 mt-1">Transaksi di atas nominal ini akan meminta konfirmasi ya/tidak.</p>
          </div>

          <!-- Ambang Peringatan Kantong Menipis -->
          <div>
            <label class="block text-slate-300 font-semibold mb-1">Ambang Peringatan Kantong Menipis (%)</label>
            <input
              type="number"
              id="set-pocket-alert"
              min="1"
              max="100"
              placeholder="20"
              value="${settings.pocket_low_threshold_percent || 20}"
              class="w-full max-w-md px-3.5 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white font-mono"
            />
            <p class="text-[11px] text-slate-500 mt-1">Kirim peringatan ke WhatsApp jika sisa saldo kantong di bawah persentase ini.</p>
          </div>

          <!-- Default Rollover Mode -->
          <div>
            <label class="block text-slate-300 font-semibold mb-1">Default Rollover Mode untuk Kantong Baru</label>
            <select id="set-default-rollover" class="w-full max-w-md px-3.5 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white">
              <option value="carry" ${settings.default_rollover_mode === 'carry' ? 'selected' : ''}>Carry (bawa sisa saldo ke bulan berikutnya)</option>
              <option value="return" ${settings.default_rollover_mode === 'return' ? 'selected' : ''}>Return (kembalikan ke saldo utama)</option>
            </select>
          </div>

          <div class="pt-4 border-t border-slate-800 flex items-center justify-end">
            <button
              type="submit"
              class="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-lg shadow-emerald-900/30"
            >
              Simpan Pengaturan
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  container.querySelector('#settings-form').onsubmit = async (e) => {
    e.preventDefault();
    const timezone = container.querySelector('#set-timezone').value.trim();
    const briefingTime = container.querySelector('#set-briefing-hour').value.trim();
    const largeThreshold = Number(container.querySelector('#set-large-threshold').value);
    const pocketAlert = Number(container.querySelector('#set-pocket-alert').value);
    const defaultRollover = container.querySelector('#set-default-rollover').value;

    try {
      await api.put('/api/settings', {
        timezone,
        briefing_morning_time: briefingTime,
        large_tx_threshold: largeThreshold,
        pocket_low_threshold_percent: pocketAlert,
        default_rollover_mode: defaultRollover,
      });
      showToast('Pengaturan sistem berhasil disimpan.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };
}
