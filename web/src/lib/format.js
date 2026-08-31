/** Locale-aware formatting. Nothing here hardcodes an English or US format. */

const numberFormat = new Intl.NumberFormat(undefined);
const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function formatCount(value) {
  return numberFormat.format(Number(value) || 0);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Coarse age of a letter — "last week", "3 months ago". Never a clock time: the
 * exact minute somebody wrote something is nobody else's business.
 */
export function formatAge(isoDate) {
  if (!isoDate) return '';
  const then = new Date(`${String(isoDate).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(then.getTime())) return '';

  const days = Math.round((then.getTime() - Date.now()) / DAY_MS);
  if (days > -1) return relativeFormat.format(0, 'day');
  if (days > -7) return relativeFormat.format(days, 'day');
  if (days > -31) return relativeFormat.format(Math.round(days / 7), 'week');
  if (days > -365) return relativeFormat.format(Math.round(days / 30), 'month');
  return relativeFormat.format(Math.round(days / 365), 'year');
}

/** Splits a letter into paragraphs for the reveal, preserving the writer's breaks. */
export function toParagraphs(message) {
  return String(message ?? '')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

/*
 * Counted in graphemes, exactly as the worker counts them, so an emoji or an
 * accented character costs the writer the same here as it does on the server and
 * the counter never disagrees with the answer.
 */
const segmenter =
  typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

export function countCharacters(text) {
  const value = String(text ?? '');
  if (!segmenter) return [...value].length;
  let count = 0;
  // eslint-disable-next-line no-unused-vars
  for (const _ of segmenter.segment(value)) count += 1;
  return count;
}
