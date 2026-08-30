-- Letters in the Ocean — initial schema.
--
-- Design notes:
--  * `bottles` is the only table holding message text. There is no user table,
--    by design: the strongest privacy guarantee is having nothing to leak.
--  * `author_hash` is a keyed hash of the anonymous visitor id. It exists only
--    so a visitor never finds their own letter, and is never returned by the API.
--  * `parent_id` / `root_id` / `depth` model reply chains from day one, so
--    "Original -> Reply -> Reply" can be walked later without a migration.
--  * `hops` + the `journeys` table model "send it further": a letter that
--    travels from stranger to stranger ("this letter has passed through 14 hands").

CREATE TABLE IF NOT EXISTS bottles (
  id                 TEXT PRIMARY KEY,
  message            TEXT NOT NULL,
  parent_id          TEXT REFERENCES bottles(id) ON DELETE SET NULL,
  root_id            TEXT NOT NULL,
  depth              INTEGER NOT NULL DEFAULT 0,
  author_hash        TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'approved', 'rejected', 'hidden')),
  moderation_score   REAL NOT NULL DEFAULT 0,
  moderation_reasons TEXT,
  hops               INTEGER NOT NULL DEFAULT 0,
  found_count        INTEGER NOT NULL DEFAULT 0,
  reply_count        INTEGER NOT NULL DEFAULT 0,
  report_count       INTEGER NOT NULL DEFAULT 0,
  origin_country     TEXT,
  created_at         TEXT NOT NULL,
  approved_at        TEXT,
  last_drift_at      TEXT
);

-- The discovery query filters on status and orders by how often a bottle has
-- been found, so rare letters surface first.
CREATE INDEX IF NOT EXISTS idx_bottles_discoverable ON bottles (status, found_count);
CREATE INDEX IF NOT EXISTS idx_bottles_parent       ON bottles (parent_id);
CREATE INDEX IF NOT EXISTS idx_bottles_root         ON bottles (root_id, depth);
CREATE INDEX IF NOT EXISTS idx_bottles_author       ON bottles (author_hash);
CREATE INDEX IF NOT EXISTS idx_bottles_created      ON bottles (created_at);
CREATE INDEX IF NOT EXISTS idx_bottles_country      ON bottles (origin_country);

-- Every meaningful action is recorded here. This is the durable half of the
-- daily limit: KV is a fast path, this table is the source of truth.
CREATE TABLE IF NOT EXISTS interactions (
  id           TEXT PRIMARY KEY,
  anonymous_id TEXT NOT NULL,
  bottle_id    TEXT REFERENCES bottles(id) ON DELETE SET NULL,
  action       TEXT NOT NULL
                 CHECK (action IN ('find', 'write', 'reply', 'drift', 'report')),
  day          TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_interactions_quota ON interactions (anonymous_id, action, day);
CREATE INDEX IF NOT EXISTS idx_interactions_seen  ON interactions (anonymous_id, bottle_id);
CREATE INDEX IF NOT EXISTS idx_interactions_day   ON interactions (day, action);

-- One row per visitor per bottle per action keeps a refresh from consuming a
-- second find, and keeps a double-tapped report from counting twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_interactions_unique
  ON interactions (anonymous_id, action, day, bottle_id);

CREATE TABLE IF NOT EXISTS reports (
  id            TEXT PRIMARY KEY,
  bottle_id     TEXT NOT NULL REFERENCES bottles(id) ON DELETE CASCADE,
  reporter_hash TEXT NOT NULL,
  reason        TEXT NOT NULL
                  CHECK (reason IN ('spam', 'harassment', 'hate', 'sexual', 'scam', 'disturbing', 'other')),
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'upheld', 'dismissed')),
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_bottle ON reports (bottle_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status, created_at);

-- A letter's travel log. Written when someone sends a letter further instead of
-- replying. Powers "this letter has drifted through N strangers".
CREATE TABLE IF NOT EXISTS journeys (
  id           TEXT PRIMARY KEY,
  bottle_id    TEXT NOT NULL REFERENCES bottles(id) ON DELETE CASCADE,
  anonymous_id TEXT NOT NULL,
  country      TEXT,
  hop          INTEGER NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_journeys_bottle ON journeys (bottle_id, hop);
