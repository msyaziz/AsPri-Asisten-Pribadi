/**
 * Halaman Kategori & Aturan Kata Kunci.
 * Sesuai prd.md §14.
 */

import { api } from '../api.js';
import { escapeHtml } from '../utils/format.js';
import { showToast } from '../state.js';

export async function renderKategori(container) {
  const [catRes, rulesRes] = await Promise.all([
    api.get('/api/categories?activeOnly=false'),
    api.get('/api/category-rules?limit=100'),
  ]);

  const categories = catRes.data || [];
  const rules = rulesRes.data || [];

  container.innerHTML = `
    <div class="space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-white tracking-tight">Kategori & Aturan</h1>
          <p class="text-sm text-slate-400 mt-0.5">Pengelompokan transaksi otomatis berdasarkan aturan kata kunci</p>
        </div>
        <div class="flex items-center gap-2">
          <button
            id="open-rule-modal"
            class="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-2 border border-slate-700 transition-colors"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
            <span>Tambah Aturan Kata Kunci</span>
          </button>
          <button
            id="open-cat-modal"
            class="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-2 shadow-lg shadow-emerald-900/30 transition-colors"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
            <span>Tambah Kategori</span>
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Daftar Kategori -->
        <div class="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h2 class="text-base font-semibold text-white mb-4">Daftar Kategori</h2>
          <div class="divide-y divide-slate-800">
            ${categories.map((c) => `
              <div class="py-3 flex items-center justify-between">
                <div>
                  <div class="text-sm font-medium text-white flex items-center gap-2">
                    <span>${escapeHtml(c.name)}</span>
                    <span class="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                      c.type === 'keluar' ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'
                    }">${escapeHtml(c.type)}</span>
                  </div>
                  <div class="text-xs text-slate-500 mt-0.5">Default Kantong: ${escapeHtml(c.default_pocket_name || 'Tidak ada')}</div>
                </div>
                <div class="flex items-center gap-2 text-xs">
                  <button data-delete-cat="${c.id}" class="text-rose-400 hover:text-rose-300 font-medium">Hapus</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Aturan Kata Kunci -->
        <div class="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h2 class="text-base font-semibold text-white mb-4">Aturan Kata Kunci Otomatis (${rules.length})</h2>
          <div class="max-h-[500px] overflow-y-auto divide-y divide-slate-800 pr-2">
            ${rules.map((r) => `
              <div class="py-2.5 flex items-center justify-between">
                <div>
                  <div class="text-xs font-semibold text-emerald-400 font-mono">"${escapeHtml(r.keyword)}"</div>
                  <div class="text-[11px] text-slate-400 mt-0.5">
                    &rarr; ${escapeHtml(r.category_name)}
                    <span class="text-slate-600 ml-2">Hits: ${r.hits} | ${escapeHtml(r.source)}</span>
                  </div>
                </div>
                <button data-delete-rule="${r.id}" class="text-slate-500 hover:text-rose-400 text-xs">Hapus</button>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>

    <!-- Modal Tambah Kategori -->
    <div id="cat-modal" class="hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-sm shadow-2xl">
        <h3 class="text-lg font-bold text-white mb-4">Kategori Baru</h3>
        <form id="cat-form" class="space-y-4 text-xs">
          <div>
            <label class="block text-slate-300 font-medium mb-1">Nama Kategori</label>
            <input type="text" id="cat-name" required placeholder="Contoh: Transportasi" class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white" />
          </div>
          <div>
            <label class="block text-slate-300 font-medium mb-1">Tipe</label>
            <select id="cat-type" class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white">
              <option value="keluar">Pengeluaran</option>
              <option value="masuk">Pemasukan</option>
              <option value="both">Keduanya</option>
            </select>
          </div>
          <div class="flex items-center justify-end gap-2 pt-3">
            <button type="button" id="close-cat-modal" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg">Batal</button>
            <button type="submit" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium">Simpan</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal Tambah Aturan -->
    <div id="rule-modal" class="hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-sm shadow-2xl">
        <h3 class="text-lg font-bold text-white mb-4">Aturan Kata Kunci Baru</h3>
        <form id="rule-form" class="space-y-4 text-xs">
          <div>
            <label class="block text-slate-300 font-medium mb-1">Kata Kunci (keyword)</label>
            <input type="text" id="rule-kw" required placeholder="bensin, kfc, indomaret" class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white font-mono" />
          </div>
          <div>
            <label class="block text-slate-300 font-medium mb-1">Arahkan ke Kategori</label>
            <select id="rule-cat-id" required class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white">
              ${categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="flex items-center justify-end gap-2 pt-3">
            <button type="button" id="close-rule-modal" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg">Batal</button>
            <button type="submit" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium">Simpan Aturan</button>
          </div>
        </form>
      </div>
    </div>
  `;

  // Modal Cat
  const catModal = container.querySelector('#cat-modal');
  container.querySelector('#open-cat-modal').onclick = () => catModal.classList.remove('hidden');
  container.querySelector('#close-cat-modal').onclick = () => catModal.classList.add('hidden');

  container.querySelector('#cat-form').onsubmit = async (e) => {
    e.preventDefault();
    const name = container.querySelector('#cat-name').value.trim();
    const type = container.querySelector('#cat-type').value;
    try {
      await api.post('/api/categories', { name, type });
      showToast('Kategori berhasil dibuat.', 'success');
      catModal.classList.add('hidden');
      renderKategori(container);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Modal Rule
  const ruleModal = container.querySelector('#rule-modal');
  container.querySelector('#open-rule-modal').onclick = () => ruleModal.classList.remove('hidden');
  container.querySelector('#close-rule-modal').onclick = () => ruleModal.classList.add('hidden');

  container.querySelector('#rule-form').onsubmit = async (e) => {
    e.preventDefault();
    const keyword = container.querySelector('#rule-kw').value.trim();
    const categoryId = Number(container.querySelector('#rule-cat-id').value);
    try {
      await api.post('/api/category-rules', { keyword, categoryId, source: 'seed' });
      showToast('Aturan kata kunci disimpan.', 'success');
      ruleModal.classList.add('hidden');
      renderKategori(container);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  container.querySelectorAll('[data-delete-cat]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-delete-cat');
      if (!confirm(`Hapus kategori #${id}?`)) return;
      try {
        await api.delete(`/api/categories/${id}`);
        showToast('Kategori dihapus.', 'success');
        renderKategori(container);
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  });

  container.querySelectorAll('[data-delete-rule]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-delete-rule');
      try {
        await api.delete(`/api/category-rules/${id}`);
        showToast('Aturan dihapus.', 'success');
        renderKategori(container);
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  });
}
