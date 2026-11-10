/**
 * Helper manipulasi dan validasi WhatsApp JID / LID.
 * Spesifikasi: docs/01-fase1-bot-dasar.md bagian 8.2
 */

/**
 * Normalisasi JID: buang akhiran :device (mis. :12) sebelum tanda @.
 * Contoh: 62812345:12@s.whatsapp.net -> 62812345@s.whatsapp.net
 *         123456:1@lid -> 123456@lid
 * @param {string} jid
 * @returns {string}
 */
export function normalizeJid(jid) {
  if (!jid || typeof jid !== 'string') return '';
  const trimmed = jid.trim();
  const atIdx = trimmed.indexOf('@');
  if (atIdx === -1) return trimmed;

  const user = trimmed.slice(0, atIdx);
  const server = trimmed.slice(atIdx + 1);
  const colonIdx = user.indexOf(':');
  const cleanUser = colonIdx !== -1 ? user.slice(0, colonIdx) : user;

  return `${cleanUser}@${server}`;
}

/**
 * Cek apakah JID adalah grup WhatsApp (@g.us).
 * @param {string} jid
 * @returns {boolean}
 */
export function isGroup(jid) {
  if (!jid || typeof jid !== 'string') return false;
  return normalizeJid(jid).endsWith('@g.us');
}

/**
 * Cek apakah JID adalah pesan individu (@s.whatsapp.net atau @lid).
 * @param {string} jid
 * @returns {boolean}
 */
export function isIndividual(jid) {
  if (!jid || typeof jid !== 'string') return false;
  const normalized = normalizeJid(jid);
  return normalized.endsWith('@s.whatsapp.net') || normalized.endsWith('@lid');
}
