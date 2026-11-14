import { describe, it, expect } from 'vitest';
import { formatRupiah, parseRupiah, extractRupiah } from '../src/utils/rupiah.js';

describe('utils/rupiah.js', () => {
  describe('parseRupiah - Format Wajib Fase 2', () => {
    it('memparsing 25rb menjadi 25000', () => {
      expect(parseRupiah('25rb')).toBe(25000);
      expect(parseRupiah('25 rb')).toBe(25000);
      expect(parseRupiah('25RB')).toBe(25000);
    });

    it('memparsing 25k menjadi 25000', () => {
      expect(parseRupiah('25k')).toBe(25000);
      expect(parseRupiah('25 k')).toBe(25000);
      expect(parseRupiah('25K')).toBe(25000);
    });

    it('memparsing 2,5 juta menjadi 2500000', () => {
      expect(parseRupiah('2,5 juta')).toBe(2500000);
      expect(parseRupiah('2.5 juta')).toBe(2500000);
      expect(parseRupiah('3 juta')).toBe(3000000);
    });

    it('memparsing 1,2jt menjadi 1200000', () => {
      expect(parseRupiah('1,2jt')).toBe(1200000);
      expect(parseRupiah('1.2 jt')).toBe(1200000);
      expect(parseRupiah('5jt')).toBe(5000000);
    });

    it('memparsing 1.200.000 menjadi 1200000', () => {
      expect(parseRupiah('1.200.000')).toBe(1200000);
      expect(parseRupiah('25.000')).toBe(25000);
      expect(parseRupiah('Rp 1.200.000')).toBe(1200000);
      expect(parseRupiah('rp. 25.000')).toBe(25000);
    });

    it('memparsing 500 perak menjadi 500', () => {
      expect(parseRupiah('500 perak')).toBe(500);
      expect(parseRupiah('1000 rupiah')).toBe(1000);
    });

    it('memparsing angka tanpa satuan', () => {
      expect(parseRupiah('15000')).toBe(15000);
      expect(parseRupiah('500')).toBe(500);
      expect(parseRupiah(25000)).toBe(25000);
    });

    it('menolak persentase', () => {
      expect(parseRupiah('50%')).toBeNull();
      expect(parseRupiah('20 %')).toBeNull();
      expect(parseRupiah('30 persen')).toBeNull();
    });

    it('menolak input tidak valid atau kosong', () => {
      expect(parseRupiah('')).toBeNull();
      expect(parseRupiah(null)).toBeNull();
      expect(parseRupiah(undefined)).toBeNull();
      expect(parseRupiah('halo')).toBeNull();
    });
  });

  describe('formatRupiah', () => {
    it('memformat angka positif', () => {
      expect(formatRupiah(25000)).toBe('Rp 25.000');
      expect(formatRupiah(1200000)).toBe('Rp 1.200.000');
      expect(formatRupiah(500)).toBe('Rp 500');
    });

    it('memformat BigInt', () => {
      expect(formatRupiah(3000000n)).toBe('Rp 3.000.000');
    });

    it('memformat angka 0', () => {
      expect(formatRupiah(0)).toBe('Rp 0');
      expect(formatRupiah(0n)).toBe('Rp 0');
    });

    it('memformat angka negatif', () => {
      expect(formatRupiah(-25000)).toBe('-Rp 25.000');
    });
  });

  describe('extractRupiah - Ekstraksi dari Kalimat', () => {
    it('mengekstrak nominal tunggal dari pesan', () => {
      expect(extractRupiah('kopi 18rb')).toEqual([18000]);
      expect(extractRupiah('makan siang 1,5 juta')).toEqual([1500000]);
      expect(extractRupiah('uang bulanan 3 juta')).toEqual([3000000]);
      expect(extractRupiah('bayar parkir 500 perak')).toEqual([500]);
      expect(extractRupiah('beli buku 15000')).toEqual([15000]);
    });

    it('mengekstrak beberapa nominal dari satu pesan', () => {
      expect(extractRupiah('kopi 18rb dan rokok 25k')).toEqual([18000, 25000]);
    });

    it('mengabaikan persentase saat alokasi', () => {
      expect(extractRupiah('bagi 50% kebutuhan, 20% tabungan, 30% hiburan')).toEqual([]);
    });

    it('mengekstrak dari kalimat transfer', () => {
      expect(extractRupiah('pindah 100rb dari hiburan ke kebutuhan')).toEqual([100000]);
    });

    it('mengekstrak dari kalimat ralat', () => {
      expect(extractRupiah('ralat jadi 30rb')).toEqual([30000]);
    });
  });
});

