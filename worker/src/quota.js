import { countInteractions } from './db.js';
import { intVar } from './util.js';

/**
 * Daily limits.
 *
 * Two independent buckets, both stored server-side in D1:
 *
 *   1. the signed visitor cookie  — precise, but a visitor can clear it
 *   2. a per-day hash of their IP — survives a cookie wipe, but is shared by
 *                                   everyone behind an office or carrier NAT
 *
 * Neither is sufficient alone, so the network bucket gets a multiplier: enough
 * headroom that a family or an office is never locked out, tight enough that
 * refreshing in a private window does not hand out an unlimited supply of
 * bottles. This is deliberately not one-human-one-day — it discourages abuse
 * while keeping the experience frictionless, exactly as the brief asks.
 *
 * KV, when bound, adds a short burst limiter in front of all of this.
 */

export const ACTIONS = ['find', 'write', 'reply', 'drift', 'report'];

export function limitsFor(env) {
  const find = intVar(env.DAILY_FIND_LIMIT, 1, { min: 1, max: 50 });
  const write = intVar(env.DAILY_WRITE_LIMIT, 1, { min: 1, max: 50 });
  return {
    find,
    // A reply and an original letter draw on the same allowance: one letter a
    // day, whether it is an answer to somebody or a thought of your own.
    write,
    reply: write,
    drift: intVar(env.DAILY_DRIFT_LIMIT, find, { min: 1, max: 50 }),
    report: intVar(env.DAILY_REPORT_LIMIT, 3, { min: 1, max: 50 }),
    networkMultiplier: intVar(env.DAILY_IP_MULTIPLIER, 6, { min: 1, max: 200 }),
  };
}

export function nextResetIso(day) {
  const midnight = new Date(`${day}T00:00:00.000Z`);
  midnight.setUTCDate(midnight.getUTCDate() + 1);
  return midnight.toISOString();
}

/** Actions that share a single allowance are counted together. */
function bucketFor(action) {
  return action === 'reply' ? 'write' : action;
}

async function usedCount(ctx, action) {
  const bucket = bucketFor(action);
  if (bucket !== 'write') {
    return countInteractions(ctx.db, { anonymousId: ctx.visitorId, action, day: ctx.day });
  }
  const [written, replied] = await Promise.all([
    countInteractions(ctx.db, { anonymousId: ctx.visitorId, action: 'write', day: ctx.day }),
    countInteractions(ctx.db, { anonymousId: ctx.visitorId, action: 'reply', day: ctx.day }),
  ]);
  return written + replied;
}

async function networkCount(ctx, action) {
  const bucket = bucketFor(action);
  if (bucket !== 'write') {
    return countInteractions(ctx.db, { anonymousId: ctx.network, action, day: ctx.day });
  }
  const [written, replied] = await Promise.all([
    countInteractions(ctx.db, { anonymousId: ctx.network, action: 'write', day: ctx.day }),
    countInteractions(ctx.db, { anonymousId: ctx.network, action: 'reply', day: ctx.day }),
  ]);
  return written + replied;
}

export async function checkQuota(ctx, action) {
  const limit = ctx.limits[action] ?? 1;
  const used = await usedCount(ctx, action);
  if (used >= limit) {
    return { allowed: false, scope: 'visitor', used, limit, resetsAt: nextResetIso(ctx.day) };
  }

  const networkLimit = limit * ctx.limits.networkMultiplier;
  const networkUsed = await networkCount(ctx, action);
  if (networkUsed >= networkLimit) {
    return { allowed: false, scope: 'network', used, limit, resetsAt: nextResetIso(ctx.day) };
  }

  return { allowed: true, used, limit, resetsAt: nextResetIso(ctx.day) };
}

/**
 * Cheap burst brake in KV — stops a script hammering the API even when the
 * request would eventually be refused by the daily check. No-op without KV.
 */
export async function checkBurst(ctx, { limit = 40, windowSeconds = 60 } = {}) {
  if (!ctx.kv) return { allowed: true };
  const key = `burst:${ctx.network}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;
  const current = Number.parseInt((await ctx.kv.get(key)) ?? '0', 10) || 0;
  if (current >= limit) return { allowed: false, retryAfter: windowSeconds };
  await ctx.kv.put(key, String(current + 1), { expirationTtl: Math.max(60, windowSeconds) });
  return { allowed: true };
}
