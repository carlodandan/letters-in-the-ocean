/**
 * D1 access layer. All SQL lives here so the routes stay readable and so the
 * tests can run the exact same statements against a real SQLite engine.
 */

const READER_COLUMNS =
  'id, message, parent_id, root_id, depth, hops, found_count, reply_count, created_at';

const REPORTS_BEFORE_AUTO_HIDE = 3;

export async function insertBottle(db, bottle) {
  await db
    .prepare(
      `INSERT INTO bottles
         (id, message, parent_id, root_id, depth, author_hash, status,
          moderation_score, moderation_reasons, origin_country, created_at, approved_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    )
    .bind(
      bottle.id,
      bottle.message,
      bottle.parentId ?? null,
      bottle.rootId,
      bottle.depth,
      bottle.authorHash,
      bottle.status,
      bottle.moderationScore,
      bottle.moderationReasons,
      bottle.originCountry ?? null,
      bottle.createdAt,
      bottle.status === 'approved' ? bottle.createdAt : null,
    )
    .run();
  return bottle.id;
}

export function getBottle(db, id) {
  return db.prepare('SELECT * FROM bottles WHERE id = ?1').bind(id).first();
}

export function getReadableBottle(db, id) {
  return db
    .prepare(`SELECT ${READER_COLUMNS} FROM bottles WHERE id = ?1 AND status = 'approved'`)
    .bind(id)
    .first();
}

/**
 * Choose a letter for someone to find.
 *
 * Ordering by `found_count / 3` groups bottles into tiers of "barely found",
 * then shuffles within the tier: rare letters surface first, but the pick still
 * feels like the ocean rather than a queue.
 */
export async function pickRandomBottle(db, { authorHash, visitorId }) {
  const unseen = await db
    .prepare(
      `SELECT ${READER_COLUMNS} FROM bottles
        WHERE status = 'approved'
          AND depth = 0
          AND author_hash <> ?1
          AND id NOT IN (
            SELECT bottle_id FROM interactions
             WHERE anonymous_id = ?2 AND bottle_id IS NOT NULL
          )
        ORDER BY found_count / 3, RANDOM()
        LIMIT 1`,
    )
    .bind(authorHash, visitorId)
    .first();
  if (unseen) return unseen;

  // Seen everything the ocean currently holds — allow a re-read of someone
  // else's letter rather than showing an empty horizon.
  return db
    .prepare(
      `SELECT ${READER_COLUMNS} FROM bottles
        WHERE status = 'approved'
          AND depth = 0
          AND author_hash <> ?1
        ORDER BY RANDOM() LIMIT 1`,
    )
    .bind(authorHash)
    .first();
}

/** Returns true when the row was new (the unique index makes this idempotent). */
export async function recordInteraction(db, { id, anonymousId, bottleId, action, day, createdAt }) {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO interactions (id, anonymous_id, bottle_id, action, day, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(id, anonymousId, bottleId ?? null, action, day, createdAt)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function countInteractions(db, { anonymousId, action, day }) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total FROM interactions
        WHERE anonymous_id = ?1 AND action = ?2 AND day = ?3`,
    )
    .bind(anonymousId, action, day)
    .first();
  return row?.total ?? 0;
}

/** The bottle this visitor already found today, so a refresh returns the same one. */
export async function findTodaysBottleId(db, { anonymousId, day }) {
  const row = await db
    .prepare(
      `SELECT bottle_id FROM interactions
        WHERE anonymous_id = ?1 AND action = 'find' AND day = ?2 AND bottle_id IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(anonymousId, day)
    .first();
  return row?.bottle_id ?? null;
}

export function incrementFoundCount(db, id) {
  return db.prepare('UPDATE bottles SET found_count = found_count + 1 WHERE id = ?1').bind(id).run();
}

/** Did this visitor ever pull this particular bottle out of the water? */
export async function hasFound(db, { anonymousId, bottleId }) {
  return hasInteraction(db, { anonymousId, bottleId, action: 'find' });
}

export async function hasInteraction(db, { anonymousId, bottleId, action }) {
  const row = await db
    .prepare(
      `SELECT 1 AS present FROM interactions
        WHERE anonymous_id = ?1 AND bottle_id = ?2 AND action = ?3 LIMIT 1`,
    )
    .bind(anonymousId, bottleId, action)
    .first();
  return Boolean(row);
}

/**
 * Rejected attempts by this author since `since`. A refused letter must not burn
 * the one letter someone gets each day, but unlimited retries would turn the
 * moderator into an oracle — so refusals get their own small ceiling.
 */
export async function countRejectedSince(db, { authorHash, since }) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total FROM bottles
        WHERE author_hash = ?1 AND status = 'rejected' AND created_at >= ?2`,
    )
    .bind(authorHash, since)
    .first();
  return row?.total ?? 0;
}

