import { authorHash, networkBucket, readVisitor } from './identity.js';
import { limitsFor } from './quota.js';
import * as routes from './routes.js';
import { fail, json, utcDay } from './util.js';

const ID = '([A-Za-z0-9_-]{1,64})';
const MAX_BODY_BYTES = 8 * 1024;

const ROUTES = [
  ['GET', /^\/api\/health$/, () => json({ ok: true })],
  ['GET', /^\/api\/state$/, (ctx) => routes.getState(ctx)],
  ['GET', /^\/api\/stats$/, (ctx) => routes.getStats(ctx)],
  ['GET', /^\/api\/bottle\/random$/, (ctx) => routes.getRandomBottle(ctx)],
  ['GET', new RegExp(`^/api/bottle/${ID}$`), (ctx, [id]) => routes.getBottle(ctx, id)],
  ['POST', /^\/api\/bottle$/, (ctx, _params, body) => routes.postBottle(ctx, body)],
  [
    'POST',
    new RegExp(`^/api/bottle/${ID}/reply$`),
    (ctx, [id], body) => routes.postReply(ctx, id, body),
  ],
  ['POST', new RegExp(`^/api/bottle/${ID}/release$`), (ctx, [id]) => routes.postRelease(ctx, id)],
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

async function buildContext(request, env) {
  const url = new URL(request.url);
  const day = utcDay();
  const visitor = await readVisitor(request, env);
  const [network, author] = await Promise.all([
    networkBucket(request, env, day),
    authorHash(visitor.id, env),
  ]);

  return {
    request,
    env,
    url,
    day,
    db: env.DB,
    kv: env.RATE_KV ?? null,
    visitorId: visitor.id,
    visitorIsNew: visitor.isNew,
    setCookie: visitor.setCookie,
    network,
    authorHash: author,
    country: request.cf?.country ?? null,
    limits: limitsFor(env),
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

  let ctx;
  try {
    ctx = await buildContext(request, env);
    const [, pattern, handler] = match;
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
