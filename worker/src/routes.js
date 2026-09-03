import * as db from './db.js';
import { decisionMessage, moderate, parseBlocklist } from './moderation.js';
import { checkBurst, checkQuota, nextResetIso } from './quota.js';
import {
  MAX_LENGTH,
  MIN_LENGTH,
  reportReasons,
  validateMessage,
  validateReport,
} from './validate.js';
import { fail, json, nowIso, uuid } from './util.js';

/** A refused letter costs nothing, but refusals still get a ceiling. */
const MAX_REJECTIONS_PER_DAY = 5;

/**
 * The public shape of a letter. Note what is absent: no author, no fingerprint,
 * no exact timestamp, no parent id. A finder gets the words and nothing that
 * could be used to work out who wrote them.
 */
function presentBottle(row) {
  return {
    id: row.id,
    message: row.message,
    isReply: (row.depth ?? 0) > 0,
    timesFound: row.found_count ?? 0,
    replies: row.reply_count ?? 0,
    // Journeys are recorded from day one; the UI can surface them whenever it
    // is ready for "this letter has drifted through 14 strangers".
    journeys: row.hops ?? 0,
    releasedOn: String(row.created_at ?? '').slice(0, 10),
  };
}

async function todayState(ctx) {
  const [find, letter, drift, foundId] = await Promise.all([
    checkQuota(ctx, 'find'),
    checkQuota(ctx, 'write'),
    checkQuota(ctx, 'drift'),
    db.findTodaysBottleId(ctx.db, { anonymousId: ctx.visitorId, day: ctx.day }),
  ]);

  return {
    day: ctx.day,
    resetsAt: nextResetIso(ctx.day),
    find: { available: find.allowed, used: find.used, limit: find.limit, bottleId: foundId },
    letter: { available: letter.allowed, used: letter.used, limit: letter.limit },
    drift: { available: drift.allowed, used: drift.used, limit: drift.limit },
  };
}

export async function getState(ctx) {
  return json({
    today: await todayState(ctx),
    letter: { minLength: MIN_LENGTH, maxLength: MAX_LENGTH },
    reportReasons: reportReasons(),
  });
}

async function guardBurst(ctx) {
  const burst = await checkBurst(ctx);
  if (burst.allowed) return null;
  return fail(429, 'slow_down', 'The ocean is not going anywhere. Try again in a moment.', {
    retryAfter: burst.retryAfter,
  });
}

/**
 * The network half of the daily limit. `bottleId` is deliberately null: SQLite
 * treats NULLs in a unique index as distinct, so these rows accumulate one per
 * action instead of being collapsed like the per-visitor rows are.
 */
function recordNetworkUse(ctx, action) {
  return db.recordInteraction(ctx.db, {
    id: uuid(),
    anonymousId: ctx.network,
    bottleId: null,
    action,
    day: ctx.day,
    createdAt: nowIso(),
  });
}

// --- Finding a bottle -------------------------------------------------------

export async function getRandomBottle(ctx) {
  const blocked = await guardBurst(ctx);
  if (blocked) return blocked;

  const existingId = await db.findTodaysBottleId(ctx.db, {
    anonymousId: ctx.visitorId,
    day: ctx.day,
  });

  if (existingId) {
    const existing = await db.getReadableBottle(ctx.db, existingId);
    // Refreshing returns the same letter rather than spending another day.
    if (existing) {
      return json({
        bottle: presentBottle(existing),
        found: 'again',
        today: await todayState(ctx),
      });
    }
    // Their letter was pulled from the water after they found it. Give them
    // another one instead of an empty day.
    return handOverBottle(ctx, { replacing: true });
  }

  const quota = await checkQuota(ctx, 'find');
  if (!quota.allowed) {
    return fail(429, 'daily_limit', 'Five bottles a day. The tide brings more tomorrow.', {
      resetsAt: quota.resetsAt,
      today: await todayState(ctx),
    });
  }

  return handOverBottle(ctx, { replacing: false });
}

async function handOverBottle(ctx, { replacing }) {
  const bottle = await db.pickRandomBottle(ctx.db, {
    authorHash: ctx.authorHash,
    visitorId: ctx.visitorId,
  });

  if (!bottle) {
    // Nothing to find and nothing spent — the horizon is simply empty today.
    return json({ bottle: null, found: 'nothing', today: await todayState(ctx) });
  }

  const recorded = await db.recordInteraction(ctx.db, {
    id: uuid(),
    anonymousId: ctx.visitorId,
    bottleId: bottle.id,
    action: 'find',
    day: ctx.day,
    createdAt: nowIso(),
  });
  if (recorded) {
    await db.incrementFoundCount(ctx.db, bottle.id);
    await recordNetworkUse(ctx, 'find');
  }

  return json({
    bottle: presentBottle({ ...bottle, found_count: (bottle.found_count ?? 0) + (recorded ? 1 : 0) }),
    found: replacing ? 'replacement' : 'new',
    today: await todayState(ctx),
  });
}

