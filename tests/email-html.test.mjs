import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const E = createRequire(import.meta.url)('../email-html.js');

const ev = {
  tmName: 'Pat <b>', period: 14, outlet: 'Agave', position: 'Cashier', area: 'FOH',
  evalDate: '2026-11-15', submittedByName: 'Arra', submittedBy: 'arra@x.com',
  softSkills: { g: { name: 'Guest engagement', critical: true, rating: 1, note: 'Slow greeting' } },
  competencies: { Pride: 3, Passion: 2 }, competencyComments: { Pride: 'Great energy' },
  strengths: 'Line 1\nLine 2', improvements: '', trainerName: 'Leo', trainerSigImg: 'data:...',
};

describe('buildHtml', () => {
  const html = E.buildHtml(ev, { teamName: 'Foodcourt', appUrl: 'https://example.com/app/' });
  it('escapes evaluation text', () => {
    assert.ok(html.includes('Pat &lt;b&gt;'));
    assert.ok(!html.includes('Pat <b>'));
  });
  it('flags a critical skill rated Improves', () => assert.match(html, /Critical skill needs attention/));
  it('links to the app', () => assert.ok(html.includes('href="https://example.com/app/"')));
  it('shows ratings, comments and line breaks', () => {
    assert.match(html, /3 · Exceeds expectations/);
    assert.ok(html.includes('Great energy'));
    assert.ok(html.includes('Line 1<br>Line 2'));
  });
  it('leaves out empty sections', () => assert.ok(!html.includes('Areas for improvement')));
  it('names the team', () => assert.ok(html.includes('Foodcourt')));
  it('works with no team and no ratings', () => {
    const h = E.buildHtml({ tmName: 'X', period: 30 });
    assert.match(h, /No competency ratings recorded/);
    assert.match(h, /admin alert list/);
  });
});
