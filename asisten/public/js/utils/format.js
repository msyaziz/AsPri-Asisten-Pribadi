/**
 * Utility Formatting (id-ID, WIB, Anti-XSS).
 * Sesuai prd.md §14 dan 05-fase5-dashboard-web.md §4.
 */

const rupiahFormatter = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Format angka ke Rupiah (contoh: Rp 50.000).
 * @param {number|string|bigint} val
 * @returns {string}
 */
export function formatRupiah(val) {
  if (val === null || val === undefined || isNaN(Number(val))) return 'Rp 0';
  return rupiahFormatter.format(Number(val));
}

/**
 * Format string tanggal / timestamp ke tanggal WIB (Asia/Jakarta).
 * @param {string|Date} dateVal
 * @param {boolean} [includeTime=false]
 * @returns {string}
 */
export function formatDateWib(dateVal, includeTime = false) {
  if (!dateVal) return '-';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return String(dateVal);

  const options = {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  };

  return new Intl.DateTimeFormat('id-ID', options).format(d);
}

/**
 * Escape teks ke string aman HTML untuk mencegah serangan XSS.
 * @param {any} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
