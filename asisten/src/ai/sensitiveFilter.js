/**
 * Filter data sensitif sebelum diproses oleh AI (Aturan Emas #14).
 * Spesifikasi: docs/01-fase1-bot-dasar.md bagian 8.9
 */

const SENSITIVE_KEYWORDS_REGEX = /\b(pin|otp|password|kata\s+sandi|cvv|kode\s+verifikasi)\b/i;
const LONG_DIGITS_REGEX = /\b\d{12,}\b/;
const CARD_OR_ACCOUNT_FORMAT_REGEX = /(?:\d[ -]?){12,}/;

/**
 * Cek apakah teks mengandung data sensitif.
 * @param {string} text
 * @returns {boolean}
 */
export function isSensitive(text) {
  if (!text || typeof text !== 'string') return false;

  if (SENSITIVE_KEYWORDS_REGEX.test(text)) {
    return true;
  }

  if (LONG_DIGITS_REGEX.test(text)) {
    return true;
  }

  // Cek apakah ada kelompok angka terpisah spasi/strip dengan total >= 12 digit
  const matches = text.match(CARD_OR_ACCOUNT_FORMAT_REGEX);
  if (matches) {
    const digitsOnly = matches[0].replace(/\D/g, '');
    if (digitsOnly.length >= 12) {
      return true;
    }
  }

  return false;
}

export const SENSITIVE_WARNING_MESSAGE =
  'Aku nggak mau memproses info sensitif seperti PIN/OTP/nomor kartu ya. Hapus dulu dari pesanmu 🙏';

export default isSensitive;
