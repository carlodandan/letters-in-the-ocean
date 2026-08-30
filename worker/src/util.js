/**
 * Small shared helpers. No dependencies — everything here is available in the
 * Workers runtime (and in Node 22+, which is how the tests exercise it).
 */

const encoder = new TextEncoder();

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(init.headers ?? {}),
    },
  });
}

/** Errors are always shaped `{ error: { code, message, ... } }`. */
export function fail(status, code, message, extra = {}) {
  return json({ error: { code, message, ...extra } }, { status });
}

export function uuid() {
  return crypto.randomUUID();
}

export function nowIso() {
  return new Date().toISOString();
}

/**
 * Quota day key. Deliberately UTC: a single global reset avoids a visitor
 * hopping time zones to earn a second bottle.
 */
export function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function b64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

export async function hmac(secret, message) {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return b64url(new Uint8Array(signature));
}

/** Keyed hash, truncated. Used for pseudonymous identifiers we never reverse. */
export async function keyedHash(secret, value, length = 32) {
  return (await hmac(secret, value)).slice(0, length);
}

/** Constant-time-ish comparison, so signature checks don't leak by timing. */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function intVar(value, fallback, { min = 0, max = 1000 } = {}) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function parseCookies(header) {
  const jar = new Map();
  if (!header) return jar;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    jar.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return jar;
}

export function serializeCookie(name, value, options = {}) {
  const bits = [`${name}=${value}`, `Path=${options.path ?? '/'}`];
  if (options.maxAge != null) bits.push(`Max-Age=${options.maxAge}`);
  bits.push(`SameSite=${options.sameSite ?? 'Lax'}`);
  if (options.httpOnly !== false) bits.push('HttpOnly');
  if (options.secure !== false) bits.push('Secure');
  return bits.join('; ');
}
