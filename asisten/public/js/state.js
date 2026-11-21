/**
 * State Management & Notification Bus.
 * Sesuai prd.md §14.
 */

import { api } from './api.js';

class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      for (const cb of this.listeners.get(event)) {
        try {
          cb(data);
        } catch (e) {
          console.error(`Error in event listener for ${event}:`, e);
        }
      }
    }
  }
}

export const bus = new EventBus();

export const state = {
  user: null,
  isAuthenticated: false,
};

export async function checkAuth() {
  try {
    const res = await api.get('/api/auth/me');
    if (res.ok && res.data) {
      state.user = res.data;
      state.isAuthenticated = true;
      bus.emit('auth:change', state.user);
      return state.user;
    }
  } catch (err) {
    state.user = null;
    state.isAuthenticated = false;
    bus.emit('auth:change', null);
  }
  return null;
}

export function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const bgColors = {
    success: 'bg-emerald-600 text-white',
    error: 'bg-rose-600 text-white',
    warning: 'bg-amber-600 text-white',
    info: 'bg-slate-800 text-white',
  };

  const bg = bgColors[type] || bgColors.info;
  toast.className = `px-4 py-3 rounded-lg shadow-lg text-sm font-medium flex items-center justify-between gap-3 transition-all transform translate-y-2 opacity-0 duration-200 ${bg}`;
  toast.innerHTML = `
    <span>${message}</span>
    <button class="opacity-75 hover:opacity-100 text-base leading-none">&times;</button>
  `;

  const closeBtn = toast.querySelector('button');
  const remove = () => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 200);
  };
  closeBtn.onclick = remove;

  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.remove('opacity-0', 'translate-y-2');
  });

  if (duration > 0) {
    setTimeout(remove, duration);
  }
}
