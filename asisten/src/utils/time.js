import { DateTime } from 'luxon';
import { CONSTANTS } from '../config/constants.js';

const TZ = CONSTANTS.TIMEZONE;

/**
 * Mendapatkan DateTime sekarang dalam zona waktu Asia/Jakarta.
 * @returns {DateTime}
 */
export function nowWib() {
  return DateTime.now().setZone(TZ);
}

/**
 * Format tanggal/waktu ke string lokal WIB.
 * @param {Date|string|DateTime} [date]
 * @param {string} [format="yyyy-MM-dd HH:mm:ss 'WIB'"]
 * @returns {string}
 */
export function formatWib(date, format = "yyyy-MM-dd HH:mm:ss 'WIB'") {
  if (!date) return nowWib().toFormat(format);
  if (date instanceof DateTime) return date.setZone(TZ).toFormat(format);
  if (date instanceof Date) return DateTime.fromJSDate(date).setZone(TZ).toFormat(format);
  return DateTime.fromISO(String(date)).setZone(TZ).toFormat(format);
}

/**
 * Nama hari dalam Bahasa Indonesia.
 * @param {DateTime} [dt]
 * @returns {string}
 */
export function getWibDayOfWeek(dt = nowWib()) {
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  // Luxon weekday: 1 (Mon) - 7 (Sun)
  const luxonDay = dt.weekday;
  const mappedIndex = luxonDay === 7 ? 0 : luxonDay;
  return days[mappedIndex];
}

/**
 * String tanggal WIB format YYYY-MM-DD.
 * @param {DateTime} [dt]
 * @returns {string}
 */
export function getWibDateString(dt = nowWib()) {
  return dt.toFormat('yyyy-MM-dd');
}

/**
 * Konteks waktu lengkap untuk System Prompt AI.
 * Contoh: "Hari ini Selasa, 10 November 2026, pukul 20:55 WIB."
 * @returns {string}
 */
export function getSystemTimeContext() {
  const dt = nowWib().setLocale('id-ID');
  const dayName = getWibDayOfWeek(dt);
  const dateFormatted = dt.toFormat('d LLLL yyyy');
  const timeFormatted = dt.toFormat('HH:mm');
  return `Hari ini ${dayName}, ${dateFormatted}, pukul ${timeFormatted} WIB.`;
}

/**
 * Menerjemahkan rentang tanggal simbolik ('today', 'yesterday', 'this_week', dll)
 * menjadi tanggal absolut YYYY-MM-DD dalam zona waktu WIB.
 * Sesuai prd.md §12.4.
 * @param {string} [range]
 * @param {string} [dateFrom]
 * @param {string} [dateTo]
 * @returns {{ from: string, to: string, label: string }}
 */
export function resolveSymbolicDateRange(range, dateFrom, dateTo) {
  const dt = nowWib();
  const todayStr = dt.toFormat('yyyy-MM-dd');

  if (range) {
    const r = range.toLowerCase().trim();
    if (r === 'today' || r === 'hari_ini') {
      return { from: todayStr, to: todayStr, label: 'hari ini' };
    }
    if (r === 'yesterday' || r === 'kemarin') {
      const yStr = dt.minus({ days: 1 }).toFormat('yyyy-MM-dd');
      return { from: yStr, to: yStr, label: 'kemarin' };
    }
    if (r === 'this_week' || r === 'minggu_ini') {
      const fromStr = dt.startOf('week').toFormat('yyyy-MM-dd');
      const toStr = dt.endOf('week').toFormat('yyyy-MM-dd');
      return { from: fromStr, to: toStr, label: 'minggu ini' };
    }
    if (r === 'last_week' || r === 'minggu_lalu') {
      const prevWeek = dt.minus({ weeks: 1 });
      const fromStr = prevWeek.startOf('week').toFormat('yyyy-MM-dd');
      const toStr = prevWeek.endOf('week').toFormat('yyyy-MM-dd');
      return { from: fromStr, to: toStr, label: 'minggu lalu' };
    }
    if (r === 'this_month' || r === 'bulan_ini') {
      const fromStr = dt.startOf('month').toFormat('yyyy-MM-dd');
      const toStr = dt.endOf('month').toFormat('yyyy-MM-dd');
      return { from: fromStr, to: toStr, label: 'bulan ini' };
    }
    if (r === 'last_month' || r === 'bulan_lalu') {
      const prevMonth = dt.minus({ months: 1 });
      const fromStr = prevMonth.startOf('month').toFormat('yyyy-MM-dd');
      const toStr = prevMonth.endOf('month').toFormat('yyyy-MM-dd');
      return { from: fromStr, to: toStr, label: 'bulan lalu' };
    }
  }

  const from = dateFrom || dt.startOf('month').toFormat('yyyy-MM-dd');
  const to = dateTo || todayStr;
  return { from, to, label: `${from} s.d. ${to}` };
}
