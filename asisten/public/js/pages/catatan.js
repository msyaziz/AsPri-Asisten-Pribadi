/**
 * Halaman Catatan (Notes).
 * Sesuai prd.md §14.
 */

import { api } from '../api.js';
import { formatDateWib, escapeHtml } from '../utils/format.js';
import { showToast } from '../state.js';

export async function renderCatatan(container, params) {
  const q = params.get('q') || '';
  const notesRes = await api.get(`/api/notes?q=${encodeURIComponent(q)}`).catch(() => ({ data: [] }));
  const notes = notesRes.data || [];

  container.innerHTML = `
    <div class="space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-white tracking-tight">Catatan</h1>
          <p class="text-sm text-slate-400 mt-0.5">Catatan cepat, ide, dan informasi penting</p>
        </div>
        <button
          id="open-note-modal"
          class="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-2 shadow-lg shadow-emerald-900/30 transition-colors"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
          <span>Buat Catatan</span>
        </button>
      </div>

      <!-- Search Bar -->
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-3">
        <input
          type="text"
          id="search-note"
          value="${escapeHtml(q)}"
          placeholder="Cari dalam catatan..."
          class="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-xs flex-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        <button id="search-btn" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs rounded-lg font-medium">Cari</button>
      </div>

      <!-- Notes Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        ${notes.length === 0 ? '<p class="text-sm text-slate-500 col-span-full py-8 text-center">Belum ada catatan.</p>' : notes.map((n) => `
          <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
            <div>
              <div class="text-xs text-slate-500 mb-2">${formatDateWib(n.note_date || n.created_at)}</div>
              <p class="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">${escapeHtml(n.content)}</p>
              ${n.tags && n.tags.length > 0 ? `
                <div class="mt-4 flex flex-wrap gap-1.5">
                  ${n.tags.map((t) => `<span class="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-400">#${escapeHtml(t)}</span>`).join('')}
                </div>
              ` : ''}
            </div>
            <div class="mt-5 pt-3 border-t border-slate-800 flex items-center justify-end text-xs">
              <button data-delete-note="${n.id}" class="text-rose-400 hover:text-rose-300 font-medium">Hapus</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Modal Tambah Catatan -->
    <div id="note-modal" class="hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-md shadow-2xl">
        <h3 class="text-lg font-bold text-white mb-4">Catatan Baru</h3>
        <form id="note-form" class="space-y-4 text-xs">
          <div>
            <label class="block text-slate-300 font-medium mb-1">Isi Catatan</label>
            <textarea id="note-content" rows="4" required placeholder="Tulis catatan di sini..." class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white"></textarea>
          </div>
          <div>
            <label class="block text-slate-300 font-medium mb-1">Tags (pisahkan dengan koma)</label>
            <input type="text" id="note-tags" placeholder="ide, buku, belanja" class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white" />
          </div>
          <div class="flex items-center justify-end gap-2 pt-3">
            <button type="button" id="close-note-modal" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg">Batal</button>
            <button type="submit" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium">Simpan</button>
          </div>
        </form>
      </div>
    </div>
  `;

  // Search
  container.querySelector('#search-btn').onclick = () => {
    const val = container.querySelector('#search-note').value.trim();
    window.location.hash = `#/catatan?q=${encodeURIComponent(val)}`;
  };

  // Modal
  const modal = container.querySelector('#note-modal');
  container.querySelector('#open-note-modal').onclick = () => modal.classList.remove('hidden');
  container.querySelector('#close-note-modal').onclick = () => modal.classList.add('hidden');

  container.querySelector('#note-form').onsubmit = async (e) => {
    e.preventDefault();
    const content = container.querySelector('#note-content').value.trim();
    const tagsRaw = container.querySelector('#note-tags').value.trim();
    const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];

    try {
      await api.post('/api/notes', { content, tags });
      showToast('Catatan disimpan.', 'success');
      modal.classList.add('hidden');
      renderCatatan(container, params);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  container.querySelectorAll('[data-delete-note]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-delete-note');
      if (!confirm(`Hapus catatan #${id}?`)) return;
      try {
        await api.delete(`/api/notes/${id}`);
        showToast('Catatan dihapus.', 'success');
        renderCatatan(container, params);
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  });
}
