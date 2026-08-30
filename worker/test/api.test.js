import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { createOcean } from './harness.js';

const KIND_LETTER = 'You are further along than you think you are. Keep going, quietly.';

function ocean() {
  const instance = createOcean();
  after(() => instance.close());
  return instance;
}

describe('GET /api/state', () => {
  it('describes what today still holds', async () => {
    const visitor = ocean().visitor();
    const { status, data } = await visitor.get('/api/state');

    assert.equal(status, 200);
    assert.equal(data.today.find.available, true);
    assert.equal(data.today.find.limit, 1);
    assert.equal(data.today.letter.available, true);
    assert.equal(data.today.find.bottleId, null);
    assert.equal(data.letter.maxLength, 500);
    assert.ok(data.reportReasons.includes('spam'));
    assert.match(data.today.resetsAt, /T00:00:00\.000Z$/);
  });

  it('issues a signed HttpOnly cookie on the first request', async () => {
    const visitor = ocean().visitor();
    const { headers } = await visitor.get('/api/state');
    const cookie = headers.getSetCookie()[0];

    assert.match(cookie, /^lio_visitor=v1\./);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
  });

  it('ignores a forged cookie and starts a new anonymous visitor', async () => {
    const visitor = ocean().visitor();
    visitor.cookie = 'lio_visitor=v1.pretend-id.1730000000.notarealsignature';
    const { headers, data } = await visitor.get('/api/state');

    assert.equal(headers.getSetCookie().length, 1);
    assert.equal(data.today.find.available, true);
  });
});

describe('finding a bottle', () => {
  it('hands over a letter someone else left', async () => {
    const visitor = ocean().visitor();
    const { status, data } = await visitor.get('/api/bottle/random');

    assert.equal(status, 200);
    assert.equal(data.found, 'new');
    assert.ok(data.bottle.message.length > 0);
    assert.equal(data.bottle.timesFound, 1);
    assert.equal(data.today.find.available, false);
    assert.equal(data.today.find.bottleId, data.bottle.id);
    // The reader learns nothing about the writer.
    assert.equal(data.bottle.author_hash, undefined);
    assert.equal(data.bottle.parent_id, undefined);
  });

  it('returns the same letter on a refresh instead of spending another day', async () => {
    const visitor = ocean().visitor();
    const first = await visitor.get('/api/bottle/random');
    const second = await visitor.get('/api/bottle/random');
    const third = await visitor.get('/api/bottle/random');

    assert.equal(second.data.bottle.id, first.data.bottle.id);
    assert.equal(second.data.found, 'again');
    assert.equal(third.data.bottle.id, first.data.bottle.id);
  });

  it('counts a find once, however many times the page is refreshed', async () => {
    const sea = ocean();
    const visitor = sea.visitor();
    const { data } = await visitor.get('/api/bottle/random');
    await visitor.get('/api/bottle/random');
    await visitor.get('/api/bottle/random');

    const row = await sea.db
      .prepare('SELECT found_count FROM bottles WHERE id = ?1')
      .bind(data.bottle.id)
      .first();
    assert.equal(row.found_count, 1);
  });

  it('never hands somebody their own letter', async () => {
    const sea = ocean();
    const visitor = sea.visitor();
    const written = await visitor.post('/api/bottle', { message: KIND_LETTER });
    const found = await visitor.get('/api/bottle/random');

    assert.equal(written.status, 201);
    assert.notEqual(found.data.bottle.id, written.data.bottle.id);
  });

  it('keeps a letter unreadable to anyone who has not found it', async () => {
    const sea = ocean();
    const finder = sea.visitor();
    const stranger = sea.visitor();
    const { data } = await finder.get('/api/bottle/random');

    assert.equal((await stranger.get(`/api/bottle/${data.bottle.id}`)).status, 404);
    assert.equal((await finder.get(`/api/bottle/${data.bottle.id}`)).status, 200);
  });
});

