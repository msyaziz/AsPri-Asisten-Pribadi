/**
 * Ekstraksi konten pesan dari payload Baileys WhatsApp.
 * Spesifikasi: docs/01-fase1-bot-dasar.md bagian 8.5
 *
 * @param {any} msg WebMessageInfo
 * @returns {{ text: string, hasMedia: boolean, mediaType: string|null, quotedStanzaId: string|null }}
 */
export function extractContent(msg) {
  if (!msg || !msg.message) {
    return { text: '', hasMedia: false, mediaType: null, quotedStanzaId: null };
  }

  let m = msg.message;

  // Buka pembungkus pesan (ephemeral, viewOnce, dll)
  while (
    m.ephemeralMessage?.message ||
    m.viewOnceMessage?.message ||
    m.viewOnceMessageV2?.message ||
    m.documentWithCaptionMessage?.message
  ) {
    m =
      m.ephemeralMessage?.message ||
      m.viewOnceMessage?.message ||
      m.viewOnceMessageV2?.message ||
      m.documentWithCaptionMessage?.message;
  }

  // Abaikan reaksi / protokol pesan
  if (m.reactionMessage || m.protocolMessage || m.pollUpdateMessage) {
    return { text: '', hasMedia: false, mediaType: null, quotedStanzaId: null };
  }

  let text = '';
  let hasMedia = false;
  let mediaType = null;
  let quotedStanzaId = null;

  if (typeof m.conversation === 'string') {
    text = m.conversation;
  } else if (m.extendedTextMessage) {
    text = m.extendedTextMessage.text || '';
    quotedStanzaId = m.extendedTextMessage.contextInfo?.stanzaId || null;
  } else if (m.imageMessage) {
    hasMedia = true;
    mediaType = 'image';
    text = m.imageMessage.caption || '';
    quotedStanzaId = m.imageMessage.contextInfo?.stanzaId || null;
  } else if (m.videoMessage) {
    hasMedia = true;
    mediaType = 'video';
    text = m.videoMessage.caption || '';
    quotedStanzaId = m.videoMessage.contextInfo?.stanzaId || null;
  } else if (m.audioMessage) {
    hasMedia = true;
    mediaType = 'audio';
    quotedStanzaId = m.audioMessage.contextInfo?.stanzaId || null;
  } else if (m.documentMessage) {
    hasMedia = true;
    mediaType = 'document';
    text = m.documentMessage.caption || '';
    quotedStanzaId = m.documentMessage.contextInfo?.stanzaId || null;
  } else if (m.stickerMessage) {
    hasMedia = true;
    mediaType = 'sticker';
  }

  return {
    text: text.trim(),
    hasMedia,
    mediaType,
    quotedStanzaId,
  };
}

export default extractContent;
