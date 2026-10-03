import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const P = createRequire(import.meta.url)('../contrib-core.js');
const user = { email: 'a@pechanga.com', displayName: 'Alex' };
const TS = Symbol('ts');

describe('validateInput', () => {
  it('rejects empty note with no ratings', () => {
    assert.ok(P.validateInput({ note: '', ratings: null }));
    assert.ok(P.validateInput({ note: '   ', ratings: { Pride: '', Passion: '', Professionalism: '' } }));
  });
  it('accepts a note alone', () => assert.equal(P.validateInput({ note: 'good', ratings: null }), null));
  it('accepts ratings alone (select values are strings)', () => {
    assert.equal(P.validateInput({ note: '', ratings: { Pride: '3', Passion: '', Professionalism: '' } }), null);
  });
  it('enforces the 5000-character limit', () => {
    assert.equal(P.validateInput({ note: 'x'.repeat(5000), ratings: null }), null);
    assert.ok(P.validateInput({ note: 'x'.repeat(5001), ratings: null }));
  });
});

describe('normalizeRatings', () => {
  it('returns null when nothing is rated', () => {
    assert.equal(P.normalizeRatings(null), null);
    assert.equal(P.normalizeRatings({ Pride: '', Passion: null, Professionalism: undefined }), null);
  });
  it('converts strings to ints and blanks to null', () => {
    assert.deepEqual(P.normalizeRatings({ Pride: '3', Passion: '', Professionalism: '1' }),
      { Pride: 3, Passion: null, Professionalism: 1 });
  });
  it('drops out-of-range values', () => {
    assert.deepEqual(P.normalizeRatings({ Pride: '9', Passion: '2', Professionalism: '' }),
      { Pride: null, Passion: 2, Professionalism: null });
  });
});

describe('builders', () => {
  it('buildSubmitted matches the rules shape', () => {
    assert.deepEqual(P.buildSubmitted({ user, ts: TS }), {
      type: 'submitted', contributionId: null, rev: null,
      byEmail: 'a@pechanga.com', byName: 'Alex', at: TS, before: null, after: null,
    });
  });
  it('buildAdd creates rev 1 with an "added" log entry', () => {
    const r = P.buildAdd({ user, contributionId: 'c1', note: '  hi ', ratings: { Pride: '2', Passion: '', Professionalism: '' }, ts: TS });
    assert.deepEqual(r.contribution, {
      authorEmail: 'a@pechanga.com', authorName: 'Alex', note: 'hi',
      ratings: { Pride: 2, Passion: null, Professionalism: null },
      createdAt: TS, updatedAt: TS, rev: 1, retracted: false,
    });
    assert.equal(r.activityId, 'c1_1');
    assert.deepEqual(r.activity, {
      type: 'added', contributionId: 'c1', rev: 1, byEmail: 'a@pechanga.com', byName: 'Alex', at: TS,
      before: null, after: { note: 'hi', ratings: { Pride: 2, Passion: null, Professionalism: null } },
    });
  });
  it('falls back to the email when there is no display name', () => {
    const r = P.buildAdd({ user: { email: 'z@x.com' }, contributionId: 'c', note: 'n', ratings: null, ts: TS });
    assert.equal(r.contribution.authorName, 'z@x.com');
  });
  it('truncates a long display name to the 200-char rules cap', () => {
    const long = { email: 'a@pechanga.com', displayName: 'x'.repeat(300) };
    const r = P.buildAdd({ user: long, contributionId: 'c', note: 'n', ratings: null, ts: TS });
    assert.equal(r.contribution.authorName.length, 200);
    assert.equal(r.activity.byName.length, 200);
  });
  it('buildEdit bumps rev and records before/after', () => {
    const existing = { id: 'c1', rev: 1, note: 'old', ratings: null };
    const r = P.buildEdit({ user, existing, note: 'new', ratings: null, ts: TS });
    assert.deepEqual(r.update, { note: 'new', ratings: null, updatedAt: TS, rev: 2, retracted: false });
    assert.equal(r.activityId, 'c1_2');
    assert.equal(r.activity.type, 'edited');
    assert.deepEqual(r.activity.before, { note: 'old', ratings: null });
    assert.deepEqual(r.activity.after, { note: 'new', ratings: null });
  });
  it('buildRetract only flips the flag and keeps content in before and after', () => {
    const existing = { id: 'c1', rev: 2, note: 'keep', ratings: { Pride: 1, Passion: null, Professionalism: null } };
    const r = P.buildRetract({ user, existing, ts: TS });
    assert.deepEqual(r.update, { updatedAt: TS, rev: 3, retracted: true });
    assert.equal(r.activityId, 'c1_3');
    assert.equal(r.activity.type, 'retracted');
    assert.deepEqual(r.activity.before, r.activity.after);
    assert.equal(r.activity.after.note, 'keep');
  });
});

describe('describeActivity', () => {
  const base = { byName: 'Alex', contributionId: 'c1' };
  it('describes a submission', () => {
    assert.deepEqual(P.describeActivity({ ...base, type: 'submitted' }), { label: 'submitted the evaluation', lines: [] });
  });
  it('describes an addition with note and ratings', () => {
    const d = P.describeActivity({ ...base, type: 'added', after: { note: 'nice', ratings: { Pride: 3, Passion: null, Professionalism: null } } });
    assert.equal(d.label, 'added input');
    assert.deepEqual(d.lines, ['Note: nice', 'Ratings: Pride 3']);
  });
  it('lists only what changed in an edit', () => {
    const d = P.describeActivity({ ...base, type: 'edited',
      before: { note: 'a', ratings: null }, after: { note: 'b', ratings: null } });
    assert.deepEqual(d.lines, ['Note: "a" → "b"']);
    const d2 = P.describeActivity({ ...base, type: 'edited',
      before: { note: 'a', ratings: null }, after: { note: 'a', ratings: { Pride: 2, Passion: null, Professionalism: null } } });
    assert.deepEqual(d2.lines, ['Ratings: none → Pride 2']);
  });
  it('describes a retraction', () => {
    const d = P.describeActivity({ ...base, type: 'retracted', before: { note: 'oops', ratings: null }, after: { note: 'oops', ratings: null } });
    assert.equal(d.label, 'retracted their input');
    assert.deepEqual(d.lines, ['Was: oops']);
  });
});

describe('escapeHtml', () => {
  it('escapes markup characters', () => {
    assert.equal(P.escapeHtml(`<script>alert("x")</script> & 'y'`),
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;');
  });
  it('turns null and undefined into an empty string', () => {
    assert.equal(P.escapeHtml(null), '');
    assert.equal(P.escapeHtml(undefined), '');
  });
});
