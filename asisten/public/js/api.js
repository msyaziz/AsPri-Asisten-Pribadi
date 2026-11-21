/**
 * API Client dengan penanganan 401 dan proteksi CSRF.
 * Sesuai prd.md §14 dan 05-fase5-dashboard-web.md §4.
 */

class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.status = status;
    this.code = code || 'API_ERROR';
    this.details = details || null;
  }
}

export async function request(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = {
    Accept: 'application/json',
    ...(options.headers || {}),
  };

  // Pastikan Origin dikirim untuk proteksi CSRF saat mengubah data
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    headers['Origin'] = window.location.origin;
  }

  let body = options.body;
  if (body && typeof body === 'object' && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  const response = await fetch(url, {
    ...options,
    method,
    headers,
    body,
    credentials: 'same-origin',
  });

  // Penanganan otomatis 401 Unauthorized -> Arahkan ke halaman login
  if (response.status === 401) {
    if (!window.location.hash.startsWith('#/login')) {
      window.location.hash = '#/login';
    }
    const errData = await response.json().catch(() => ({}));
    throw new ApiError(errData.error?.message || 'Sesi berakhir, silakan login kembali.', 401, 'UNAUTHORIZED');
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data?.error?.message || `Permintaan gagal (${response.status})`;
    const code = data?.error?.code || 'SERVER_ERROR';
    throw new ApiError(message, response.status, code, data);
  }

  return data;
}

export const api = {
  get: (url, options) => request(url, { ...options, method: 'GET' }),
  post: (url, body, options) => request(url, { ...options, method: 'POST', body }),
  put: (url, body, options) => request(url, { ...options, method: 'PUT', body }),
  patch: (url, body, options) => request(url, { ...options, method: 'PATCH', body }),
  delete: (url, options) => request(url, { ...options, method: 'DELETE' }),
};

export default api;
