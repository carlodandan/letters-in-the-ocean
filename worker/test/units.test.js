import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { moderate, parseBlocklist } from '../src/moderation.js';
import { countCharacters, normalizeMessage, validateMessage } from '../src/validate.js';
import { signToken, verifyToken } from '../src/identity.js';
import { nextResetIso } from '../src/quota.js';
import { utcDay } from '../src/util.js';

describe('validation', () => {
  it('accepts an ordinary letter', () => {
    const result = validateMessage('  You are doing better than you think.  ');
    assert.equal(result.ok, true);
    assert.equal(result.value, 'You are doing better than you think.');
  });

  it('refuses something too short to be a letter', () => {
    assert.equal(validateMessage('hi').ok, false);
    assert.equal(validateMessage('hi').error.code, 'message_too_short');
  });

  it('refuses a letter over the limit and says how much to trim', () => {
    const result = validateMessage('a'.repeat(540));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'message_too_long');
    assert.equal(result.error.length, 540);
  });

  it('refuses text with no readable words', () => {
    assert.equal(validateMessage('!!! ... ??? ,,, ;;; ***').error.code, 'message_unreadable');
  });

  it('strips zero-width and control characters before anything else sees them', () => {
    const smuggled = `sub​scribe to my­ channel`;
    assert.equal(normalizeMessage(smuggled), 'subscribe to my channel');
  });

  it('collapses runaway whitespace but keeps paragraphs', () => {
    assert.equal(normalizeMessage('one\n\n\n\n\ntwo'), 'one\n\ntwo');
  });

  it('counts an emoji as a single character', () => {
    assert.equal(countCharacters('👩‍👩‍👦'), 1);
  });
});

describe('moderation', () => {
  const approve = (text) => moderate(text).decision;

  it('lets kindness straight through', () => {
    assert.equal(approve('Whatever you are carrying today, I hope tomorrow feels lighter.'), 'approved');
    assert.equal(approve('My grandmother learned to swim at sixty-one. Nobody is timing you.'), 'approved');
  });

  it('rejects links, contact details and advertising', () => {
    assert.equal(approve('read more at https://example.com'), 'rejected');
    assert.equal(approve('email me at someone@example.org please'), 'rejected');
    assert.equal(approve('Subscribe to my channel for more tips'), 'rejected');
    assert.equal(approve('Make $500 a day working from home, guaranteed'), 'rejected');
  });

  it('rejects abuse and hate', () => {
    assert.equal(approve('you are worthless and everyone knows it'), 'rejected');
    assert.equal(approve('go back to your country'), 'rejected');
  });

  it('holds a crisis message for a person instead of refusing it', () => {
    const verdict = moderate('some days I want to die and I do not know who to tell');
    assert.equal(verdict.decision, 'pending');
    assert.equal(verdict.care, true);
  });

  it('still welcomes plain sadness', () => {
    const verdict = moderate('I am frightened that I am falling behind everyone else.');
    assert.equal(verdict.decision, 'approved');
    assert.equal(verdict.care, false);
  });

  it('holds mashed keys and placeholder text', () => {
    assert.equal(approve('asdfasdfasdf'), 'pending');
    assert.equal(approve('test test'), 'pending');
  });

  it('flags shouting as a soft signal without refusing the letter', () => {
    const verdict = moderate('EVERYTHING IS GOING TO BE COMPLETELY FINE I PROMISE YOU');
    assert.ok(verdict.reasons.includes('shouting'));
    assert.equal(verdict.decision, 'approved');
  });

  it('applies a configured blocklist', () => {
    const blocklist = parseBlocklist(' Foo, bar ');
    assert.deepEqual(blocklist, ['foo', 'bar']);
    assert.equal(moderate('a perfectly nice sentence about foo', { blocklist }).decision, 'rejected');
  });
});

describe('anonymous identity', () => {
  it('round-trips a signed token', async () => {
    const token = await signToken('visitor-1', 1730000000, 'secret');
    const parsed = await verifyToken(token, 'secret');
    assert.equal(parsed.id, 'visitor-1');
    assert.equal(parsed.issuedAt, 1730000000);
  });

  it('refuses a token signed with another secret', async () => {
    const token = await signToken('visitor-1', 1730000000, 'secret');
    assert.equal(await verifyToken(token, 'other-secret'), null);
  });

  it('refuses a tampered id', async () => {
    const token = await signToken('visitor-1', 1730000000, 'secret');
    const forged = token.replace('visitor-1', 'visitor-2');
    assert.equal(await verifyToken(forged, 'secret'), null);
  });
});

describe('quota clock', () => {
  it('resets at the next UTC midnight', () => {
    assert.equal(nextResetIso('2026-08-31'), '2026-09-01T00:00:00.000Z');
    assert.equal(nextResetIso('2026-12-31'), '2027-01-01T00:00:00.000Z');
  });

  it('uses a single global day key', () => {
    assert.equal(utcDay(new Date('2026-08-31T23:59:59Z')), '2026-08-31');
    assert.equal(utcDay(new Date('2026-09-01T00:00:01Z')), '2026-09-01');
  });
});
