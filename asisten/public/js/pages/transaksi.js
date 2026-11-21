/**
 * Halaman Riwayat Transaksi.
 * Sesuai prd.md §14.
 */

import { api } from '../api.js';
import { formatRupiah, formatDateWib, escapeHtml } from '../utils/format.js';
import { showToast } from '../state.js';

export async function renderTransaksi(container, params) {
  let page = Number(params.get('page')) || 1;
  const limit = 50;
  const q = params.get('q') || '';
  const type = params.get('type') || '';
  const deleted = params.get('deleted') === 'true';
  const aiOnly = params.get('ai_only') === 'true';

  const [txRes, pocketsRes, categoriesRes] = await Promise.all([
    api.get(`/api/transactions?limit=${limit}&offset=${(page - 1) * limit}&q=${encodeURIComponent(q)}&type=${type}&deleted=${deleted}&ai_only=${aiOnly}`),
    api.get('/api/pockets').catch(() => ({ data: [] })),
    api.get('/api/categories').catch(() => ({ data: [] })),
  ]);

  const transactions = txRes.data?.transactions || (Array.isArray(txRes.data) ? txRes.data : []);
  const total = txRes.data?.total || transactions.length;
  const pockets = pocketsRes.data || [];
  const categories = categoriesRes.data || [];

  container.innerHTML = `
    <div class="space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-white tracking-tight">Transaksi</h1>
          <p class="text-sm text-slate-400 mt-0.5">Kelola dan pantau seluruh transaksi keuangan</p>
        </div>
        <div class="flex items-center gap-2">
          <a
            href="/api/export/transactions.csv"
            class="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-2 border border-slate-700 transition-colors"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
            <span>Ekspor CSV</span>
          </a>
          <button
            id="open-add-modal"
            class="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-2 shadow-lg shadow-emerald-900/30 transition-colors"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
            <span>Tambah Transaksi</span>
          </button>
        </div>
      </div>

      <!-- Filter Bar -->
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center gap-3 text-xs">
        <input
          type="text"
          id="filter-q"
          placeholder="Cari catatan / keterangan..."
          value="${escapeHtml(q)}"
          class="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 flex-1 min-w-[180px]"
        />
        <select id="filter-type" class="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white focus:outline-none">
          <option value="">Semua Tipe</option>
          <option value="keluar" ${type === 'keluar' ? 'selected' : ''}>Pengeluaran</option>
          <option value="masuk" ${type === 'masuk' ? 'selected' : ''}>Pemasukan</option>
        </select>
        <label class="flex items-center gap-2 text-slate-300 cursor-pointer">
          <input type="checkbox" id="filter-ai" ${aiOnly ? 'checked' : ''} class="rounded bg-slate-800 border-slate-700 text-emerald-500 focus:ring-0" />
          <span>Hanya AI</span>
        </label>
        <label class="flex items-center gap-2 text-slate-300 cursor-pointer">
          <input type="checkbox" id="filter-deleted" ${deleted ? 'checked' : ''} class="rounded bg-slate-800 border-slate-700 text-emerald-500 focus:ring-0" />
          <span>Sampah (Deleted)</span>
        </label>
        <button id="apply-filter" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-medium">Terapkan</button>
      </div>

      <!-- Tabel Transaksi -->
      <div class="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-xs">
            <thead>
              <tr class="border-b border-slate-800 bg-slate-950/40 text-slate-400 uppercase font-semibold">
                <th class="p-3.5">Tanggal</th>
                <th class="p-3.5">Catatan</th>
                <th class="p-3.5">Kategori</th>
                <th class="p-3.5">Kantong</th>
                <th class="p-3.5 text-right">Nominal</th>
                <th class="p-3.5 text-center">Sumber</th>
                <th class="p-3.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-800/60">
              ${transactions.length === 0 ? `
                <tr>
                  <td colspan="7" class="p-8 text-center text-slate-500">Tidak ada transaksi ditemukan.</td>
                </tr>
              ` : transactions.map((t) => `
                <tr class="hover:bg-slate-800/30 transition-colors ${t.deleted_at ? 'opacity-50' : ''}">
                  <td class="p-3.5 text-slate-400 whitespace-nowrap">${formatDateWib(t.tx_date)}</td>
                  <td class="p-3.5 font-medium text-white max-w-xs truncate">${escapeHtml(t.note || '-')}</td>
                  <td class="p-3.5 text-slate-300">${escapeHtml(t.category_name || '-')}</td>
                  <td class="p-3.5 text-slate-400">${escapeHtml(t.pocket_name || 'Saldo Utama')}</td>
                  <td class="p-3.5 text-right font-semibold whitespace-nowrap ${t.type === 'masuk' ? 'text-emerald-400' : 'text-slate-200'}">
                    ${t.type === 'masuk' ? '+' : '-'}${formatRupiah(t.amount)}
                  </td>
                  <td class="p-3.5 text-center">
                    <span class="px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                      t.source === 'ai' || t.ai_confidence ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-800 text-slate-400'
                    }">
                      ${t.ai_confidence ? 'AI (' + Math.round(t.ai_confidence * 100) + '%)' : t.source || 'manual'}
                    </span>
                  </td>
                  <td class="p-3.5 text-right whitespace-nowrap">
                    ${t.deleted_at ? `
                      <button data-restore-id="${t.id}" class="text-emerald-400 hover:text-emerald-300 font-medium">Pulihkan</button>
                    ` : `
                      <button data-edit-id="${t.id}" class="text-slate-400 hover:text-slate-200 mr-2">Edit</button>
                      <button data-delete-id="${t.id}" class="text-rose-400 hover:text-rose-300 font-medium">Hapus</button>
                    `}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Modal Tambah Transaksi -->
    <div id="add-modal" class="hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-md shadow-2xl">
        <h3 class="text-lg font-bold text-white mb-4">Tambah Transaksi Manual</h3>
        <form id="add-tx-form" class="space-y-4 text-xs">
          <div>
            <label class="block text-slate-300 font-medium mb-1">Tipe</label>
            <select id="tx-type" class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white">
              <option value="keluar">Pengeluaran</option>
              <option value="masuk">Pemasukan</option>
            </select>
          </div>
          <div>
            <label class="block text-slate-300 font-medium mb-1">Nominal (Rp)</label>
            <input type="number" id="tx-amount" min="1" required placeholder="50000" class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white" />
          </div>
          <div>
            <label class="block text-slate-300 font-medium mb-1">Catatan / Keterangan</label>
            <input type="text" id="tx-note" required placeholder="Makan siang, bensin, dll" class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white" />
          </div>
          <div>
            <label class="block text-slate-300 font-medium mb-1">Kantong</label>
            <select id="tx-pocket" class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white">
              <option value="">Saldo Utama</option>
              ${pockets.map((p) => `<option value="${p.pocketId}">${escapeHtml(p.pocketName)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-slate-300 font-medium mb-1">Kategori (Opsional)</label>
            <select id="tx-category" class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white">
              <option value="">Tanpa Kategori</option>
              ${categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="flex items-center justify-end gap-2 pt-3">
            <button type="button" id="close-modal" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg">Batal</button>
            <button type="submit" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium">Simpan</button>
          </div>
        </form>
      </div>
    </div>
  `;

  // Event handlers
  const filterBtn = container.querySelector('#apply-filter');
  filterBtn.onclick = () => {
    const newQ = container.querySelector('#filter-q').value.trim();
    const newType = container.querySelector('#filter-type').value;
    const newAi = container.querySelector('#filter-ai').checked;
    const newDel = container.querySelector('#filter-deleted').checked;
    window.location.hash = `#/transaksi?q=${encodeURIComponent(newQ)}&type=${newType}&ai_only=${newAi}&deleted=${newDel}`;
  };

  // Add modal
  const addModal = container.querySelector('#add-modal');
  container.querySelector('#open-add-modal').onclick = () => addModal.classList.remove('hidden');
  container.querySelector('#close-modal').onclick = () => addModal.classList.add('hidden');

  container.querySelector('#add-tx-form').onsubmit = async (e) => {
    e.preventDefault();
    const type = container.querySelector('#tx-type').value;
    const amount = Number(container.querySelector('#tx-amount').value);
    const note = container.querySelector('#tx-note').value.trim();
    const pocketId = container.querySelector('#tx-pocket').value ? Number(container.querySelector('#tx-pocket').value) : null;
    const categoryId = container.querySelector('#tx-category').value ? Number(container.querySelector('#tx-category').value) : null;

    try {
      await api.post('/api/transactions', { type, amount, note, pocketId, categoryId });
      showToast('Transaksi berhasil ditambahkan.', 'success');
      addModal.classList.add('hidden');
      renderTransaksi(container, params);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Delete handler
  container.querySelectorAll('[data-delete-id]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-delete-id');
      if (!confirm(`Yakin ingin menghapus transaksi #${id}?`)) return;
      try {
        await api.delete(`/api/transactions/${id}`);
        showToast('Transaksi berhasil dihapus.', 'success');
        renderTransaksi(container, params);
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  });

  // Restore handler
  container.querySelectorAll('[data-restore-id]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-restore-id');
      try {
        await api.post(`/api/transactions/${id}/restore`);
        showToast('Transaksi berhasil dipulihkan.', 'success');
        renderTransaksi(container, params);
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  });
}
