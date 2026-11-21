/**
 * Halaman Login Dashboard.
 * Sesuai prd.md §14.
 */

import { api } from '../api.js';
import { checkAuth, showToast } from '../state.js';

export async function renderLogin(container) {
  container.innerHTML = `
    <div class="min-h-[80vh] flex items-center justify-center">
      <div class="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
        <div class="text-center mb-8">
          <div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-400 mb-4">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
            </svg>
          </div>
          <h1 class="text-2xl font-bold text-white">AsPri Dashboard</h1>
          <p class="text-sm text-slate-400 mt-1">Masuk dengan akun admin untuk mengelola asisten</p>
        </div>

        <form id="login-form" class="space-y-5">
          <div>
            <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Email</label>
            <input
              type="email"
              id="email"
              required
              autocomplete="email"
              placeholder="admin@example.com"
              class="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
            />
          </div>

          <div>
            <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Password</label>
            <input
              type="password"
              id="password"
              required
              autocomplete="current-password"
              placeholder="••••••••"
              class="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
            />
          </div>

          <div id="login-error" class="hidden p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs"></div>

          <button
            type="submit"
            id="login-btn"
            class="w-full py-3 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition-colors flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/30"
          >
            <span>Masuk</span>
          </button>
        </form>
      </div>
    </div>
  `;

  const form = container.querySelector('#login-form');
  const errorBox = container.querySelector('#login-error');
  const submitBtn = container.querySelector('#login-btn');

  form.onsubmit = async (e) => {
    e.preventDefault();
    errorBox.classList.add('hidden');
    errorBox.textContent = '';
    submitBtn.disabled = true;
    submitBtn.classList.add('opacity-75');

    const email = container.querySelector('#email').value.trim();
    const password = container.querySelector('#password').value;

    try {
      const res = await api.post('/api/auth/login', { email, password });
      if (res.ok) {
        showToast('Login berhasil!', 'success');
        await checkAuth();
        window.location.hash = '#/';
      }
    } catch (err) {
      errorBox.textContent = err.message || 'Login gagal. Periksa email dan password.';
      errorBox.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
      submitBtn.classList.remove('opacity-75');
    }
  };
}
