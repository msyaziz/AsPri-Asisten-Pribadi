/**
 * Halaman Beranda / Ringkasan.
 * Sesuai prd.md §14.
 */

import { api } from '../api.js';
import { formatRupiah, formatDateWib, escapeHtml } from '../utils/format.js';

export async function renderBeranda(container) {
  const [summaryRes, pocketsRes, eventsRes, botRes] = await Promise.all([
    api.get('/api/summary').catch(() => ({ ok: false, data: {} })),
    api.get('/api/pockets').catch(() => ({ ok: false, data: [] })),
    api.get('/api/events').catch(() => ({ ok: false, data: [] })),
    api.get('/api/bot/status').catch(() => ({ ok: false, data: {} })),
  ]);

  const summary = summaryRes.data || {};
  const pockets = pocketsRes.data || [];
  const allEvents = eventsRes.data || [];
  const bot = botRes.data || {};

  // Filter agenda 7 hari ke depan
  const now = new Date();
  const next7Days = new Date(now.getTime() + 7 * 86400000);
  const upcomingEvents = allEvents.filter((e) => {
    const d = new Date(e.starts_at);
    return d >= new Date(now.setHours(0, 0, 0, 0)) && d <= next7Days;
  }).slice(0, 5);

  const botBadge = bot.state === 'connected'
    ? '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>Terhubung</span>'
    : '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20"><span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>' + (bot.state || 'Offline') + '</span>';

  container.innerHTML = `
    <div class="space-y-6">
      <!-- Header Ringkasan -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-white tracking-tight">Ringkasan Keuangan</h1>
          <p class="text-sm text-slate-400 mt-0.5">Periode berjalan: <span class="font-medium text-slate-200">${escapeHtml(summary.period?.year || '-')}-${String(summary.period?.month || '').padStart(2, '0')}</span></p>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-xs text-slate-400">Status Bot:</span>
          ${botBadge}
        </div>
      </div>

      <!-- Kartu Metrik Utama -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-sm">
          <div class="text-xs font-medium text-slate-400">Saldo Utama</div>
          <div class="text-xl font-bold text-emerald-400 mt-2">${formatRupiah(summary.mainBalance || 0)}</div>
          <div class="text-xs text-slate-500 mt-1">Siap dialokasikan / belanja umum</div>
        </div>

        <div class="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-sm">
          <div class="text-xs font-medium text-slate-400">Total Semua Dana</div>
          <div class="text-xl font-bold text-white mt-2">${formatRupiah(summary.grandTotal || 0)}</div>
          <div class="text-xs text-slate-500 mt-1">Saldo utama + seluruh kantong</div>
        </div>

        <div class="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-sm">
          <div class="text-xs font-medium text-slate-400">Total Pemasukan</div>
          <div class="text-xl font-bold text-blue-400 mt-2">${formatRupiah(summary.totalIncome || 0)}</div>
          <div class="text-xs text-slate-500 mt-1">Bulan berjalan</div>
        </div>

        <div class="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-sm">
          <div class="text-xs font-medium text-slate-400">Total Pengeluaran</div>
          <div class="text-xl font-bold text-rose-400 mt-2">${formatRupiah(summary.totalExpense || 0)}</div>
          <div class="text-xs text-slate-500 mt-1">Bulan berjalan</div>
        </div>
      </div>

      <!-- Saldo Kantong & Agenda Terdekat -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Daftar Kantong -->
        <div class="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-base font-semibold text-white">Kantong Anggaran</h2>
            <a href="#/kantong" class="text-xs text-emerald-400 hover:text-emerald-300 font-medium">Lihat Semua &rarr;</a>
          </div>
          ${pockets.length === 0 ? '<p class="text-sm text-slate-500 py-4">Belum ada kantong anggaran.</p>' : `
            <div class="divide-y divide-slate-800">
              ${pockets.map((p) => `
                <div class="py-3 flex items-center justify-between">
                  <div>
                    <div class="text-sm font-medium text-white">${escapeHtml(p.pocketName || p.name)}</div>
                    <div class="text-xs text-slate-500 capitalize">Rollover: ${escapeHtml(p.rolloverMode || 'carry')}</div>
                  </div>
                  <div class="text-sm font-semibold text-slate-200">
                    ${formatRupiah(p.balance || 0)}
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>

        <!-- Agenda Terdekat (7 Hari) -->
        <div class="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-base font-semibold text-white">Agenda Terdekat (7 Hari)</h2>
            <a href="#/kalender" class="text-xs text-emerald-400 hover:text-emerald-300 font-medium">Kalender &rarr;</a>
          </div>
          ${upcomingEvents.length === 0 ? '<p class="text-sm text-slate-500 py-4">Tidak ada jadwal dalam 7 hari ke depan.</p>' : `
            <div class="divide-y divide-slate-800">
              ${upcomingEvents.map((e) => `
                <div class="py-3 flex items-center justify-between gap-3">
                  <div>
                    <div class="text-sm font-medium text-white flex items-center gap-2">
                      <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${e.kind === 'task' ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'}">${e.kind}</span>
                      <span>${escapeHtml(e.title)}</span>
                    </div>
                    <div class="text-xs text-slate-500 mt-0.5">${formatDateWib(e.starts_at, true)}</div>
                  </div>
                  <div>
                    <span class="text-xs px-2 py-0.5 rounded-full ${e.status === 'done' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-400'}">${e.status}</span>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    </div>
  `;
}
