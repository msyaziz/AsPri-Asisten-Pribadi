/**
 * Application Bootstrap & Main Entrypoint.
 * Sesuai prd.md §14 dan 05-fase5-dashboard-web.md §4.
 */

import { registerRoute, initRouter } from './router.js';
import { api } from './api.js';
import { state, checkAuth, bus, showToast } from './state.js';
import { renderLogin } from './pages/login.js';
import { renderBeranda } from './pages/beranda.js';
import { renderTransaksi } from './pages/transaksi.js';
import { renderKantong } from './pages/kantong.js';
import { renderKalender } from './pages/kalender.js';
import { renderCatatan } from './pages/catatan.js';
import { renderKategori } from './pages/kategori.js';
import { renderBot } from './pages/bot.js';
import { renderLog } from './pages/log.js';
import { renderPengaturan } from './pages/pengaturan.js';

// Daftarkan rute-rute aplikasi
registerRoute('#/login', renderLogin);
registerRoute('#/', renderBeranda);
registerRoute('#/transaksi', renderTransaksi);
registerRoute('#/kantong', renderKantong);
registerRoute('#/kalender', renderKalender);
registerRoute('#/catatan', renderCatatan);
registerRoute('#/kategori', renderKategori);
registerRoute('#/bot', renderBot);
registerRoute('#/log', renderLog);
registerRoute('#/pengaturan', renderPengaturan);

// Setup tombol Logout & User info
function setupHeader() {
  const logoutBtn = document.getElementById('logout-btn');
  const userEmail = document.getElementById('user-email');

  bus.on('auth:change', (user) => {
    if (user && userEmail) {
      userEmail.textContent = user.email || 'Admin';
    }
  });

  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      try {
        await api.post('/api/auth/logout', {});
      } catch {}
      state.user = null;
      state.isAuthenticated = false;
      showToast('Anda telah keluar.', 'info');
      window.location.hash = '#/login';
    };
  }
}

// Inisialisasi aplikasi saat DOM siap
window.addEventListener('DOMContentLoaded', async () => {
  setupHeader();
  await checkAuth();
  initRouter();
});
