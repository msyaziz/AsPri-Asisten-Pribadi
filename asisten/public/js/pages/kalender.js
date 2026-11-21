/**
 * Halaman Kalender & Agenda.
 * Sesuai prd.md §14.
 */

import { api } from '../api.js';
import { formatDateWib, escapeHtml } from '../utils/format.js';
import { showToast } from '../state.js';

export async function renderKalender(container, params) {
  const eventsRes = await api.get('/api/events').catch(() => ({ data: [] }));
  const events = eventsRes.data || [];

  container.innerHTML = `
    <div class="space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-white tracking-tight">Kalender & Agenda</h1>
          <p class="text-sm text-slate-400 mt-0.5">Jadwal kegiatan, pengingat, dan tugas</p>
        </div>
        <button
          id="open-event-modal"
          class="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-2 shadow-lg shadow-emerald-900/30 transition-colors"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
          <span>Tambah Agenda / Task</span>
        </button>
      </div>

      <!-- Daftar Agenda -->
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 class="text-base font-semibold text-white mb-4">Semua Agenda Mendatang</h2>
        ${events.length === 0 ? '<p class="text-sm text-slate-500 py-8 text-center">Belum ada agenda terdaftar.</p>' : `
          <div class="divide-y divide-slate-800">
            ${events.map((e) => `
              <div class="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div class="flex items-center gap-2">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      e.kind === 'task' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/20' : 'bg-blue-500/20 text-blue-400 border border-blue-500/20'
                    }">${escapeHtml(e.kind)}</span>
                    <span class="text-sm font-semibold ${e.status === 'done' ? 'line-through text-slate-500' : 'text-white'}">
                      ${escapeHtml(e.title)}
                    </span>
                    <span class="text-[10px] px-2 py-0.5 rounded-full ${
                      e.status === 'done' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-400'
                    }">${escapeHtml(e.status)}</span>
                  </div>
                  <div class="text-xs text-slate-400 mt-1 flex items-center gap-4">
                    <span>Mulai: ${formatDateWib(e.starts_at, true)}</span>
                    ${e.ends_at ? `<span>Selesai: ${formatDateWib(e.ends_at, true)}</span>` : ''}
                    ${e.recurrence ? `<span class="text-slate-500">Berulang: ${escapeHtml(e.recurrence)}</span>` : ''}
                  </div>
                  ${e.description ? `<p class="text-xs text-slate-400 mt-1">${escapeHtml(e.description)}</p>` : ''}
                </div>
                <div class="flex items-center gap-2 text-xs">
                  ${e.kind === 'task' && e.status !== 'done' ? `
                    <button data-complete-task="${e.id}" class="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 rounded-lg font-medium transition-colors">
                      Selesai
                    </button>
                  ` : ''}
                  <button data-delete-event="${e.id}" class="px-3 py-1.5 bg-slate-800 hover:bg-rose-600/20 text-slate-400 hover:text-rose-400 rounded-lg font-medium transition-colors">
                    Hapus
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    </div>

    <!-- Modal Tambah Agenda -->
    <div id="event-modal" class="hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-md shadow-2xl">
        <h3 class="text-lg font-bold text-white mb-4">Tambah Agenda / Task</h3>
        <form id="event-form" class="space-y-4 text-xs">
          <div>
            <label class="block text-slate-300 font-medium mb-1">Tipe</label>
            <select id="event-kind" class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white">
              <option value="event">Event (Kegiatan / Janji Temu)</option>
              <option value="task">Task (Tugas / To-Do)</option>
            </select>
          </div>
          <div>
            <label class="block text-slate-300 font-medium mb-1">Judul</label>
            <input type="text" id="event-title" required placeholder="Judul kegiatan..." class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white" />
          </div>
          <div>
            <label class="block text-slate-300 font-medium mb-1">Waktu Mulai / Tenggat</label>
            <input type="datetime-local" id="event-starts" required class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white" />
          </div>
          <div>
            <label class="block text-slate-300 font-medium mb-1">Deskripsi (Opsional)</label>
            <textarea id="event-desc" rows="2" placeholder="Catatan tambahan..." class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white"></textarea>
          </div>
          <div class="flex items-center justify-end gap-2 pt-3">
            <button type="button" id="close-event-modal" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg">Batal</button>
            <button type="submit" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium">Simpan</button>
          </div>
        </form>
      </div>
    </div>
  `;

  // Handlers
  const modal = container.querySelector('#event-modal');
  container.querySelector('#open-event-modal').onclick = () => modal.classList.remove('hidden');
  container.querySelector('#close-event-modal').onclick = () => modal.classList.add('hidden');

  container.querySelector('#event-form').onsubmit = async (e) => {
    e.preventDefault();
    const kind = container.querySelector('#event-kind').value;
    const title = container.querySelector('#event-title').value.trim();
    const startsAt = new Date(container.querySelector('#event-starts').value).toISOString();
    const description = container.querySelector('#event-desc').value.trim();

    try {
      await api.post('/api/events', { kind, title, startsAt, description });
      showToast('Agenda berhasil ditambahkan.', 'success');
      modal.classList.add('hidden');
      renderKalender(container, params);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  container.querySelectorAll('[data-complete-task]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-complete-task');
      try {
        await api.post(`/api/events/${id}/complete`);
        showToast('Task selesai!', 'success');
        renderKalender(container, params);
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  });

  container.querySelectorAll('[data-delete-event]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-delete-event');
      if (!confirm(`Hapus agenda #${id}?`)) return;
      try {
        await api.delete(`/api/events/${id}`);
        showToast('Agenda dihapus.', 'success');
        renderKalender(container, params);
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  });
}
