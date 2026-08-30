export const MIN_LENGTH = 8;
export const MAX_LENGTH = 500;

// `Cc` is the C0/C1 control block; `Cf` covers the zero-width family, bidi
// overrides, the word joiner, the soft hyphen and the BOM — the usual tools for
// hiding text from a moderation filter. Both are removed before moderation runs.
const CONTROL_CHARS = /\p{Cc}/gu;
const FORMAT_CHARS = /\p{Cf}/gu;
const TRAILING_SPACES = /[ \t]+$/gm;
const MANY_NEWLINES = /\n{3,}/g;
const MANY_SPACES = /[ \t]{3,}/g;
const HAS_LETTER = /\p{L}/u;

/** Grapheme-aware length, so a family emoji counts as one character. */
export function countCharacters(text) {
  if (typeof Intl?.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
    let count = 0;
    // eslint-disable-next-line no-unused-vars
    for (const _segment of segmenter.segment(text)) count += 1;
    return count;
  }
  return [...text].length;
}

/** Normalise a submitted letter. Runs before moderation, never after. */
export function normalizeMessage(raw) {
  return String(raw ?? '')
    .normalize('NFC')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .replace(CONTROL_CHARS, (char) => (char === '\n' || char === '\t' ? char : ''))
    .replace(FORMAT_CHARS, '')
    .replaceAll('\t', ' ')
    .replace(TRAILING_SPACES, '')
    .replace(MANY_SPACES, '  ')
    .replace(MANY_NEWLINES, '\n\n')
    .trim();
}

export function validateMessage(raw) {
  if (typeof raw !== 'string') {
    return invalid('message_required', 'Write a few words before sealing the bottle.');
  }

  const value = normalizeMessage(raw);
  const length = countCharacters(value);

  if (length === 0) {
    return invalid('message_required', 'Write a few words before sealing the bottle.');
  }
  if (length < MIN_LENGTH) {
    return invalid(
      'message_too_short',
      `A letter needs at least ${MIN_LENGTH} characters. Add a little more.`,
    );
  }
  if (length > MAX_LENGTH) {
    return invalid(
      'message_too_long',
      `A letter can hold ${MAX_LENGTH} characters. Trim ${length - MAX_LENGTH} and try again.`,
      { length },
    );
  }
  if (!HAS_LETTER.test(value)) {
    return invalid('message_unreadable', 'Write your letter in words, so someone can read it.');
  }

  return { ok: true, value, length };
}

const REASONS = ['spam', 'harassment', 'hate', 'sexual', 'scam', 'disturbing', 'other'];

export function validateReport(body) {
  const reason = String(body?.reason ?? '').toLowerCase();
  if (!REASONS.includes(reason)) {
    return invalid('reason_invalid', 'Choose a reason for the report.');
  }
  const note = normalizeMessage(body?.note ?? '').slice(0, 280);
  return { ok: true, value: { reason, note: note || null } };
}

export function reportReasons() {
  return [...REASONS];
}

function invalid(code, message, extra = {}) {
  return { ok: false, error: { code, message, ...extra } };
}