describe('leaving a letter', () => {
  it('releases a kind letter straight into the ocean', async () => {
    const visitor = ocean().visitor();
    const { status, data } = await visitor.post('/api/bottle', { message: KIND_LETTER });

    assert.equal(status, 201);
    assert.equal(data.released, true);
    assert.equal(data.bottle.status, 'approved');
    assert.equal(data.today.letter.available, false);
  });

  it('allows one letter a day', async () => {
    const visitor = ocean().visitor();
    await visitor.post('/api/bottle', { message: KIND_LETTER });
    const second = await visitor.post('/api/bottle', { message: 'Another thought for the water.' });

    assert.equal(second.status, 429);
    assert.equal(second.data.error.code, 'daily_limit');
    assert.match(second.data.error.resetsAt, /T00:00:00\.000Z$/);
  });

  it('refuses advertising without ever making it discoverable', async () => {
    const sea = ocean();
    const visitor = sea.visitor();
    const { status, data } = await visitor.post('/api/bottle', {
      message: 'Subscribe to my channel at https://example.com for more',
    });

    assert.equal(status, 422);
    assert.equal(data.refused, true);
    assert.equal(data.bottle, null);

    const row = await sea.db
      .prepare(`SELECT COUNT(*) AS total FROM bottles WHERE status = 'rejected'`)
      .first();
    assert.equal(row.total, 1);
  });

  it('does not charge somebody a day for a refused letter', async () => {
    const visitor = ocean().visitor();
    const refused = await visitor.post('/api/bottle', { message: 'buy now at www.example.com' });
    const accepted = await visitor.post('/api/bottle', { message: KIND_LETTER });

    assert.equal(refused.status, 422);
    assert.equal(accepted.status, 201);
    assert.equal(accepted.data.released, true);
  });

  it('stops somebody probing the filter all afternoon', async () => {
    const visitor = ocean().visitor();
    let last;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      last = await visitor.post('/api/bottle', { message: `visit https://spam-${attempt}.com now` });
    }
    assert.equal(last.status, 429);
    assert.equal(last.data.error.code, 'too_many_attempts');
  });

  it('holds a letter written in distress for a person to read', async () => {
    const sea = ocean();
    const visitor = sea.visitor();
    const { status, data } = await visitor.post('/api/bottle', {
      message: 'Lately I want to die and I have nobody to tell, so I am telling the sea.',
    });

    assert.equal(status, 201);
    assert.equal(data.released, false);
    assert.equal(data.pending, true);
    assert.equal(data.care, true);
    assert.match(data.message, /988/);

    const row = await sea.db.prepare(`SELECT status FROM bottles WHERE id = ?1`).bind(data.bottle.id).first();
    assert.equal(row.status, 'pending');
  });

  it('asks for a few more words when the letter is too short', async () => {
    const visitor = ocean().visitor();
    const { status, data } = await visitor.post('/api/bottle', { message: 'hey' });

    assert.equal(status, 400);
    assert.equal(data.error.code, 'message_too_short');
  });

  it('turns away a body larger than a bottle', async () => {
    const visitor = ocean().visitor();
    const { status, data } = await visitor.post('/api/bottle', { message: 'x'.repeat(9000) });

    assert.equal(status, 413);
    assert.equal(data.error.code, 'body_too_large');
  });
});

