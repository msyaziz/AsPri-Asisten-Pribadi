/**
 * Client-side Hash Router.
 * Sesuai prd.md §14 dan 05-fase5-dashboard-web.md §4.
 */

import { state, checkAuth } from './state.js';

const routes = {};

export function registerRoute(path, handler) {
  routes[path] = handler;
}

export async function navigate() {
  const hash = window.location.hash || '#/';
  const [routePath, queryString] = hash.split('?');
  const params = new URLSearchParams(queryString || '');

  // Cek otentikasi
  if (!state.isAuthenticated && routePath !== '#/login') {
    const user = await checkAuth();
    if (!user) {
      window.location.hash = '#/login';
      return;
    }
  }

  // Jika sudah login tapi buka login page, arahkan ke beranda
  if (state.isAuthenticated && routePath === '#/login') {
    window.location.hash = '#/';
    return;
  }

  // Update navigasi aktif
  updateNav(routePath);

  const handler = routes[routePath] || routes['#/'];
  const appEl = document.getElementById('app');

  if (handler && appEl) {
    appEl.innerHTML = `
      <div class="flex items-center justify-center p-12 text-slate-400">
        <svg class="animate-spin h-6 w-6 mr-3 text-emerald-500" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
        </svg>
        <span>Memuat...</span>
      </div>
    `;
    try {
      await handler(appEl, params);
    } catch (err) {
      console.error('Error rendering route:', err);
      appEl.innerHTML = `
        <div class="p-6 bg-rose-50 border border-rose-200 rounded-xl text-rose-700">
          <h2 class="text-lg font-bold">Terjadi Kesalahan</h2>
          <p class="mt-1 text-sm">${err.message || 'Gagal memuat halaman.'}</p>
          <button onclick="window.location.reload()" class="mt-4 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-sm font-medium">
            Muat Ulang
          </button>
        </div>
      `;
    }
  }
}

function updateNav(activeRoute) {
  const navLinks = document.querySelectorAll('[data-route]');
  navLinks.forEach((link) => {
    const route = link.getAttribute('data-route');
    if (route === activeRoute) {
      link.classList.add('bg-slate-800', 'text-white', 'font-semibold');
      link.classList.remove('text-slate-400', 'hover:bg-slate-800/50');
    } else {
      link.classList.remove('bg-slate-800', 'text-white', 'font-semibold');
      link.classList.add('text-slate-400', 'hover:bg-slate-800/50');
    }
  });

  const sidebar = document.getElementById('sidebar');
  const userHeader = document.getElementById('user-header');
  if (activeRoute === '#/login') {
    if (sidebar) sidebar.style.display = 'none';
    if (userHeader) userHeader.style.display = 'none';
  } else {
    if (sidebar) sidebar.style.display = 'flex';
    if (userHeader) userHeader.style.display = 'flex';
  }
}

export function initRouter() {
  window.addEventListener('hashchange', navigate);
  navigate();
}