export function incrementReplyCount(db, id) {
  return db.prepare('UPDATE bottles SET reply_count = reply_count + 1 WHERE id = ?1').bind(id).run();
}

// --- Journeys: "send it further" -------------------------------------------

export async function recordDrift(db, { id, bottleId, anonymousId, country, createdAt }) {
  const bottle = await db
    .prepare('UPDATE bottles SET hops = hops + 1, last_drift_at = ?2 WHERE id = ?1 RETURNING hops')
    .bind(bottleId, createdAt)
    .first();
  const hop = bottle?.hops ?? 1;
  await db
    .prepare(
      `INSERT INTO journeys (id, bottle_id, anonymous_id, country, hop, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(id, bottleId, anonymousId, country ?? null, hop, createdAt)
    .run();
  return hop;
}

// --- Reports ---------------------------------------------------------------

export async function insertReport(db, { id, bottleId, reporterHash, reason, note, createdAt }) {
  const inserted = await db
    .prepare(
      `INSERT INTO reports (id, bottle_id, reporter_hash, reason, note, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(id, bottleId, reporterHash, reason, note ?? null, createdAt)
    .run();
  if ((inserted.meta?.changes ?? 0) === 0) return null;

  const row = await db
    .prepare(
      `UPDATE bottles SET report_count = report_count + 1 WHERE id = ?1 RETURNING report_count`,
    )
    .bind(bottleId)
    .first();
  const count = row?.report_count ?? 0;

  // Enough independent reports pulls the letter out of the water immediately;
  // a human decides afterwards. Hiding is reversible, harm is not.
  if (count >= REPORTS_BEFORE_AUTO_HIDE) {
    await db
      .prepare(`UPDATE bottles SET status = 'hidden' WHERE id = ?1 AND status = 'approved'`)
      .bind(bottleId)
      .run();
  }
  return count;
}

// --- Statistics (secondary to the experience, so: cheap and cacheable) ------

export async function oceanStats(db, day) {
  /*
   * Every action writes two rows into `interactions`: one against the visitor and
   * one against their network bucket (see quota.js). The second is bookkeeping for
   * the daily limit, not a person finding a letter, so the public counts ignore
   * anything filed under a `net:` id — otherwise the homepage would claim twice as
   * many letters had been found as ever were.
   */
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM bottles WHERE status = 'approved') AS letters,
         (SELECT COUNT(*) FROM bottles WHERE status = 'approved' AND depth > 0) AS replies,
         (SELECT COUNT(*) FROM interactions
           WHERE action = 'find' AND anonymous_id NOT LIKE 'net:%') AS found_total,
         (SELECT COUNT(*) FROM interactions
           WHERE action = 'find' AND day = ?1 AND anonymous_id NOT LIKE 'net:%') AS found_today,
         (SELECT COUNT(DISTINCT origin_country) FROM bottles
           WHERE status = 'approved' AND origin_country IS NOT NULL) AS countries,
         (SELECT COALESCE(SUM(hops), 0) FROM bottles) AS drifts`,
    )
    .bind(day)
    .first();

  return {
    letters: row?.letters ?? 0,
    replies: row?.replies ?? 0,
    found: row?.found_total ?? 0,
    foundToday: row?.found_today ?? 0,
    countries: row?.countries ?? 0,
    drifts: row?.drifts ?? 0,
  };
}

// --- Moderation queue (admin) ----------------------------------------------

export async function moderationQueue(db, { status = 'pending', limit = 50 } = {}) {
  const result = await db
    .prepare(
      `SELECT id, message, parent_id, depth, status, moderation_score, moderation_reasons,
              report_count, created_at
         FROM bottles WHERE status = ?1 ORDER BY created_at ASC LIMIT ?2`,
    )
    .bind(status, limit)
    .all();
  return result.results ?? [];
}

export async function setBottleStatus(db, id, status, approvedAt) {
  const result = await db
    .prepare(
      `UPDATE bottles
          SET status = ?2,
              approved_at = CASE WHEN ?2 = 'approved' THEN COALESCE(approved_at, ?3) ELSE approved_at END
        WHERE id = ?1`,
    )
    .bind(id, status, approvedAt)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function resolveReports(db, bottleId, status) {
  await db
    .prepare(`UPDATE reports SET status = ?2 WHERE bottle_id = ?1 AND status = 'open'`)
    .bind(bottleId, status)
    .run();
}
