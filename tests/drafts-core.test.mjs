import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PrideDrafts = require('../drafts-core.js');

const stamp = ms => ({ toMillis: () => ms });

describe('PrideDrafts.decode', () => {
  it('returns the snapshot for a valid payload', () => {
    const s = { period: '30', vals: { 'f-tm-name': 'Pat' }, checks: {}, sigs: { trainer: '', tm: '' } };
    assert.deepEqual(PrideDrafts.decode(JSON.stringify(s)), s);
  });

  it('rejects text that is not JSON', () => {
    assert.equal(PrideDrafts.decode('{not json'), null);
  });

  it('rejects payloads without a vals object', () => {
    assert.equal(PrideDrafts.decode('null'), null);
    assert.equal(PrideDrafts.decode('"text"'), null);
    assert.equal(PrideDrafts.decode('{"period":"30"}'), null);
    assert.equal(PrideDrafts.decode('{"vals":"nope"}'), null);
  });
});

describe('PrideDrafts.sortNewestFirst', () => {
  it('orders by updatedAt, newest first, without mutating the input', () => {
    const list = [
      { id: 'old', updatedAt: stamp(1000) },
      { id: 'new', updatedAt: stamp(3000) },
      { id: 'mid', updatedAt: stamp(2000) },
    ];
    const sorted = PrideDrafts.sortNewestFirst(list);
    assert.deepEqual(sorted.map(d => d.id), ['new', 'mid', 'old']);
    assert.deepEqual(list.map(d => d.id), ['old', 'new', 'mid']);
  });

  it('puts a draft with a pending timestamp first', () => {
    const list = [{ id: 'saved', updatedAt: stamp(Date.now() - 60000) }, { id: 'pending', updatedAt: null }];
    assert.equal(PrideDrafts.sortNewestFirst(list)[0].id, 'pending');
  });
});

describe('PrideDrafts.title', () => {
  it('uses the team member name, or a fallback when blank', () => {
    assert.equal(PrideDrafts.title({ tmName: '  Pat Lee ' }), 'Pat Lee');
    assert.equal(PrideDrafts.title({ tmName: '   ' }), 'Untitled draft');
    assert.equal(PrideDrafts.title({}), 'Untitled draft');
  });
});
