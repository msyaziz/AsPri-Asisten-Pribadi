/**
 * Halaman Kantong & Alokasi Anggaran.
 * Sesuai prd.md §14.
 */

import { api } from '../api.js';
import { formatRupiah, escapeHtml } from '../utils/format.js';
import { showToast } from '../state.js';

export async function renderKantong(container) {
  const [pocketsRes, periodsRes, summaryRes] = await Promise.all([
    api.get('/api/pockets'),
    api.get('/api/periods').catch(() => ({ data: [] })),
    api.get('/api/summary').catch(() => ({ data: {} })),
  ]);

  const pockets = pocketsRes.data || [];
  const periods = periodsRes.data || [];
  const currentPeriod = summaryRes.data?.period || {};

  container.innerHTML = `
    <div class="space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-white tracking-tight">Kantong Anggaran</h1>
          <p class="text-sm text-slate-400 mt-0.5">Kelola pos pengeluaran, alokasi bulanan, dan mode rollover</p>
        </div>
        <div class="flex items-center gap-2">
          <button
            id="open-transfer-modal"
            class="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-2 border border-slate-700 transition-colors"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path></svg>
            <span>Transfer Dana</span>
          </button>
          <button
            id="open-add-pocket-modal"
            class="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-2 shadow-lg shadow-emerald-900/30 transition-colors"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
            <span>Tambah Kantong</span>
          </button>
        </div>
      </div>

      <!-- Kartu Kantong Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        ${pockets.length === 0 ? '<p class="text-sm text-slate-500 col-span-full py-8 text-center">Belum ada kantong anggaran.</p>' : pockets.map((p) => `
          <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
            <div>
              <div class="flex items-center justify-between">
                <h3 class="text-base font-semibold text-white">${escapeHtml(p.pocketName || p.name)}</h3>
                <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                  p.rolloverMode === 'carry' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                }">
                  ${escapeHtml(p.rolloverMode || 'carry')}
                </span>
              </div>
              <div class="mt-4">
                <div class="text-xs text-slate-400">Saldo Saat Ini</div>
                <div class="text-2xl font-bold text-slate-100 mt-1">${formatRupiah(p.balance || 0)}</div>
              </div>
              <div class="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-400 pt-3 border-t border-slate-800">
                <div>Alokasi: <span class="font-medium text-slate-200">${formatRupiah(p.allocAmount || 0)}</span></div>
                <div>Terpakai: <span class="font-medium text-rose-400">${formatRupiah(p.spent || 0)}</span></div>
              </div>
            </div>
            <div class="mt-5 pt-3 border-t border-slate-800 flex items-center justify-end gap-2 text-xs">
              <button
                data-change-rollover="${p.pocketId}"
                data-current-mode="${p.rolloverMode}"
                class="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-medium transition-colors"
              >
                Ubah Rollover
              </button>
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Form Alokasi Persentase Periode Berjalan -->
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-base font-semibold text-white">Atur Alokasi Uang Bulanan</h2>
            <p class="text-xs text-slate-400 mt-0.5">Persentase alokasi untuk periode ${currentPeriod.year || '-'}-${String(currentPeriod.month || '').padStart(2, '0')}</p>
          </div>
        </div>

        <form id="allocations-form" class="space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            ${pockets.map((p) => `
              <div class="p-3 bg-slate-800/60 rounded-lg border border-slate-700/60">
                <label class="block font-medium text-white mb-1.5">${escapeHtml(p.pocketName || p.name)}</label>
                <div class="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    data-alloc-pocket-id="${p.pocketId}"
                    value="${p.allocPercent || 0}"
                    class="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-right font-mono"
                  />
                  <span class="text-slate-400 font-semibold">%</span>
                </div>
              </div>
            `).join('')}
          </div>
          <div class="flex items-center justify-end pt-3">
            <button type="submit" class="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-lg shadow-emerald-900/30">
              Simpan Alokasi
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal Tambah Kantong -->
    <div id="add-pocket-modal" class="hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-sm shadow-2xl">
        <h3 class="text-lg font-bold text-white mb-4">Buat Kantong Baru</h3>
        <form id="add-pocket-form" class="space-y-4 text-xs">
          <div>
            <label class="block text-slate-300 font-medium mb-1">Nama Kantong</label>
            <input type="text" id="pocket-name" required placeholder="Contoh: Belanja, Hiburan" class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white" />
          </div>
          <div>
            <label class="block text-slate-300 font-medium mb-1">Mode Rollover</label>
            <select id="pocket-rollover" class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white">
              <option value="carry">Carry (bawa sisa ke bulan depan)</option>
              <option value="return">Return (kembalikan ke saldo utama)</option>
            </select>
          </div>
          <div class="flex items-center justify-end gap-2 pt-3">
            <button type="button" id="close-pocket-modal" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg">Batal</button>
            <button type="submit" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium">Buat Kantong</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal Transfer Dana -->
    <div id="transfer-modal" class="hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-sm shadow-2xl">
        <h3 class="text-lg font-bold text-white mb-4">Transfer Dana</h3>
        <form id="transfer-form" class="space-y-4 text-xs">
          <div>
            <label class="block text-slate-300 font-medium mb-1">Dari Sumber</label>
            <select id="transfer-from" class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white">
              <option value="">Saldo Utama</option>
              ${pockets.map((p) => `<option value="${p.pocketId}">${escapeHtml(p.pocketName)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-slate-300 font-medium mb-1">Ke Tujuan</label>
            <select id="transfer-to" class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white">
              ${pockets.map((p) => `<option value="${p.pocketId}">${escapeHtml(p.pocketName)}</option>`).join('')}
              <option value="">Saldo Utama</option>
            </select>
          </div>
          <div>
            <label class="block text-slate-300 font-medium mb-1">Nominal (Rp)</label>
            <input type="number" id="transfer-amount" min="1" required placeholder="50000" class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white" />
          </div>
          <div>
            <label class="block text-slate-300 font-medium mb-1">Catatan</label>
            <input type="text" id="transfer-note" placeholder="Pindah dana..." class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white" />
          </div>
          <div class="flex items-center justify-end gap-2 pt-3">
            <button type="button" id="close-transfer-modal" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg">Batal</button>
            <button type="submit" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium">Kirim Transfer</button>
          </div>
        </form>
      </div>
    </div>
  `;

  // Handlers
  const addModal = container.querySelector('#add-pocket-modal');
  container.querySelector('#open-add-pocket-modal').onclick = () => addModal.classList.remove('hidden');
  container.querySelector('#close-pocket-modal').onclick = () => addModal.classList.add('hidden');

  container.querySelector('#add-pocket-form').onsubmit = async (e) => {
    e.preventDefault();
    const name = container.querySelector('#pocket-name').value.trim();
    const rolloverMode = container.querySelector('#pocket-rollover').value;
    try {
      await api.post('/api/pockets', { name, rolloverMode });
      showToast('Kantong berhasil dibuat!', 'success');
      addModal.classList.add('hidden');
      renderKantong(container);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Transfer modal
  const transferModal = container.querySelector('#transfer-modal');
  container.querySelector('#open-transfer-modal').onclick = () => transferModal.classList.remove('hidden');
  container.querySelector('#close-transfer-modal').onclick = () => transferModal.classList.add('hidden');

  container.querySelector('#transfer-form').onsubmit = async (e) => {
    e.preventDefault();
    const fromVal = container.querySelector('#transfer-from').value;
    const toVal = container.querySelector('#transfer-to').value;
    const amount = Number(container.querySelector('#transfer-amount').value);
    const note = container.querySelector('#transfer-note').value.trim();

    try {
      await api.post('/api/transfers', {
        fromPocketId: fromVal ? Number(fromVal) : null,
        toPocketId: toVal ? Number(toVal) : null,
        amount,
        note,
      });
      showToast('Transfer dana berhasil.', 'success');
      transferModal.classList.add('hidden');
      renderKantong(container);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Change rollover mode
  container.querySelectorAll('[data-change-rollover]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-change-rollover');
      const curMode = btn.getAttribute('data-current-mode');
      const nextMode = curMode === 'carry' ? 'return' : 'carry';
      try {
        await api.patch(`/api/pockets/${id}`, { rolloverMode: nextMode });
        showToast(`Mode rollover diubah menjadi ${nextMode}.`, 'success');
        renderKantong(container);
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  });

  // Save allocations
  container.querySelector('#allocations-form').onsubmit = async (e) => {
    e.preventDefault();
    const inputs = container.querySelectorAll('[data-alloc-pocket-id]');
    const allocations = [];
    inputs.forEach((input) => {
      allocations.push({
        pocketId: Number(input.getAttribute('data-alloc-pocket-id')),
        percent: Number(input.value) || 0,
      });
    });

    if (!currentPeriod.id) {
      showToast('Periode berjalan tidak ditemukan.', 'error');
      return;
    }

    try {
      await api.put(`/api/periods/${currentPeriod.id}/allocations`, { allocations });
      showToast('Alokasi berhasil diperbarui.', 'success');
      renderKantong(container);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };
}
