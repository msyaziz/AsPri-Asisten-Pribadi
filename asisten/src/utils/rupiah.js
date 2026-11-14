/**
 * Utilitas Parser dan Formatter Rupiah.
 * Sesuai 00-konteks-aplikasi.md dan 02-fase2-keuangan-inti.md.
 */

/**
 * Format nominal angka/bigint ke format Rupiah Indonesia: "Rp 25.000"
 * @param {number|bigint|string} amount
 * @returns {string}
 */
export function formatRupiah(amount) {
  if (amount === null || amount === undefined || amount === '') {
    return 'Rp 0';
  }

  try {
    const num = typeof amount === 'bigint' ? amount : BigInt(Math.round(Number(amount)));
    const isNegative = num < 0n;
    const absNum = isNegative ? -num : num;
    const formatted = absNum.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return isNegative ? `-Rp ${formatted}` : `Rp ${formatted}`;
  } catch {
    return 'Rp 0';
  }
}

/**
 * Parsing teks satu nominal menjadi integer Rupiah.
 * Menangani: 25rb, 25k, 2,5 juta, 1,2jt, 1.200.000, 500 perak, 15000, Rp 25.000
 * @param {string|number} input
 * @returns {number|null} Nilai integer rupiah atau null bila tidak valid.
 */
export function parseRupiah(input) {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.round(input) : null;
  }
  if (typeof input !== 'string') return null;

  let text = input.trim().toLowerCase();
  if (!text) return null;

  // Persentase bukan nominal rupiah
  if (/%|persen\b/.test(text)) return null;

  // Hapus awalan Rp atau Rp.
  text = text.replace(/^rp\.?\s*/i, '');

  // Cek satuan / suffix di akhir atau setelah angka
  const suffixRegex = /(miliar|milyar|juta|jt|ribu|rb|k|perak|rupiah)\b/i;
  const matchSuffix = text.match(suffixRegex);

  let multiplier = 1;
  let numStr = text;

  if (matchSuffix) {
    const s = matchSuffix[1].toLowerCase();
    numStr = text.slice(0, matchSuffix.index).trim();
    if (s === 'miliar' || s === 'milyar') multiplier = 1_000_000_000;
    else if (s === 'juta' || s === 'jt') multiplier = 1_000_000;
    else if (s === 'ribu' || s === 'rb' || s === 'k') multiplier = 1_000;
    else if (s === 'perak' || s === 'rupiah') multiplier = 1;
  }

  // Jika ada pengali (juta, rb, k, dll), desimal bisa koma atau titik (contoh: 2,5 jt atau 2.5 jt)
  if (multiplier > 1) {
    // Format pemisah ribuan sebelum suffix: contoh 1.500 rb
    if (/^\d{1,3}(\.\d{3})+$/.test(numStr)) {
      numStr = numStr.replace(/\./g, '');
    } else {
      numStr = numStr.replace(',', '.');
    }
    const val = parseFloat(numStr);
    if (Number.isNaN(val)) return null;
    return Math.round(val * multiplier);
  }

  // Tanpa pengali (atau perak/rupiah)
  // Menangani format ribuan bertitik: "1.200.000" atau "25.000"
  if (/^\d{1,3}(\.\d{3})+(\,\d+)?$/.test(numStr)) {
    numStr = numStr.split(',')[0].replace(/\./g, '');
  } else if (/^\d+([.,]\d+)?$/.test(numStr)) {
    numStr = numStr.replace(',', '.');
  } else {
    numStr = numStr.replace(/[^\d]/g, '');
  }

  const val = parseInt(numStr, 10);
  return Number.isNaN(val) ? null : val;
}

/**
 * Ekstrak semua nilai nominal rupiah yang ada di dalam sebuah kalimat.
 * Berguna untuk cross-check nominal AI dengan regex parser backend.
 * @param {string} text
 * @returns {number[]} Daftar nominal rupiah yang ditemukan.
 */
export function extractRupiah(text) {
  if (!text || typeof text !== 'string') return [];

  const results = [];
  // Regex untuk menangkap angka dengan satuan (rb, k, jt, perak) atau format ribuan bertitik
  const regex = /(?:rp\.?\s*)?(\d+(?:[.,]\d+)?\s*(?:miliar|milyar|juta|jt|ribu|rb|k|perak|rupiah)\b|\d{1,3}(?:\.\d{3})+(?!\s*(?:%|persen))|(?:rp\.?\s*)\d+(?!\s*(?:%|persen)))/gi;

  let match;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[0];
    const tail = text.slice(regex.lastIndex, regex.lastIndex + 10);
    // Abaikan jika diikuti oleh % atau persen
    if (/^\s*(%|persen\b)/i.test(tail)) continue;

    const val = parseRupiah(raw);
    if (val !== null && !Number.isNaN(val)) {
      results.push(val);
    }
  }

  // Fallback: bila belum ada yang cocok, periksa angka polos (misal "beli buku 15000")
  if (results.length === 0) {
    const plainRegex = /(?:^|\s)(\d{3,9})(?!\s*(?:%|persen|\d|[a-zA-Z]))/g;
    let pMatch;
    while ((pMatch = plainRegex.exec(text)) !== null) {
      const val = parseInt(pMatch[1], 10);
      if (!Number.isNaN(val)) results.push(val);
    }
  }

  return results;
}
