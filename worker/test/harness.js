import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { handleRequest } from '../src/index.js';

/**
 * A D1-shaped facade over node:sqlite.
 *
 * D1 is SQLite, so the tests run the worker's real SQL — schema, indexes,
 * constraints and RETURNING clauses included — instead of a hand-written fake
 * that would happily agree with a broken query.
 */
class Statement {
  constructor(db, sql, params) {
    this.db = db;
    this.sql = sql;
    this.params = params ?? [];
  }

  bind(...params) {
    return new Statement(this.db, this.sql, params.map(normalize));
  }

  async first(column) {
    const row = this.db.prepare(this.sql).get(...this.params) ?? null;
    if (row && column != null) return row[column] ?? null;
    return row;
  }

  async all() {
    const results = this.db.prepare(this.sql).all(...this.params);
    return { results, success: true, meta: { changes: 0 } };
  }

  async run() {
    const info = this.db.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: { changes: Number(info.changes ?? 0), last_row_id: Number(info.lastInsertRowid ?? 0) },
    };
  }
}

function normalize(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

export class TestD1 {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys = ON;');
  }

  prepare(sql) {
    return new Statement(this.db, sql, []);
  }

  async batch(statements) {
    const out = [];
    for (const statement of statements) out.push(await statement.run());
    return out;
  }

  async exec(sql) {
    this.db.exec(sql);
    return { count: 1, duration: 0 };
  }

  close() {
    this.db.close();
  }
}

/** Applies every migration in worker/migrations, in filename order. */
export function migratedDatabase() {
  const here = dirname(fileURLToPath(import.meta.url));
  const migrations = join(here, '..', 'migrations');
  const database = new TestD1();
  for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) {
    database.db.exec(readFileSync(join(migrations, file), 'utf8'));
  }
  return database;
}

/** Workers KV, minus the eventual consistency. */
export class TestKV {
  constructor() {
    this.store = new Map();
  }

  async get(key, type) {
    const value = this.store.get(key);
    if (value === undefined) return null;
    return type === 'json' ? JSON.parse(value) : value;
  }

  async put(key, value) {
    this.store.set(key, String(value));
  }

  async delete(key) {
    this.store.delete(key);
  }
}

/** One anonymous visitor: an IP and whatever cookie the API handed back. */
class Visitor {
  constructor(env, ip) {
    this.env = env;
    this.ip = ip;
    this.cookie = null;
  }

  async request(method, path, body, extraHeaders = {}) {
    const headers = { 'cf-connecting-ip': this.ip, ...extraHeaders };
    const init = { method, headers };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    if (this.cookie) headers.cookie = this.cookie;

    const response = await handleRequest(new Request(`http://localhost:8787${path}`, init), this.env);
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      this.cookie = raw.split(';')[0];
    }

    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      data: text ? JSON.parse(text) : null,
    };
  }

  get(path, headers) {
    return this.request('GET', path, undefined, headers);
  }

  post(path, body = {}, headers) {
    return this.request('POST', path, body, headers);
  }
}

let ipCounter = 0;

export function createOcean(overrides = {}) {
  const db = migratedDatabase();
  const env = {
    DB: db,
    RATE_KV: new TestKV(),
    SESSION_SECRET: 'test-session-secret',
    ALLOWED_ORIGIN: 'http://localhost:5173',
    ADMIN_TOKEN: 'test-admin-token',
    ...overrides,
  };

  return {
    env,
    db,
    /** Each visitor gets a distinct IP unless one is given, so the network
     *  bucket does not accidentally couple unrelated test visitors. */
    visitor(ip) {
      ipCounter += 1;
      return new Visitor(env, ip ?? `198.51.100.${ipCounter % 250}`);
    },
    close() {
      db.close();
    },
  };
}
