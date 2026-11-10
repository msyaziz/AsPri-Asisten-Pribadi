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