describe('replying to a bottle', () => {
  it('sends the reply back out as a letter of its own', async () => {
    const sea = ocean();
    const visitor = sea.visitor();
    const found = await visitor.get('/api/bottle/random');
    const reply = await visitor.post(`/api/bottle/${found.data.bottle.id}/reply`, {
      message: 'You are not behind. Everyone is running a different clock.',
    });

    assert.equal(reply.status, 201);
    assert.equal(reply.data.released, true);

    const row = await sea.db
      .prepare('SELECT parent_id, root_id, depth FROM bottles WHERE id = ?1')
      .bind(reply.data.bottle.id)
      .first();
    assert.equal(row.parent_id, found.data.bottle.id);
    assert.equal(row.depth >= 1, true);
    assert.ok(row.root_id);
  });

  it('keeps the chain rooted as it lengthens', async () => {
    const sea = ocean();
    const first = sea.visitor();
    const found = await first.get('/api/bottle/random');
    const replyOne = await first.post(`/api/bottle/${found.data.bottle.id}/reply`, {
      message: 'Whatever it is, I hope it eases up for you soon.',
    });

    const rows = await sea.db
      .prepare('SELECT id, root_id, depth FROM bottles WHERE id IN (?1, ?2)')
      .bind(found.data.bottle.id, replyOne.data.bottle.id)
      .all();
    const parent = rows.results.find((row) => row.id === found.data.bottle.id);
    const child = rows.results.find((row) => row.id === replyOne.data.bottle.id);

    assert.equal(child.root_id, parent.root_id);
    assert.equal(child.depth, parent.depth + 1);
  });

  it('counts the reply on the letter that prompted it', async () => {
    const sea = ocean();
    const visitor = sea.visitor();
    const found = await visitor.get('/api/bottle/random');
    const before = await sea.db
      .prepare('SELECT reply_count FROM bottles WHERE id = ?1')
      .bind(found.data.bottle.id)
      .first();

    await visitor.post(`/api/bottle/${found.data.bottle.id}/reply`, {
      message: 'Thank you for writing that down. It landed at the right time.',
    });

    const after_ = await sea.db
      .prepare('SELECT reply_count FROM bottles WHERE id = ?1')
      .bind(found.data.bottle.id)
      .first();
    assert.equal(after_.reply_count, before.reply_count + 1);
  });

  it('refuses a reply to a letter the visitor never found', async () => {
    const sea = ocean();
    const finder = sea.visitor();
    const stranger = sea.visitor();
    const found = await finder.get('/api/bottle/random');

    const reply = await stranger.post(`/api/bottle/${found.data.bottle.id}/reply`, {
      message: 'I should not be able to answer this letter at all.',
    });
    assert.equal(reply.status, 404);
  });

  it('spends the same daily allowance as an original letter', async () => {
    const sea = ocean();
    const visitor = sea.visitor();
    const found = await visitor.get('/api/bottle/random');
    await visitor.post(`/api/bottle/${found.data.bottle.id}/reply`, {
      message: 'Holding this thought with you for a moment. Take care.',
    });
    const extra = await visitor.post('/api/bottle', { message: KIND_LETTER });

    assert.equal(extra.status, 429);
    assert.equal(extra.data.error.code, 'daily_limit');
  });
});

describe('sending a letter further', () => {
  it('logs the journey and counts the hop', async () => {
    const sea = ocean();
    const visitor = sea.visitor();
    const found = await visitor.get('/api/bottle/random');
    const released = await visitor.post(`/api/bottle/${found.data.bottle.id}/release`);

    assert.equal(released.status, 200);
    assert.equal(released.data.journeys, 1);

    const journey = await sea.db
      .prepare('SELECT hop FROM journeys WHERE bottle_id = ?1')
      .bind(found.data.bottle.id)
      .first();
    assert.equal(journey.hop, 1);
  });

  it('is idempotent when the button is tapped twice', async () => {
    const sea = ocean();
    const visitor = sea.visitor();
    const found = await visitor.get('/api/bottle/random');
    await visitor.post(`/api/bottle/${found.data.bottle.id}/release`);
    const again = await visitor.post(`/api/bottle/${found.data.bottle.id}/release`);

    assert.equal(again.status, 200);
    const rows = await sea.db
      .prepare('SELECT COUNT(*) AS total FROM journeys WHERE bottle_id = ?1')
      .bind(found.data.bottle.id)
      .first();
    assert.equal(rows.total, 1);
  });

  it('cannot be used on a letter the visitor never found', async () => {
    const sea = ocean();
    const finder = sea.visitor();
    const stranger = sea.visitor();
    const found = await finder.get('/api/bottle/random');

    const attempt = await stranger.post(`/api/bottle/${found.data.bottle.id}/release`);
    assert.equal(attempt.status, 404);
  });
});

describe('reporting a letter', () => {
  it('thanks the reporter without explaining anything', async () => {
    const sea = ocean();
    const visitor = sea.visitor();
    const found = await visitor.get('/api/bottle/random');
    const report = await visitor.post(`/api/bottle/${found.data.bottle.id}/report`, {
      reason: 'spam',
    });

    assert.equal(report.status, 202);
    assert.match(report.data.message, /Thank you/);
  });

  it('needs a reason it recognises', async () => {
    const sea = ocean();
    const visitor = sea.visitor();
    const found = await visitor.get('/api/bottle/random');
    const report = await visitor.post(`/api/bottle/${found.data.bottle.id}/report`, {
      reason: 'because',
    });

    assert.equal(report.status, 400);
    assert.equal(report.data.error.code, 'reason_invalid');
  });

  it('pulls a letter out of the water once enough people report it', async () => {
    const sea = ocean();
    const first = sea.visitor();
    const found = await first.get('/api/bottle/random');
    const id = found.data.bottle.id;

    await first.post(`/api/bottle/${id}/report`, { reason: 'harassment' });
    await sea.visitor().post(`/api/bottle/${id}/report`, { reason: 'harassment' });
    await sea.visitor().post(`/api/bottle/${id}/report`, { reason: 'hate' });

    const row = await sea.db.prepare('SELECT status, report_count FROM bottles WHERE id = ?1').bind(id).first();
    assert.equal(row.report_count, 3);
    assert.equal(row.status, 'hidden');
    assert.equal((await first.get(`/api/bottle/${id}`)).status, 410);
  });

  it('counts one report per person per letter', async () => {
    const sea = ocean();
    const visitor = sea.visitor();
    const found = await visitor.get('/api/bottle/random');
    const id = found.data.bottle.id;

    await visitor.post(`/api/bottle/${id}/report`, { reason: 'spam' });
    await visitor.post(`/api/bottle/${id}/report`, { reason: 'spam' });

    const row = await sea.db.prepare('SELECT report_count FROM bottles WHERE id = ?1').bind(id).first();
    assert.equal(row.report_count, 1);
  });
});

