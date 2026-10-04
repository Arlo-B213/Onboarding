import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const S = createRequire(import.meta.url)('../softskills.js');
const nums = list => list.map(s => s.num);
const ids = list => list.map(s => s.id);

describe('all-employee skills by period', () => {
  it('14-day: guest engagement, positive attitude, professionalism & appearance', () => {
    assert.deepEqual(nums(S.skillsFor(14, 'line').skills), [1, 8, 10]);
  });
  it('30-day adds communication clarity and teamwork', () => {
    assert.deepEqual(nums(S.skillsFor(30, 'line').skills), [1, 2, 4, 8, 10]);
  });
  it('45-day adds adaptability and time management', () => {
    assert.deepEqual(nums(S.skillsFor(45, 'line').skills), [1, 2, 3, 4, 6, 8, 10]);
  });
  it('60-day shows all ten', () => {
    assert.deepEqual(nums(S.skillsFor(60, 'line').skills), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
  it('accepts the period as a string', () => {
    assert.deepEqual(nums(S.skillsFor('30', 'line').skills), [1, 2, 4, 8, 10]);
  });
  it('only the three non-negotiables are critical', () => {
    assert.deepEqual(ids(S.SOFT_SKILLS.filter(s => s.critical)).sort(),
      ['communication_clarity', 'conflict_resolution', 'guest_engagement']);
  });
});

describe('leadership skills', () => {
  it('line level never gets the leadership block', () => {
    [14, 30, 45, 60].forEach(p => assert.deepEqual(S.skillsFor(p, 'line').leadership, []));
  });
  it('an unknown role level never gets the leadership block', () => {
    assert.deepEqual(S.skillsFor(60, null).leadership, []);
  });
  it('leaders are phased: 2, then 3, then 4, then all 5', () => {
    assert.deepEqual(ids(S.skillsFor(14, 'leadership').leadership), ['emotional_intelligence', 'cross_functional_communication']);
    assert.deepEqual(ids(S.skillsFor(30, 'leadership').leadership),
      ['emotional_intelligence', 'decisiveness', 'cross_functional_communication']);
    assert.equal(S.skillsFor(45, 'leadership').leadership.length, 4);
    assert.equal(S.skillsFor(60, 'leadership').leadership.length, 5);
  });
  it('leaders also get the all-employee skills for the period', () => {
    assert.deepEqual(nums(S.skillsFor(14, 'leadership').skills), [1, 8, 10]);
  });
});

describe('roleLevel', () => {
  it('maps dropdown positions to a level', () => {
    assert.equal(S.roleLevel('Food Server'), 'line');
    assert.equal(S.roleLevel('Cashier'), 'line');
    assert.equal(S.roleLevel('Other (line level)'), 'line');
    assert.equal(S.roleLevel('Lead (any area)'), 'leadership');
    assert.equal(S.roleLevel('Sous Chef'), 'leadership');
    assert.equal(S.roleLevel('Director'), 'leadership');
    assert.equal(S.roleLevel('Other (leadership)'), 'leadership');
  });
  it('ignores case and surrounding spaces', () => {
    assert.equal(S.roleLevel('  sous chef '), 'leadership');
  });
  it('returns null for empty or unrecognized positions', () => {
    assert.equal(S.roleLevel(''), null);
    assert.equal(S.roleLevel(undefined), null);
    assert.equal(S.roleLevel('Astronaut'), null);
  });
  it('lists every position once, grouped by level', () => {
    const g = S.positionsByLevel();
    assert.ok(g.line.includes('Food Server') && g.leadership.includes('Sous Chef'));
    const all = [...g.line, ...g.leadership];
    assert.equal(new Set(all).size, all.length);
  });
});

describe('Asst. Chef and areas (FOH / BOH)', () => {
  it('Asst. Chef is a leadership position', () => {
    assert.equal(S.roleLevel('Asst. Chef'), 'leadership');
    assert.ok(S.positionsByLevel().leadership.includes('Asst. Chef'));
  });
  it('kitchen positions are BOH', () => {
    ['Line Cook', 'Prep Cook', 'Dishwasher', 'Sous Chef', 'Asst. Chef', 'Chef'].forEach(p =>
      assert.equal(S.areaFor(p), 'BOH', p));
  });
  it('floor and bar positions are FOH', () => {
    ['Food Server', 'Server Assistant / Busser', 'Host / Hostess', 'Food Runner', 'Bartender', 'Barback', 'Cashier'].forEach(p =>
      assert.equal(S.areaFor(p), 'FOH', p));
  });
  it('positions that could be either side return null so the evaluator chooses', () => {
    ['Lead (any area)', 'Supervisor', 'Assistant Manager', 'Manager', 'Director', 'Other (line level)', 'Other (leadership)'].forEach(p =>
      assert.equal(S.areaFor(p), null, p));
  });
  it('is case-insensitive and null for empty or unknown positions', () => {
    assert.equal(S.areaFor('  asst. chef '), 'BOH');
    assert.equal(S.areaFor(''), null);
    assert.equal(S.areaFor('Astronaut'), null);
  });
});

describe('critical skills', () => {
  const skills = S.skillsFor(60, 'line').skills;
  it('lists critical skills that have no rating', () => {
    const missing = S.missingCritical(skills, { guest_engagement: 3 });
    assert.deepEqual(missing.sort(), ['Communication clarity', 'Conflict resolution']);
  });
  it('is empty when every critical skill is rated', () => {
    assert.deepEqual(S.missingCritical(skills, { guest_engagement: 2, communication_clarity: 1, conflict_resolution: 3 }), []);
  });
  it('does not require critical skills that are not on the form yet', () => {
    // at 14 days only guest engagement is critical
    assert.deepEqual(S.missingCritical(S.skillsFor(14, 'line').skills, { guest_engagement: 3 }), []);
  });
  it('flags only critical skills rated 1', () => {
    const saved = {
      guest_engagement: { name: 'Guest engagement & hospitality mindset', critical: true, rating: 1, note: '' },
      teamwork: { name: 'Teamwork & collaboration', critical: false, rating: 1, note: '' },
      communication_clarity: { name: 'Communication clarity', critical: true, rating: 3, note: '' },
    };
    assert.deepEqual(S.flaggedSkills(saved), ['Guest engagement & hospitality mindset']);
  });
  it('handles missing soft skills (older evaluations)', () => {
    assert.deepEqual(S.flaggedSkills(undefined), []);
  });
});

describe('formatting', () => {
  it('names the 3-point scale', () => {
    assert.equal(S.scaleLabel(3), 'Exceeds (3)');
    assert.equal(S.scaleLabel(2), 'Meets (2)');
    assert.equal(S.scaleLabel(1), 'Improves (1)');
    assert.equal(S.scaleLabel(null), 'Not rated');
  });
  it('builds the email lines with groups, notes and a critical warning', () => {
    const saved = {
      guest_engagement: { name: 'Guest engagement & hospitality mindset', group: 'all', critical: true, rating: 1, note: 'Needs eye contact' },
      emotional_intelligence: { name: 'Emotional intelligence', group: 'leadership', critical: false, rating: 3, note: '' },
    };
    const text = S.emailLines(saved).join('\n');
    assert.match(text, /All-employee soft skills/);
    assert.match(text, /Guest engagement & hospitality mindset \[CRITICAL\]: Improves \(1\) — Needs eye contact/);
    assert.match(text, /Leadership focus/);
    assert.match(text, /Emotional intelligence: Exceeds \(3\)/);
    assert.match(text, /Critical skills rated Improves: Guest engagement & hospitality mindset/);
  });
  it('omits the leadership heading when there are no leadership skills', () => {
    const saved = { teamwork: { name: 'Teamwork & collaboration', group: 'all', critical: false, rating: 2, note: '' } };
    assert.doesNotMatch(S.emailLines(saved).join('\n'), /Leadership focus/);
  });
  it('says so when no soft skills were recorded', () => {
    assert.deepEqual(S.emailLines(undefined), ['(none recorded)']);
  });
});
