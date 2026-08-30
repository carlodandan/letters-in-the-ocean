import { hmac, keyedHash, parseCookies, safeEqual, serializeCookie, utcDay, uuid } from './util.js';

const COOKIE_NAME = 'lio_visitor';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 400;
const VERSION = 'v1';

/**
 * Anonymous identity.
 *
 * There is no account and no profile. A visitor is an opaque random id carried
 * in an HttpOnly, signed cookie. Signing means a client cannot mint ids that
 * look server-issued; HttpOnly keeps page scripts (and any XSS) away from it.
 *
 * Clearing cookies still produces a fresh identity — that is why the daily
 * limit also considers a per-day IP bucket (see quota.js). Neither signal is
 * trusted alone, and no client-side value is trusted at all.
 *
 * `mint: false` reads an identity without creating one. Only requests that
 * actually do something hand out an identity, because a browser arriving with no
 * cookie may have several requests in flight at once: if each of them minted,
 * each would answer with a different `set-cookie`, the last one would win, and
 * whatever the others recorded would belong to an id the browser had already
 * thrown away. See the route table in index.js.
 */
export async function readVisitor(request, env, { mint = true } = {}) {
  const raw = parseCookies(request.headers.get('cookie')).get(COOKIE_NAME);
  const parsed = await verifyToken(raw, env.SESSION_SECRET);
  if (parsed) return { id: parsed.id, issuedAt: parsed.issuedAt, isNew: false, setCookie: null };
  if (!mint) return { id: null, issuedAt: null, isNew: false, setCookie: null };

  const id = uuid();
  const issuedAt = Math.floor(Date.now() / 1000);
  const token = await signToken(id, issuedAt, env.SESSION_SECRET);
  const url = new URL(request.url);
  const secure =
    url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1';

  return {
    id,
    issuedAt,
    isNew: true,
    setCookie: serializeCookie(COOKIE_NAME, token, {
      maxAge: COOKIE_MAX_AGE,
      httpOnly: true,
      secure,
      sameSite: 'Lax',
    }),
  };
}

export async function signToken(id, issuedAt, secret) {
  const payload = `${VERSION}.${id}.${issuedAt}`;
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function verifyToken(raw, secret) {
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 4) return null;
  const [version, id, issuedAt, signature] = parts;
  if (version !== VERSION || !id || !issuedAt) return null;

  const expected = await hmac(secret, `${version}.${id}.${issuedAt}`);
  if (!safeEqual(signature, expected)) return null;

  const seconds = Number.parseInt(issuedAt, 10);
  if (!Number.isFinite(seconds)) return null;
  return { id, issuedAt: seconds };
}

/**
 * A coarse, rotating bucket for the visitor's network origin. Re-salted every
 * UTC day so it cannot be used to follow somebody across days, which is all the
 * rate limiter needs it for.
 */
export async function networkBucket(request, env, day = utcDay()) {
  const ip =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  return `net:${await keyedHash(env.SESSION_SECRET, `${day}:${ip}`, 24)}`;
}

/** Author fingerprint stored on a bottle. Never returned by the API. */
export async function authorHash(visitorId, env) {
  return keyedHash(env.SESSION_SECRET, `author:${visitorId}`, 32);
}

export const cookieName = COOKIE_NAME;
