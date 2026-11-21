/**
 * Halaman Audit Log & AI Usage.
 * Sesuai prd.md §14.
 */

import { api } from '../api.js';
import { formatDateWib, escapeHtml } from '../utils/format.js';

export async function renderLog(container) {
  const [logRes, aiRes] = await Promise.all([
    api.get('/api/action-log?limit=50').catch(() => ({ data: [] })),
    api.get('/api/ai-usage?days=7').catch(() => ({ data: {} })),
  ]);

  const logs = logRes.data || [];
  const aiData = aiRes.data || {};
  const summary = aiData.summary || {};
  const aiLogs = aiData.logs || [];

  container.innerHTML = `
    <div class="space-y-6">
      <div>
        <h1 class="text-2xl font-bold text-white tracking-tight">Log & Audit Sistem</h1>
        <p class="text-sm text-slate-400 mt-0.5">Riwayat audit aksi dan metrik penggunaan model AI</p>
      </div>

      <!-- AI Usage Metrics Card -->
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 class="text-base font-semibold text-white mb-4">Penggunaan AI (7 Hari Terakhir)</h2>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div class="bg-slate-800/40 p-4 rounded-lg">
            <div class="text-xs text-slate-400">Total Permintaan</div>
            <div class="text-xl font-bold text-white mt-1">${summary.total_requests || 0}</div>
          </div>
          <div class="bg-slate-800/40 p-4 rounded-lg">
            <div class="text-xs text-slate-400">Total Token Masuk</div>
            <div class="text-xl font-bold text-emerald-400 mt-1">${Number(summary.total_tokens_in || 0).toLocaleString('id-ID')}</div>
          </div>
          <div class="bg-slate-800/40 p-4 rounded-lg">
            <div class="text-xs text-slate-400">Total Token Keluar</div>
            <div class="text-xl font-bold text-blue-400 mt-1">${Number(summary.total_tokens_out || 0).toLocaleString('id-ID')}</div>
          </div>
          <div class="bg-slate-800/40 p-4 rounded-lg">
            <div class="text-xs text-slate-400">Rata-rata Latensi</div>
            <div class="text-xl font-bold text-slate-200 mt-1">${summary.avg_latency_ms || 0} ms</div>
          </div>
        </div>
      </div>

      <!-- Action Log Table -->
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 class="text-base font-semibold text-white mb-4">Log Aksi Pengguna & Bot (50 Terakhir)</h2>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs border-collapse">
            <thead>
              <tr class="border-b border-slate-800 text-slate-400 uppercase font-semibold">
                <th class="p-3">Waktu</th>
                <th class="p-3">Entitas</th>
                <th class="p-3">Aksi</th>
                <th class="p-3">Rincian Data</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-800/60 font-mono">
              ${logs.length === 0 ? `
                <tr><td colspan="4" class="p-6 text-center text-slate-500 font-sans">Belum ada riwayat aksi.</td></tr>
              ` : logs.map((l) => `
                <tr class="hover:bg-slate-800/20">
                  <td class="p-3 text-slate-400 whitespace-nowrap font-sans">${formatDateWib(l.created_at, true)}</td>
                  <td class="p-3 text-emerald-400 font-semibold">${escapeHtml(l.entity)} #${l.entity_id}</td>
                  <td class="p-3">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      l.action === 'delete' ? 'bg-rose-500/10 text-rose-400' : l.action === 'create' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-blue-500/10 text-blue-400'
                    }">${escapeHtml(l.action)}</span>
                  </td>
                  <td class="p-3 text-slate-300 max-w-md truncate" title="${escapeHtml(JSON.stringify(l.after_data || l.before_data))}">
                    ${escapeHtml(JSON.stringify(l.after_data || l.before_data))}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}
