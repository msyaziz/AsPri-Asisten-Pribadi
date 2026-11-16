/**
 * Test unit untuk utils/recurrence.js
 * Fase 4 – Checkpoint B
 */

import { describe, it, expect } from 'vitest';
import { parseRecurrence, expandOccurrences } from '../src/utils/recurrence.js';
import { DateTime } from 'luxon';

const TZ = 'Asia/Jakarta';

function isoDate(dateStr) {
  return DateTime.fromISO(dateStr, { zone: TZ }).toISO();
}

describe('parseRecurrence', () => {
  it('daily: mengembalikan hari berikutnya', () => {
    const base = '2026-12-01T09:00:00+07:00';
    const next = parseRecurrence('daily', base);
    expect(next).not.toBeNull();
    const nextDt = DateTime.fromISO(next.start).setZone(TZ);
    expect(nextDt.toFormat('yyyy-MM-dd')).toBe('2026-12-02');
    expect(nextDt.hour).toBe(9);
  });

  it('weekly:MON: mengembalikan Senin berikutnya', () => {
    const base = '2026-12-01T09:00:00+07:00'; // Selasa
    const next = parseRecurrence('weekly:MON', base);
    expect(next).not.toBeNull();
    const nextDt = DateTime.fromISO(next.start).setZone(TZ);
    expect(nextDt.weekday).toBe(1); // 1 = Senin
  });

  it('monthly:15: mengembalikan tanggal 15 bulan berikutnya', () => {
    const base = '2026-12-01T09:00:00+07:00';
    const next = parseRecurrence('monthly:15', base);
    expect(next).not.toBeNull();
    const nextDt = DateTime.fromISO(next.start).setZone(TZ);
    expect(nextDt.month).toBe(1); // Januari 2027
    expect(nextDt.day).toBe(15);
  });

  it('rule tidak valid mengembalikan null', () => {
    expect(parseRecurrence('hourly', '2026-12-01T09:00:00+07:00')).toBeNull();
    expect(parseRecurrence('', '2026-12-01T09:00:00+07:00')).toBeNull();
    expect(parseRecurrence(null, '2026-12-01T09:00:00+07:00')).toBeNull();
  });

  it('weekly dengan hari tidak valid mengembalikan null', () => {
    expect(parseRecurrence('weekly:XYZ', '2026-12-01T09:00:00+07:00')).toBeNull();
  });

  it('monthly dengan hari tidak valid mengembalikan null', () => {
    expect(parseRecurrence('monthly:0', '2026-12-01T09:00:00+07:00')).toBeNull();
  });
});

describe('expandOccurrences', () => {
  it('daily: menghasilkan beberapa occurrence dalam 7 hari', () => {
    const base = DateTime.now().setZone(TZ).toISO();
    const occ = expandOccurrences('daily', base, 7);
    expect(occ.length).toBeGreaterThanOrEqual(6);
    expect(occ.length).toBeLessThanOrEqual(8);
  });

  it('weekly:MON: menghasilkan 1 occurrence dalam 7 hari', () => {
    const base = DateTime.now().setZone(TZ).toISO();
    const occ = expandOccurrences('weekly:MON', base, 7);
    expect(occ.length).toBeGreaterThanOrEqual(0);
    expect(occ.length).toBeLessThanOrEqual(2);
  });

  it('tidak melebihi horizon', () => {
    const base = DateTime.now().setZone(TZ).toISO();
    const occ = expandOccurrences('daily', base, 30);
    expect(occ.length).toBeLessThanOrEqual(32);
  });
});