/**
 * A letter is only readable by someone who actually found it. There is no way to
 * walk ids and browse the ocean — that would turn this into a feed.
 */
export async function getBottle(ctx, id) {
  const found = await db.hasFound(ctx.db, { anonymousId: ctx.visitorId, bottleId: id });
  if (!found) return fail(404, 'not_found', 'That letter is not in your hands.');

  const bottle = await db.getReadableBottle(ctx.db, id);
  if (!bottle) return fail(410, 'drifted_away', 'That letter has drifted out of reach.');

  return json({ bottle: presentBottle(bottle), found: 'again' });
}

// --- Leaving a letter -------------------------------------------------------

/**
 * The write path, shared by an original letter and a reply. Order matters and
 * mirrors the pipeline in the brief:
 *   validate -> rate limit -> moderate -> (approved) -> ocean
 */
async function releaseLetter(ctx, { rawMessage, parent }) {
  const blocked = await guardBurst(ctx);
  if (blocked) return blocked;

  const validation = validateMessage(rawMessage);
  if (!validation.ok) return fail(400, validation.error.code, validation.error.message);

  const action = parent ? 'reply' : 'write';
  const quota = await checkQuota(ctx, action);
  if (!quota.allowed) {
    return fail(429, 'daily_limit', 'One letter a day. Come back tomorrow and say the rest.', {
      resetsAt: quota.resetsAt,
      today: await todayState(ctx),
    });
  }

  const verdict = moderate(validation.value, { blocklist: parseBlocklist(ctx.env.MODERATION_BLOCKLIST) });
  const createdAt = nowIso();

  if (verdict.decision === 'rejected') {
    const refusals = await db.countRejectedSince(ctx.db, {
      authorHash: ctx.authorHash,
      since: `${ctx.day}T00:00:00.000Z`,
    });
    if (refusals >= MAX_REJECTIONS_PER_DAY) {
      return fail(429, 'too_many_attempts', 'Let’s pause here for today. The tide resets at midnight.', {
        resetsAt: quota.resetsAt,
      });
    }
  }

  const id = uuid();
  await db.insertBottle(ctx.db, {
    id,
    message: validation.value,
    parentId: parent?.id ?? null,
    rootId: parent?.root_id ?? parent?.id ?? id,
    depth: parent ? (parent.depth ?? 0) + 1 : 0,
    authorHash: ctx.authorHash,
    status: verdict.decision === 'rejected' ? 'rejected' : verdict.decision,
    moderationScore: verdict.score,
    moderationReasons: verdict.reasons.length > 0 ? JSON.stringify(verdict.reasons) : null,
    originCountry: ctx.country,
    createdAt,
  });

  // A refusal never costs somebody their letter for the day.
  if (verdict.decision !== 'rejected') {
    await db.recordInteraction(ctx.db, {
      id: uuid(),
      anonymousId: ctx.visitorId,
      bottleId: parent?.id ?? id,
      action,
      day: ctx.day,
      createdAt,
    });
    await recordNetworkUse(ctx, action);
    if (parent) await db.incrementReplyCount(ctx.db, parent.id);
  }

  const status = verdict.decision === 'rejected' ? 422 : 201;
  const message = decisionMessage(verdict.decision, verdict.care);
  return json(
    {
      bottle: verdict.decision === 'rejected' ? null : { id, status: verdict.decision },
      released: verdict.decision === 'approved',
      pending: verdict.decision === 'pending',
      refused: verdict.decision === 'rejected',
      care: verdict.care,
      message,
      // Refusals are errors as far as HTTP is concerned, so they carry the same
      // { error: { code, message } } shape everything else does. The client needs
      // no special case to show the writer why.
      ...(verdict.decision === 'rejected'
        ? { error: { code: 'letter_refused', message, care: verdict.care } }
        : null),
      today: await todayState(ctx),
    },
    { status },
  );
}

export async function postBottle(ctx, body) {
  return releaseLetter(ctx, { rawMessage: body?.message, parent: null });
}

export async function postReply(ctx, id, body) {
  const found = await db.hasFound(ctx.db, { anonymousId: ctx.visitorId, bottleId: id });
  if (!found) return fail(404, 'not_found', 'You can only answer a letter you found.');

  const parent = await db.getBottle(ctx.db, id);
  if (!parent || parent.status !== 'approved') {
    return fail(410, 'drifted_away', 'That letter has drifted out of reach.');
  }
  return releaseLetter(ctx, { rawMessage: body?.message, parent });
}

// --- Sending a letter further ----------------------------------------------

/**
 * "Release" from the reading screen: put the letter back into the water without
 * writing anything. The journey is logged so a letter can later be shown as
 * having travelled through a number of strangers.
 */
