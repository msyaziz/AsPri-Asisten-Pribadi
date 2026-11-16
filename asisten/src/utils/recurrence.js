/**
 * Utilitas parsing dan generasi jadwal berulang (recurrence).
 * Format: 'daily' | 'weekly:MON' | 'monthly:15'
 * Fase 4 – prd.md §8.11
 */

import { DateTime } from 'luxon';
import { CONSTANTS } from '../config/constants.js';

const TZ = CONSTANTS.TIMEZONE;

const DAY_MAP = {
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
  SUN: 7,
};

/**
 * Hitung tanggal mulai occurrence BERIKUTNYA berdasarkan recurrence rule.
 * @param {string} rule - e.g. 'daily', 'weekly:MON', 'monthly:15'
 * @param {Date|string} currentStart - starts_at occurrence saat ini
 * @returns {{ start: string, end: string|null } | null}
 */
export function parseRecurrence(rule, currentStart) {
  if (!rule) return null;

  const dt = DateTime.fromJSDate(
    currentStart instanceof Date ? currentStart : new Date(currentStart)
  ).setZone(TZ);

  const [type, param] = rule.split(':');

  let next;

  if (type === 'daily') {
    next = dt.plus({ days: 1 });
  } else if (type === 'weekly') {
    const targetDay = DAY_MAP[param?.toUpperCase()];
    if (!targetDay) return null;
    // Maju hingga ke hari yang sesuai di minggu depan
    next = dt.plus({ weeks: 1 }).set({ weekday: targetDay });
  } else if (type === 'monthly') {
    const dayOfMonth = parseInt(param, 10);
    if (isNaN(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) return null;
    next = dt.plus({ months: 1 }).set({ day: dayOfMonth });
  } else {
    return null;
  }

  return {
    start: next.toISO(),
    end: null,
  };
}

/**
 * Hitung semua occurrences dari sekarang hingga N hari ke depan.
 * @param {string} rule
 * @param {Date|string} baseStart
 * @param {number} horizonDays - berapa hari ke depan (default 30)
 * @returns {string[]} array ISO string timestamps
 */
export function expandOccurrences(rule, baseStart, horizonDays = 30) {
  const results = [];
  const limit = DateTime.now().setZone(TZ).plus({ days: horizonDays });
  let current = baseStart;
  let next;

  while ((next = parseRecurrence(rule, current)) !== null) {
    const nextDt = DateTime.fromISO(next.start).setZone(TZ);
    if (nextDt > limit) break;
    results.push(next.start);
    current = next.start;
    // Safety: max 365 iterations
    if (results.length >= 365) break;
  }

  return results;
}

export default { parseRecurrence, expandOccurrences };

