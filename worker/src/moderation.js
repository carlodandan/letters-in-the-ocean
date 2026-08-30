/**
 * Moderation pipeline (stage 3 of: validate -> rate limit -> moderate -> ocean).
 *
 * This module is pure and synchronous so it can be unit tested and, later,
 * wrapped by an async classifier without changing any callers. The contract:
 *
 *   moderate(text, options) -> { decision, score, reasons, care }
 *     decision: 'approved' | 'pending' | 'rejected'
 *
 * Only 'approved' letters are ever discoverable. 'pending' letters wait for a
 * human (or a future automated classifier) at /api/admin/queue.
 *
 * The slur / explicit lexicon is intentionally NOT hardcoded here. Supply it
 * through the MODERATION_BLOCKLIST var (comma separated) or swap in a hosted
 * classifier — a list baked into source ages badly and cannot be tuned without
 * a deploy.
 */

const RULES = [
  // --- Hard stops: never discoverable -------------------------------------
  {
    reason: 'link',
    score: 1,
    test: /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|ru|xyz|top|link|shop|info|co|me|ly|gg)\b)/i,
  },
  { reason: 'contact', score: 1, test: /[\w.+-]+@[\w-]+\.[a-z]{2,}|\+?\d[\d\s().-]{8,}\d/i },
  {
    reason: 'promotion',
    score: 1,
    test: /\b(subscribe|follow me|dm me|my (channel|onlyfans|discord|telegram)|promo ?code|use code|click here|sign up now|buy now|limited offer)\b/i,
  },
  {
    reason: 'spam',
    score: 1,
    test: /\b(crypto|bitcoin|forex|casino|betting|viagra|seo services|make \$?\d+ ?(a|per) (day|week)|work from home|investment opportunity|giveaway|airdrop)\b/i,
  },
  {
    reason: 'harassment',
    score: 1,
    test: /\b(kill your ?self|kys|you should die|nobody loves you|(you'?re?|you are|ur) (worthless|pathetic|disgusting|garbage|nothing)|i hope you (die|suffer))\b/i,
  },
  {
    reason: 'hate',
    score: 1,
    test: /\b(kill all|gas the|exterminate the|subhuman|go back to your (country|own country)|\w+s? deserve to die)\b/i,
  },
  {
    reason: 'sexual',
    score: 1,
    test: /\b(nudes|sexting|hardcore porn|send pics|horny|cum on|blowjob)\b/i,
  },
  {
    reason: 'disturbing',
    score: 1,
    test: /\b(how to (make|build) a (bomb|weapon)|behead|torture (you|them)|graphic (gore|mutilation))\b/i,
  },

  // --- Needs a person to look: held, not rejected ---------------------------
  // Distress is welcome in this ocean — "I'm frightened I'm falling behind" is
  // exactly the kind of letter that deserves a reply. But an explicit crisis
  // statement should not be handed to a random stranger unreviewed.
  {
    reason: 'self_harm',
    score: 0.5,
    care: true,
    test: /\b(i want to die|i want to kill myself|end my life|kill myself|suicidal|cut myself|self ?harm|not be here anymore)\b/i,
  },
  { reason: 'medical_advice', score: 0.45, test: /\b(stop taking your|dosage|mg of|prescri(be|ption))\b/i },

  // --- Soft signals: nudged toward review, never rejected alone -------------
  { reason: 'repeated_character', score: 0.35, test: /(.)\1{5,}/ },
  { reason: 'repeated_word', score: 0.35, test: /\b(\w{2,})\b(?:\s+\1\b){3,}/i },
  { reason: 'keyboard_mash', score: 0.4, test: /(asdf|qwer|zxcv|hjkl|1234){2,}/i },
  { reason: 'unbroken_token', score: 0.25, test: /\S{34,}/ },
  {
    reason: 'placeholder',
    score: 0.45,
    test: /^\s*((test|hello+|hi|hey|asdf+|abc+|blah|lorem ipsum)[\s.!?,]*){1,4}$/i,
  },
];

const REJECT_AT = 1;
const REVIEW_AT = 0.4;

function shoutScore(text) {
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length < 20) return 0;
  const upper = letters.replace(/[^\p{Lu}]/gu, '').length;
  return upper / letters.length > 0.7 ? 0.2 : 0;
}

function blocklistHit(text, blocklist) {
  const haystack = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  return blocklist.some((term) => term && haystack.includes(` ${term} `));
}

export function parseBlocklist(raw) {
  return String(raw ?? '')
    .split(',')
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
}

export function moderate(text, { blocklist = [] } = {}) {
  const reasons = [];
  let score = 0;
  let care = false;

  for (const rule of RULES) {
    if (!rule.test.test(text)) continue;
    reasons.push(rule.reason);
    score += rule.score;
    if (rule.care) care = true;
  }

  const shout = shoutScore(text);
  if (shout > 0) {
    reasons.push('shouting');
    score += shout;
  }

  if (blocklist.length > 0 && blocklistHit(text, blocklist)) {
    reasons.push('blocklist');
    score += 1;
  }

  score = Math.round(Math.min(score, 3) * 100) / 100;

  let decision = 'approved';
  if (score >= REJECT_AT) decision = 'rejected';
  else if (score >= REVIEW_AT) decision = 'pending';

  return { decision, score, reasons, care };
}

/** Copy shown to the writer. Never explains which rule fired — that is a map. */
export function decisionMessage(decision, care) {
  if (decision === 'rejected') {
    return 'This one can’t be released. The ocean is for kindness, encouragement and honest thoughts — try saying it another way.';
  }
  if (care) {
    return 'Thank you for trusting the ocean with that. A person will read it before it drifts. If you need someone now, please reach out to a local crisis line — in the US you can call or text 988.';
  }
  if (decision === 'pending') {
    return 'Your letter is being read over before it drifts. It should be out there shortly.';
  }
  return 'Your letter is out there now.';
}