describe('moderation queue', () => {
  const auth = { authorization: 'Bearer test-admin-token' };

  it('is closed without the token', async () => {
    const sea = ocean();
    assert.equal((await sea.visitor().get('/api/admin/queue')).status, 401);
  });

  it('lists letters waiting for a person', async () => {
    const sea = ocean();
    await sea.visitor().post('/api/bottle', { message: 'asdfasdfasdf asdfasdf' });
    const queue = await sea.visitor().get('/api/admin/queue', auth);

    assert.equal(queue.status, 200);
    assert.equal(queue.data.bottles.length, 1);
    assert.match(queue.data.bottles[0].moderation_reasons, /keyboard_mash/);
  });

  it('releases a held letter once it is approved', async () => {
    const sea = ocean();
    const writer = sea.visitor();
    const held = await writer.post('/api/bottle', { message: 'test test test test' });
    assert.equal(held.data.pending, true);

    const moderated = await sea
      .visitor()
      .post(`/api/admin/bottle/${held.data.bottle.id}/moderate`, { status: 'approved' }, auth);
    assert.equal(moderated.status, 200);

    const row = await sea.db
      .prepare('SELECT status, approved_at FROM bottles WHERE id = ?1')
      .bind(held.data.bottle.id)
      .first();
    assert.equal(row.status, 'approved');
    assert.ok(row.approved_at);
  });

  it('refuses a status it does not know', async () => {
    const sea = ocean();
    const letter = await sea.visitor().post('/api/bottle', { message: KIND_LETTER });
    const moderated = await sea
      .visitor()
      .post(`/api/admin/bottle/${letter.data.bottle.id}/moderate`, { status: 'sunk' }, auth);

    assert.equal(moderated.status, 400);
  });
});

describe('GET /api/stats', () => {
  it('counts the ocean without naming anybody', async () => {
    const sea = ocean();
    const visitor = sea.visitor();
    await visitor.get('/api/bottle/random');
    const { status, data } = await sea.visitor().get('/api/stats');

    assert.equal(status, 200);
    assert.ok(data.letters >= 24);
    assert.equal(data.replies >= 1, true);
    assert.equal(data.found >= 1, true);
    assert.equal(data.foundToday >= 1, true);
    assert.equal(typeof data.drifts, 'number');
  });
});

describe('routing', () => {
  it('answers a preflight for the configured origin', async () => {
    const sea = ocean();
    const { status, headers } = await sea
      .visitor()
      .request('OPTIONS', '/api/bottle', undefined, { origin: 'http://localhost:5173' });

    assert.equal(status, 204);
    assert.equal(headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal(headers.get('access-control-allow-credentials'), 'true');
  });

  it('does not hand CORS to an origin that was not configured', async () => {
    const sea = ocean();
    const { headers } = await sea
      .visitor()
      .request('OPTIONS', '/api/bottle', undefined, { origin: 'https://not-us.example' });

    assert.equal(headers.get('access-control-allow-origin'), null);
  });

  it('sets the same hardening headers on every response', async () => {
    const sea = ocean();
    const { headers } = await sea.visitor().get('/api/health');

    assert.equal(headers.get('x-content-type-options'), 'nosniff');
    assert.equal(headers.get('referrer-policy'), 'no-referrer');
  });

  it('separates an unknown path from a wrong method', async () => {
    const sea = ocean();
    assert.equal((await sea.visitor().get('/api/nowhere')).status, 404);
    assert.equal((await sea.visitor().post('/api/state')).status, 405);
  });
});
