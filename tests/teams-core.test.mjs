import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const T = createRequire(import.meta.url)('../teams-core.js');
const ts = ms => ({ toMillis: () => ms });

describe('parseEmails', () => {
  it('splits on commas, spaces, semicolons and new lines, lowercases and removes repeats', () => {
    assert.deepEqual(T.parseEmails(' A@x.com, b@x.com;\nc@x.com  a@X.com '),
      { emails: ['a@x.com', 'b@x.com', 'c@x.com'], invalid: [] });
  });
  it('reports entries that are not emails', () => {
    assert.deepEqual(T.parseEmails('a@x.com bob x@y'), { emails: ['a@x.com'], invalid: ['bob', 'x@y'] });
  });
  it('handles empty input', () => assert.deepEqual(T.parseEmails(''), { emails: [], invalid: [] }));
});

describe('validateName', () => {
  const teams = [{ id: 't1', name: 'Agave Leads' }];
  it('requires a name', () => assert.ok(T.validateName('  ')));
  it('limits the length', () => assert.ok(T.validateName('x'.repeat(81))));
  it('rejects a duplicate name, ignoring case', () => assert.ok(T.validateName('agave leads', teams)));
  it('allows keeping a team\'s own name when renaming', () => assert.equal(T.validateName('Agave Leads', teams, 't1'), null));
  it('accepts a new name', () => assert.equal(T.validateName('Pronto', teams), null));
});

describe('teamLabel', () => {
  const teams = [{ id: 't1', name: 'Agave Leads' }];
  it('names the team', () => assert.equal(T.teamLabel(teams, 't1'), 'Agave Leads'));
  it('says when there is no team', () => assert.equal(T.teamLabel(teams, undefined), 'No team'));
  it('says when the team was deleted', () => assert.equal(T.teamLabel(teams, 'gone'), 'Deleted team'));
});

describe('isMember', () => {
  it('matches regardless of case', () => assert.ok(T.isMember({ memberEmails: ['a@x.com'] }, 'A@X.com')));
  it('is false for no team', () => assert.equal(T.isMember(null, 'a@x.com'), false));
});

describe('mergeEvals', () => {
  it('merges, removes repeats and sorts newest first', () => {
    const a = [{ id: '1', submittedAt: ts(10) }, { id: '2', submittedAt: ts(30) }];
    const b = [{ id: '2', submittedAt: ts(30) }, { id: '3', submittedAt: ts(20) }];
    assert.deepEqual(T.mergeEvals([a, b]).map(e => e.id), ['2', '3', '1']);
  });
  it('respects the limit', () => {
    assert.equal(T.mergeEvals([[{ id: '1' }, { id: '2' }, { id: '3' }]], 2).length, 2);
  });
});

describe('countByTeam', () => {
  it('counts per team, with no-team and deleted-team evaluations under ""', () => {
    const teams = [{ id: 't1' }, { id: 't2' }];
    const evals = [{ teamId: 't1' }, { teamId: 't1' }, {}, { teamId: 'gone' }];
    assert.deepEqual(T.countByTeam(evals, teams), { '': 2, t1: 2, t2: 0 });
  });
});

describe('sortTeams', () => {
  it('sorts by name without changing the input', () => {
    const teams = [{ name: 'b' }, { name: 'A' }];
    assert.deepEqual(T.sortTeams(teams).map(t => t.name), ['A', 'b']);
    assert.equal(teams[0].name, 'b');
  });
});
