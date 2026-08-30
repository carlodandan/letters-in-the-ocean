import { authorHash, networkBucket, readVisitor } from './identity.js';
import { limitsFor } from './quota.js';
import * as routes from './routes.js';
import { fail, json, utcDay } from './util.js';

const ID = '([A-Za-z0-9_-]{1,64})';
const MAX_BODY_BYTES = 8 * 1024;

/*
 * Routes that are nobody in particular. They read public numbers, so they never
 * mint a visitor and never set a cookie — which also means they cannot race a
 * real action into handing out a second identity.
 */
const ANONYMOUS = { identity: false };

/*
 * Routes that use an identity if the browser already has one but never create
 * one. A first visit can have several of these in flight at once (the shell's
 * orientation read, a bottle opened from a link), and a request that minted an
 * id would answer with a `set-cookie` that could land after — and overwrite —
 * the identity a real action was recorded against. Only the routes that spend
 * part of somebody's day are allowed to hand out an identity, and the interface
 * only ever has one of those in flight.
 */
const EXISTING = { identity: 'existing' };

const ROUTES = [
  ['GET', /^\/api\/health$/, () => json({ ok: true }), ANONYMOUS],
  ['GET', /^\/api\/state$/, (ctx) => routes.getState(ctx), EXISTING],
  ['GET', /^\/api\/stats$/, (ctx) => routes.getStats(ctx), ANONYMOUS],
  ['GET', /^\/api\/bottle\/random$/, (ctx) => routes.getRandomBottle(ctx)],
  ['GET', new RegExp(`^/api/bottle/${ID}$`), (ctx, [id]) => routes.getBottle(ctx, id), EXISTING],
  ['POST', /^\/api\/bottle$/, (ctx, _params, body) => routes.postBottle(ctx, body)],
  [
    'POST',
    new RegExp(`^/api/bottle/${ID}/reply$`),
    (ctx, [id], body) => routes.postReply(ctx, id, body),
    // Answering and sending on both require a letter you already found, so
    // neither can succeed for a visitor who does not exist yet.
    EXISTING,
  ],
  [
    'POST',
    new RegExp(`^/api/bottle/${ID}/release$`),
    (ctx, [id]) => routes.postRelease(ctx, id),
    EXISTING,
  ],
  [
    'POST',
    new RegExp(`^/api/bottle/${ID}/report$`),
    (ctx, [id], body) => routes.postReport(ctx, id, body),
  ],
  ['GET', /^\/api\/admin\/queue$/, (ctx) => routes.getModerationQueue(ctx)],
  [
    'POST',
    new RegExp(`^/api/admin/bottle/${ID}/moderate$`),
    (ctx, [id], body) => routes.postModeration(ctx, id, body),
  ],
];

function corsHeaders(request, env) {
  const origin = request.headers.get('origin');
  const allowed = (env.ALLOWED_ORIGIN ?? '').split(',').map((value) => value.trim());
  const headers = { vary: 'origin' };
  if (origin && (allowed.includes(origin) || allowed.includes('*'))) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-credentials'] = 'true';
    headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
    headers['access-control-allow-headers'] = 'content-type, authorization';
    headers['access-control-max-age'] = '86400';
  }
  return headers;
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'geolocation=(), microphone=(), camera=()',
  'cross-origin-resource-policy': 'same-site',
};

async function readBody(request) {
  const length = Number.parseInt(request.headers.get('content-length') ?? '0', 10);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return { tooLarge: true };
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { tooLarge: true };
  if (!text) return { body: {} };
  try {
    const parsed = JSON.parse(text);
    return { body: parsed && typeof parsed === 'object' ? parsed : {} };
  } catch {
    return { invalid: true };
  }
}

async function buildContext(request, env, { identity = true } = {}) {
  const url = new URL(request.url);
  const day = utcDay();
  const shared = {
    request,
    env,
    url,
    day,
    db: env.DB,
    kv: env.RATE_KV ?? null,
    country: request.cf?.country ?? null,
    limits: limitsFor(env),
  };

  if (!identity) {
    return { ...shared, visitorId: null, visitorIsNew: false, setCookie: null, network: null, authorHash: null };
  }

  const visitor = await readVisitor(request, env, { mint: identity !== 'existing' });

  // Without an identity there is nothing this visitor can have spent and nothing
  // they can have found: the quota reads 0 and every lookup misses. The network
  // bucket is still real, so the daily limit keeps telling the truth about the
  // connection even before anybody has a cookie.
  if (!visitor.id) {
    return {
      ...shared,
      visitorId: null,
      visitorIsNew: false,
      setCookie: null,
      network: await networkBucket(request, env, day),
      authorHash: null,
    };
  }

  const [network, author] = await Promise.all([
    networkBucket(request, env, day),
    authorHash(visitor.id, env),
  ]);

  return {
    ...shared,
    visitorId: visitor.id,
    visitorIsNew: visitor.isNew,
    setCookie: visitor.setCookie,
    network,
    authorHash: author,
  };
}

export async function handleRequest(request, env) {
  const cors = corsHeaders(request, env);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...cors, ...SECURITY_HEADERS } });
  }

  const url = new URL(request.url);
  const match = ROUTES.find(([method, pattern]) => method === request.method && pattern.test(url.pathname));

  if (!match) {
    const pathExists = ROUTES.some(([, pattern]) => pattern.test(url.pathname));
    const response = pathExists
      ? fail(405, 'method_not_allowed', 'That is not something you can do here.')
      : fail(404, 'not_found', 'Nothing here.');
    return decorate(response, cors, null);
  }

  if (!env.DB) {
    return decorate(
      fail(503, 'no_database', 'The ocean is not connected yet. Run the D1 migrations.'),
      cors,
      null,
    );
  }

  /*
   * Every identity, network bucket and author fingerprint is derived from this
   * secret. There is deliberately no fallback: an empty secret would sign
   * cookies anybody could forge, so the API refuses to run rather than run
   * insecurely. Locally it comes from worker/.dev.vars; in production from
   * `wrangler secret put SESSION_SECRET`.
   */
  if (!env.SESSION_SECRET) {
    console.error('missing_session_secret');
    return decorate(
      fail(503, 'not_configured', 'The ocean is not ready. SESSION_SECRET is not set.'),
      cors,
      null,
    );
  }

  let ctx;
  try {
    const [, pattern, handler, options] = match;
    ctx = await buildContext(request, env, options ?? {});
    const params = url.pathname.match(pattern)?.slice(1) ?? [];

    let body;
    if (request.method === 'POST') {
      const parsed = await readBody(request);
      if (parsed.tooLarge) {
        return decorate(fail(413, 'body_too_large', 'That is more than a bottle can hold.'), cors, ctx);
      }
      if (parsed.invalid) {
        return decorate(fail(400, 'body_invalid', 'The request could not be read.'), cors, ctx);
      }
      body = parsed.body;
    }

    return decorate(await handler(ctx, params, body), cors, ctx);
  } catch (error) {
    console.error('request_failed', request.method, url.pathname, error?.stack ?? error);
    return decorate(fail(500, 'ocean_unsettled', 'Something went wrong out at sea. Try again.'), cors, ctx);
  }
}

/** Adds CORS, security headers and the session cookie to whatever came back. */
function decorate(response, cors, ctx) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries({ ...cors, ...SECURITY_HEADERS })) {
    headers.set(key, value);
  }
  if (ctx?.setCookie) headers.append('set-cookie', ctx.setCookie);
  return new Response(response.body, { status: response.status, headers });
}

export default {
  fetch: handleRequest,
};
