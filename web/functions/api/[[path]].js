/*
 * `/api/*` on the site's own origin.
 *
 * The client asks for `/api/state` relative to wherever it is served from, which
 * is the whole point: one origin means the signed `SameSite=Lax` session cookie
 * is a first-party cookie and no CORS is involved. But Pages only knows about
 * static files. Without something answering `/api/*` it treats the path as a
 * client-side route, serves `index.html` with a 200, and the browser tries to
 * read HTML as JSON — which is exactly the "we do not speak that language"
 * failure the client reports when `JSON.parse` gives up.
 *
 * So this hands the request, untouched, to the API worker. Two ways in:
 *
 *   API         a service binding to the worker (preferred). The request never
 *               leaves Cloudflare's network, the worker sees the original
 *               headers — `cf-connecting-ip` included, which the daily limit's
 *               network bucket depends on — and the worker needs no public URL
 *               of its own at all.
 *   API_ORIGIN  the worker's own address, e.g.
 *               https://letters-in-the-ocean-api.<subdomain>.workers.dev.
 *               A plain variable, so the site can be brought up before the
 *               binding exists.
 *
 * If neither is configured we answer with the API's own error shape rather than
 * letting Pages serve the app shell again: a misconfiguration should read like a
 * misconfiguration, in JSON, on the first request.
 */
export const onRequest = async ({ request, env }) => {
  if (env.API) return env.API.fetch(request);

  if (env.API_ORIGIN) {
    const here = new URL(request.url);
    const there = new URL(here.pathname + here.search, env.API_ORIGIN);
    const forwarded = new Request(there, request);
    // The subrequest is a hop nobody asked for, so it must not negotiate an
    // encoding on the visitor's behalf: without this the worker answers the hop
    // in brotli and the body is handed on still compressed, to a client that may
    // never have said it could read that.
    forwarded.headers.set('accept-encoding', 'identity');
    return fetch(forwarded);
  }

  return Response.json(
    {
      error: {
        code: 'api_not_bound',
        message: 'The ocean is not connected to this shore yet.',
      },
    },
    { status: 503, headers: { 'cache-control': 'no-store' } },
  );
};
