import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const E = createRequire(import.meta.url)('../evals-core.js');
const ts = ms => ({ toMillis: () => ms });
const ev = (id, tmName, period, at, teamId = 't1') => ({ id, tmName, period, teamId, submittedAt: ts(at) });

describe('groupEvals', () => {
  const list = [
    ev('a', 'David St. Onge', 14, 10),
    ev('b', '  david  st. onge ', 14, 30),   // same person, messy spacing / case
    ev('c', 'David St. Onge', 30, 20),
    ev('d', 'Maria Lopez', 14, 40),
    ev('e', 'David St. Onge', 14, 5, 't2'), // same name on another team = another row
  ];
  const groups = E.groupEvals(list);
  it('makes one group per team member and team', () => assert.equal(groups.length, 3));
  it('orders groups by their latest submission', () => assert.deepEqual(groups.map(g => g.latest.id), ['d', 'b', 'e']));
  it('puts repeat entries for a period together, newest first', () => {
    const david = groups.find(g => g.latest.id === 'b');
    assert.deepEqual(david.byPeriod[14].map(e => e.id), ['b', 'a']);
    assert.deepEqual(david.byPeriod[30].map(e => e.id), ['c']);
    assert.equal(david.count, 3);
  });
  it('keeps unusual periods visible', () => {
    assert.deepEqual(E.groupEvals([ev('x', 'A', 90, 1)])[0].otherPeriods, [90]);
  });
  it('handles no evaluations', () => assert.deepEqual(E.groupEvals([]), []));
});

describe('normalizeName', () => {
  it('ignores case, spaces, punctuation and accents', () => {
    const k = E.normalizeName('David St . Onge');
    for (const v of ['david st. onge', 'David  St.Onge', 'DAVID ST ONGE']) assert.equal(E.normalizeName(v), k);
    assert.equal(E.normalizeName('José Peña'), E.normalizeName('jose pena'));
  });
  it('still tells different names apart', () => assert.notEqual(E.normalizeName('Maria Lopez'), E.normalizeName('Mario Lopez')));
});

describe('siblings', () => {
  it('returns every submission for the same person and period', () => {
    const list = [ev('a', 'Pat', 14, 1), ev('b', 'pat', 14, 2), ev('c', 'Pat', 30, 3)];
    assert.deepEqual(E.siblings(list, list[0]).map(e => e.id), ['b', 'a']);
  });
});

describe('details', () => {
  it('fills missing fields', () => {
    assert.deepEqual(E.detailsOf({ tmName: 'Pat', period: '30' }),
      { tmName: 'Pat', position: '', outlet: '', area: '', startDate: '', evalDate: '', period: 30 });
  });
  it('validates', () => {
    assert.ok(E.validateDetails({ tmName: ' ', period: 14 }));
    assert.ok(E.validateDetails({ tmName: 'Pat', period: 90 }));
    assert.equal(E.validateDetails({ tmName: 'Pat', period: 45 }), null);
  });
  it('lists what changed', () => {
    const before = E.detailsOf({ tmName: 'Pat', period: 30, outlet: 'Agave' });
    const after = { ...before, tmName: 'Patricia', period: 14 };
    assert.deepEqual(E.diffDetails(before, after).map(c => `${c.label}: ${c.from} → ${c.to}`),
      ['Name: Pat → Patricia', 'Period: 30 → 14']);
  });
});
