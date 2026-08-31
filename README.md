# Letters in the Ocean

A quiet corner of the internet where strangers leave small pieces of kindness for
each other. You can do two things here: find one bottle a day, and leave one
letter a day. There are no accounts, no profiles, no likes and no feed.

- **Frontend** — React + Vite, deployed to Cloudflare Pages.
- **API** — a single Cloudflare Worker.
- **Storage** — D1 (SQLite) for letters, interactions, journeys and reports; KV
  (optional) for a burst limiter and a stats cache.

## Layout

```
web/                  React + Vite client
  src/components/     Ocean canvas, bottle, letter, sound toggle, report dialog
  src/scenes/         Landing, FindScene, WriteScene
  src/lib/            audio, motion, sky, formatting
  src/styles/         tokens -> base -> app -> bottle -> letter
  functions/api/      the Pages Function that serves /api/* from the site's origin
  public/_routes.json keeps every other path off that function
  scripts/journey.mjs drives the real app in a headless browser (see Testing)
worker/
  src/index.js        routing, CORS, security headers, request context
  src/routes.js       one function per endpoint
  src/identity.js     signed anonymous cookie, network bucket, author hash
  src/quota.js        the daily limits
  src/moderation.js   the filter that decides approved / pending / rejected
  migrations/         D1 schema and a small seed of starter letters
```

## Quick start

```bash
npm install

# One-time: create the D1 database and the KV namespace, then paste the ids
# they print into worker/wrangler.toml.
npx wrangler d1 create letters-in-the-ocean
npx wrangler kv namespace create RATE_KV

npm run db:local          # apply migrations to the local D1
npm run dev:api           # worker on http://127.0.0.1:8787
npm run dev               # client on http://127.0.0.1:5173
```

Vite proxies `/api` to the worker, so the browser sees one origin and the session
cookie behaves in development exactly as it does in production.

## Configuration

`worker/.dev.vars` holds the local secrets and is not committed:

```
SESSION_SECRET=any-long-random-string-for-local-use
ADMIN_TOKEN=any-long-random-string-for-local-use
```

Before deploying, set both as real secrets — they are not in `wrangler.toml` on
purpose, and the API refuses to serve a single request without `SESSION_SECRET`
rather than falling back to something forgeable:

```bash
npx wrangler secret put SESSION_SECRET   # signs the anonymous cookie
npx wrangler secret put ADMIN_TOKEN      # opens the moderation queue
```

`SESSION_SECRET` is the root of every identity: the visitor cookie's signature,
the per-day IP bucket, and the author fingerprint stored on a letter. Rotating it
signs everybody out and resets today's per-visitor counts.

The public values in `wrangler.toml` are safe to edit:

| Variable | Default | Meaning |
| --- | --- | --- |
| `ALLOWED_ORIGIN` | the two dev origins | Comma-separated allowlist; set it to your Pages domain |
| `DAILY_FIND_LIMIT` | `1` | Bottles found per visitor per UTC day |
| `DAILY_WRITE_LIMIT` | `1` | Letters written per visitor per UTC day (a reply spends the same allowance) |
| `DAILY_REPORT_LIMIT` | `3` | Reports per visitor per UTC day |
| `DAILY_IP_MULTIPLIER` | `6` | How much more a whole network may do than one visitor |
| `MODERATION_BLOCKLIST` | unset | Extra comma-separated terms to refuse |

## Deploy

```bash
npm run db:remote     # migrations against the real D1
npm run deploy:api    # the worker
npm run build         # web/dist
npm run deploy:web    # the site (runs in web/, so functions/ is picked up)
```

Then bind the API to the site — **the deployment does not work until you do**.
In the Cloudflare dashboard open the Pages project and go to *Settings →
Bindings → Add → Service binding*: variable name `API`, service
`letters-in-the-ocean-api`. Redeploy for it to take effect.

Building from the repository instead of the CLI works the same way, as long as
Pages is told where the app is: root directory `web`, build command `npm run
build`, output directory `dist`. The function is found relative to that root, so
a project rooted at the repository instead will deploy the site without it.

### Why the binding is not optional

The client fetches `/api/*` relative to wherever it is served from, which is what
keeps the session cookie first-party and CORS out of the picture. Pages, though,
only knows about static files: a Pages project with no `404.html` treats every
unmatched path as a client-side route and answers it with `index.html` and a 200.
So an unbound deployment returns the app shell for `/api/state`, the client tries
to read HTML as JSON, and the whole site fails with *"The ocean answered in a
language we do not speak."* — the parse error, not a server error.

`web/functions/api/[[path]].js` is what answers instead. It hands the request to
the worker unchanged, so the worker sees the visitor's own headers — including
`cf-connecting-ip`, which the network half of the daily limit is derived from —
and the reply, cookie included, comes back on the site's own origin. Everything
outside `/api/*` never reaches it: `web/public/_routes.json` keeps the rest of the
site on the static path.

If you would rather not use a service binding, set a plain variable `API_ORIGIN`
to the worker's own address (`https://letters-in-the-ocean-api.<subdomain>.workers.dev`)
and the function will forward over the network instead. The binding is better:
there is no second hop, and the worker needs no public URL at all — with it in
place you can add `workers_dev = false` to `worker/wrangler.toml` and take the
API off the internet.