export async function postRelease(ctx, id) {
  const blocked = await guardBurst(ctx);
  if (blocked) return blocked;

  const found = await db.hasFound(ctx.db, { anonymousId: ctx.visitorId, bottleId: id });
  if (!found) return fail(404, 'not_found', 'You can only send on a letter you found.');

  const bottle = await db.getBottle(ctx.db, id);
  if (!bottle || bottle.status !== 'approved') {
    return fail(410, 'drifted_away', 'That letter has drifted out of reach.');
  }

  // Tapping "release" twice is the same as tapping it once — check before the
  // quota, so a double tap never reads as a second day's action.
  const already = await db.hasInteraction(ctx.db, {
    anonymousId: ctx.visitorId,
    bottleId: id,
    action: 'drift',
  });
  if (already) {
    return json({ journeys: bottle.hops, message: 'It is already back in the water.' });
  }

  const quota = await checkQuota(ctx, 'drift');
  if (!quota.allowed) {
    return fail(429, 'daily_limit', 'You have already sent one on today.', {
      resetsAt: quota.resetsAt,
    });
  }

  const createdAt = nowIso();
  await db.recordInteraction(ctx.db, {
    id: uuid(),
    anonymousId: ctx.visitorId,
    bottleId: id,
    action: 'drift',
    day: ctx.day,
    createdAt,
  });

  await recordNetworkUse(ctx, 'drift');
  const hop = await db.recordDrift(ctx.db, {
    id: uuid(),
    bottleId: id,
    anonymousId: ctx.visitorId,
    country: ctx.country,
    createdAt,
  });

  return json({
    journeys: hop,
    message: 'Back into the water. Someone else will find it now.',
    today: await todayState(ctx),
  });
}

// --- Reporting --------------------------------------------------------------

export async function postReport(ctx, id, body) {
  const blocked = await guardBurst(ctx);
  if (blocked) return blocked;

  const validation = validateReport(body);
  if (!validation.ok) return fail(400, validation.error.code, validation.error.message);

  const bottle = await db.getBottle(ctx.db, id);
  if (!bottle) return fail(404, 'not_found', 'That letter does not exist.');

  const quota = await checkQuota(ctx, 'report');
  if (!quota.allowed) {
    return fail(429, 'daily_limit', 'Thank you — that is enough reports from here today.', {
      resetsAt: quota.resetsAt,
    });
  }

  const createdAt = nowIso();
  const recorded = await db.recordInteraction(ctx.db, {
    id: uuid(),
    anonymousId: ctx.visitorId,
    bottleId: id,
    action: 'report',
    day: ctx.day,
    createdAt,
  });

  if (recorded) {
    await recordNetworkUse(ctx, 'report');
    await db.insertReport(ctx.db, {
      id: uuid(),
      bottleId: id,
      reporterHash: ctx.authorHash,
      reason: validation.value.reason,
      note: validation.value.note,
      createdAt,
    });
  }

  return json(
    { message: 'Thank you. Someone will read it and act if they need to.' },
    { status: 202 },
  );
}

// --- Statistics -------------------------------------------------------------

const STATS_TTL_SECONDS = 60;

export async function getStats(ctx) {
  const cacheKey = `stats:${ctx.day}`;
  if (ctx.kv) {
    const cached = await ctx.kv.get(cacheKey, 'json');
    if (cached) return json(cached, { headers: { 'cache-control': 'public, max-age=60' } });
  }

  const stats = await db.oceanStats(ctx.db, ctx.day);
  if (ctx.kv) {
    await ctx.kv.put(cacheKey, JSON.stringify(stats), { expirationTtl: STATS_TTL_SECONDS });
  }
  return json(stats, { headers: { 'cache-control': 'public, max-age=60' } });
}

// --- Moderation (admin) -----------------------------------------------------

/**
 * Manual review. Guarded by a bearer token so the queue — which contains letters
 * that were never approved — is not readable by the public. With no ADMIN_TOKEN
 * configured these routes stay closed rather than open.
 */
function authorizeAdmin(ctx) {
  const expected = ctx.env.ADMIN_TOKEN;
  if (!expected) return fail(503, 'moderation_disabled', 'Manual moderation is not configured.');
  const header = ctx.request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token !== expected) return fail(401, 'unauthorized', 'Not for you.');
  return null;
}

const MODERATABLE = new Set(['approved', 'rejected', 'hidden', 'pending']);

export async function getModerationQueue(ctx) {
  const denied = authorizeAdmin(ctx);
  if (denied) return denied;

  const status = ctx.url.searchParams.get('status') ?? 'pending';
  if (!MODERATABLE.has(status)) return fail(400, 'status_invalid', 'Unknown status.');

  return json({ status, bottles: await db.moderationQueue(ctx.db, { status, limit: 50 }) });
}

export async function postModeration(ctx, id, body) {
  const denied = authorizeAdmin(ctx);
  if (denied) return denied;

  const status = String(body?.status ?? '');
  if (!MODERATABLE.has(status)) return fail(400, 'status_invalid', 'Unknown status.');

  const changed = await db.setBottleStatus(ctx.db, id, status, nowIso());
  if (!changed) return fail(404, 'not_found', 'No such letter.');

  await db.resolveReports(ctx.db, id, status === 'approved' ? 'dismissed' : 'upheld');
  return json({ id, status });
}