`ALLOWED_ORIGIN` plays no part in either arrangement, because the browser only
ever talks to the site's origin. It matters if you deliberately split the two and
point the client straight at the worker — which also needs the client switched to
`credentials: 'include'`, since a `SameSite=Lax` cookie is not sent across sites.

## The API

Every response is JSON. Failures share one shape: `{ "error": { "code", "message" } }`.

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness. Reads nothing, sets no cookie. |
| `GET` | `/api/state` | What today still holds for you, plus the letter limits and report reasons. |
| `GET` | `/api/stats` | Public counts for the homepage. Nobody in particular; no cookie. |
| `GET` | `/api/bottle/random` | Today's bottle. Refreshing returns the same one. |
| `GET` | `/api/bottle/:id` | Re-read a letter you found. 404 for anyone else. |
| `POST` | `/api/bottle` | Leave a letter. |
| `POST` | `/api/bottle/:id/reply` | Answer a letter you found; the reply is a new letter in the ocean. |
| `POST` | `/api/bottle/:id/release` | Send a letter you found further. Idempotent. |
| `POST` | `/api/bottle/:id/report` | Report a letter. One report per person per letter. |
| `GET` | `/api/admin/queue?status=pending` | The moderation queue. `Authorization: Bearer $ADMIN_TOKEN`. |
| `POST` | `/api/admin/bottle/:id/moderate` | `{ "status": "approved" \| "rejected" \| "hidden" \| "pending" }`. |

Only the routes that spend part of your day issue an identity. Reads never mint a
visitor, so several of them in flight on a first visit cannot hand the browser
competing cookies and orphan whatever an action recorded.

### Identity and the daily limit

There is no account. A visitor is a random id in an HMAC-signed, HttpOnly cookie,
so a client cannot forge one that looks server-issued and page scripts cannot read
it. Clearing cookies gets you a new identity, which is why every limit is also
counted against a second bucket: a hash of your IP, re-salted every UTC day so it
cannot follow anybody across days. The network bucket is multiplied
(`DAILY_IP_MULTIPLIER`), because an office or a family behind one address must not
lock each other out — enough headroom to be invisible, tight enough that a private
window is not an unlimited supply of bottles.

Both buckets live in D1. Nothing is enforced in the browser, and no client-side
value is trusted: `localStorage` is not part of the limit at all. Everything resets
at UTC midnight, which is what `resetsAt` in every quota response points at.

One interaction of each kind per day: find one bottle, write one letter (a reply
spends the same allowance), send one letter further, and up to three reports.

## Moderation

```
write -> validate -> rate limit -> moderate -> approved -> ocean
                                       |
                                       +-> pending (a person reads it)
                                       +-> rejected (never discoverable)
```

`worker/src/moderation.js` scores a letter on links and contact details,
advertising, abuse and hate, keyboard mash and placeholder text, and shouting.
Nothing is written to the ocean before that runs, and a letter only becomes
findable at `approved`. A refusal is stored with its reasons so the filter can be
audited, but a rejected letter is never handed to anyone — the only way to see one
is the authenticated queue.

Two cases get deliberate care:

- **Distress.** A letter that reads like a person in crisis is not refused. It is
  held as `pending` for a human, and the writer is shown a note with the 988
  Suicide & Crisis Lifeline rather than a rejection.
- **Probing.** A refusal costs no daily allowance, so nobody loses their letter to
  a false positive — but refusals are capped per day, so the filter cannot be used
  as an oracle.

Readers can report a letter. Three reports hide it automatically, pending review;
the reporter is thanked and told nothing else.

## Accessibility

The entire journey works with motion turned off: with `prefers-reduced-motion`
every drift, sway and reveal resolves to its finished state immediately, delays
included, and the browser test asserts that the letter's words and choices are
actually at full opacity rather than merely present in the DOM. The bottle is a
real `<button>` from the moment it appears, so nobody has to wait out an
animation. Nothing depends on hover. Sound is off until you turn it on, and it is
synthesised rather than downloaded.

## Testing

```bash
npm test                      # 60 worker tests, node:test against a real SQLite D1 stand-in
node web/scripts/journey.mjs  # drives the built app in headless Edge over CDP
```

The journey can also be pointed at the deployment's own wiring rather than the
Vite proxy, which is worth doing before a deploy: it runs the built site behind
the Pages Function and the service binding, so a `/api/*` path that only works in
development cannot pass.

```bash
npm run dev:api                                  # the worker, as usual
npm run build && npm run preview:pages           # the built site on :4173, API bound
JOURNEY_ORIGIN=http://127.0.0.1:4173 node web/scripts/journey.mjs
```

`journey.mjs` is a development tool rather than CI: with both dev servers running
it finds a bottle, opens it, sends it on, writes and releases a letter, then does
the whole thing again under emulated reduced motion, collecting every console
error and unhandled exception on the way. It expects Edge at the path at the top
of the file and a fresh daily allowance — clear today's rows with
`npx wrangler d1 execute letters-in-the-ocean --local --command "DELETE FROM interactions"`
if you have already used the day up.
