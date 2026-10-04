import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import fs from 'node:fs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const require = createRequire(import.meta.url);
const P = require('../pdf.js');

// 1x1 transparent PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const NOW = new Date('2026-10-04T15:30:00Z');

const evaluation = (over = {}) => ({
  tmName: 'Taylor Soft', outlet: 'Agave', position: 'Sous Chef', area: 'BOH', roleLevel: 'leadership',
  startDate: '2026-08-01', evalDate: '2026-10-03', period: 60,
  submittedByName: 'Leader One', submittedBy: 'leader1@test.com',
  submittedAt: { toDate: () => new Date('2026-10-03T20:00:00Z') },
  classes: { a: { label: 'PRIDE Training Graduation Review', completed: true }, b: { label: 'Career Development & Goals', completed: false } },
  softSkills: {
    guest_engagement: { name: 'Guest engagement & hospitality mindset', group: 'all', critical: true, rating: 1, note: 'Avoids eye contact' },
    teamwork: { name: 'Teamwork & collaboration', group: 'all', critical: false, rating: 3, note: '' },
    coaching: { name: 'Coaching & developing others', group: 'leadership', critical: false, rating: 2, note: 'Weekly 1:1s' },
  },
  competencies: { Pride: 3, Passion: 2, Professionalism: 2 },
  policies: 'Cash handling and the 5/10 rule.', expectations: 'Lead a section.', strengths: 'Warm.', improvements: 'Speed.', trainerNotes: '',
  trainerName: 'Leader One', trainerSigImg: PNG, trainerSignedAt: '2026-10-03T20:00:00.000Z',
  tmSigImg: '', tmSig: 'Taylor Soft', managerSig: 'Pat Manager',
  ...over,
});
const note = (over = {}) => ({
  id: 'n1', section: 'classes', authorName: 'Leader Two', authorEmail: 'leader2@test.com',
  createdAt: { toDate: () => new Date('2026-10-03T21:00:00Z') }, note: 'Thorough review', ratings: null, retracted: false, rev: 1, ...over,
});

describe('fileName', () => {
  it('builds a tidy name from the team member, period and date', () => {
    assert.equal(P.fileName(evaluation(), NOW), 'PRIDE-Evaluation-Taylor-Soft-60Day-2026-10-04.pdf');
  });
  it('removes characters that are unsafe in file names and drops accents', () => {
    assert.equal(P.fileName(evaluation({ tmName: 'Ana "Q" / Ríos: <x>' }), NOW), 'PRIDE-Evaluation-Ana-Q-Rios-x-60Day-2026-10-04.pdf');
  });
  it('falls back when the name is empty and caps very long names', () => {
    assert.match(P.fileName(evaluation({ tmName: '   ' }), NOW), /^PRIDE-Evaluation-Team-Member-/);
    assert.ok(P.fileName(evaluation({ tmName: 'x'.repeat(200) }), NOW).length < 90);
  });
});

describe('pdfText (the built-in PDF fonts only cover Latin-1)', () => {
  it('keeps ordinary text, accents and typographic punctuation', () => {
    assert.equal(P.pdfText('Café — “quoted” • ok…'), 'Café — “quoted” • ok…');
  });
  it('replaces characters the fonts cannot draw', () => {
    assert.equal(P.pdfText('Warning ⚠ → done ✔ 😀 漢'), 'Warning ? ? done ? ? ?');
  });
  it('handles null and numbers', () => {
    assert.equal(P.pdfText(null), '');
    assert.equal(P.pdfText(7), '7');
  });
});

describe('model', () => {
  it('lists the details with dashes for missing values', () => {
    const m = P.model(evaluation({ startDate: '', area: '', position: 'Manager' }), [], NOW);
    const d = Object.fromEntries(m.details);
    assert.equal(d['Team Member'], 'Taylor Soft');
    assert.equal(d['Position'], 'Manager');
    assert.equal(d['Role level'], 'Leadership');
    assert.equal(d['Area'], '—', 'Manager could be either side, so there is no area to derive');
    assert.equal(d['Start date'], '—');
    assert.equal(d['Evaluation date'], 'Oct 3, 2026');
    assert.equal(m.title, '60-Day Evaluation');
  });
  it('derives the area from the position for evaluations saved without one', () => {
    const d = Object.fromEntries(P.model(evaluation({ area: '' }), [], NOW).details);
    assert.equal(d['Area'], 'BOH');
  });
  it('flags critical skills rated Improves', () => {
    assert.deepEqual(P.model(evaluation(), [], NOW).flagged, ['Guest engagement & hospitality mindset']);
  });
  it('splits soft skills into all-employee and leadership groups', () => {
    const m = P.model(evaluation(), [], NOW);
    assert.deepEqual(m.skills.all.map(s => s.name), ['Guest engagement & hospitality mindset', 'Teamwork & collaboration']);
    assert.deepEqual(m.skills.leadership.map(s => s.name), ['Coaching & developing others']);
    assert.equal(m.skills.all[0].ratingLabel, 'Improves (1)');
  });
  it('copes with older evaluations that have no soft skills', () => {
    const m = P.model(evaluation({ softSkills: undefined }), [], NOW);
    assert.deepEqual(m.skills, { all: [], leadership: [] });
    assert.deepEqual(m.flagged, []);
  });
  it('puts section notes under their section and legacy notes under general', () => {
    const m = P.model(evaluation(), [note(), note({ id: 'n2', section: undefined, note: 'Overall great' }), note({ id: 'n3', section: 'bogus', note: 'Odd' })], NOW);
    assert.deepEqual(m.sectionNotes.classes.map(n => n.text), ['Thorough review']);
    assert.deepEqual(m.sectionNotes.general.map(n => n.text), ['Overall great', 'Odd']);
  });
  it('attaches skill notes to their skill row', () => {
    const m = P.model(evaluation(), [note({ section: 'skill:guest_engagement', note: 'Coached on greetings' })], NOW);
    assert.deepEqual(m.skills.all[0].notes.map(n => n.text), ['Coached on greetings']);
    assert.deepEqual(m.sectionNotes.soft_skills || [], []);
  });
  it('keeps a note about a skill that is not on the evaluation, labelled with the skill', () => {
    const m = P.model(evaluation(), [note({ section: 'skill:conflict_resolution', note: 'Stayed calm' })], NOW);
    assert.equal(m.sectionNotes.soft_skills.length, 1);
    assert.equal(m.sectionNotes.soft_skills[0].about, 'Conflict resolution');
  });
  it('leaves retracted notes out and includes the author and ratings text', () => {
    const m = P.model(evaluation(), [note({ retracted: true }), note({ id: 'g', section: 'general', ratings: { Pride: 3, Passion: null, Professionalism: null } })], NOW);
    assert.equal((m.sectionNotes.classes || []).length, 0);
    assert.equal(m.sectionNotes.general[0].author, 'Leader Two');
    assert.equal(m.sectionNotes.general[0].ratingsText, 'Pride 3');
  });
  it('uses drawn signatures, ignores invalid image data, and keeps legacy typed signatures', () => {
    const m = P.model(evaluation({ tmSigImg: 'javascript:alert(1)' }), [], NOW);
    const [trainer, member] = m.signatures;
    assert.equal(trainer.image, PNG);
    assert.equal(trainer.name, 'Leader One');
    assert.match(trainer.signedAt, /Oct 3, 2026/);
    assert.equal(member.image, '');
    assert.equal(member.text, 'Taylor Soft');
    assert.equal(m.manager, 'Pat Manager');
  });
  it('reads dates from Firestore timestamps, Dates and strings', () => {
    assert.match(P.fmtDateTime({ toDate: () => new Date('2026-10-03T20:00:00Z') }), /Oct 3, 2026/);
    assert.match(P.fmtDateTime(new Date('2026-10-03T20:00:00Z')), /Oct 3, 2026/);
    assert.match(P.fmtDateTime('2026-10-03T20:00:00.000Z'), /Oct 3, 2026/);
    assert.equal(P.fmtDateTime(undefined), '—');
    assert.equal(P.fmtDate('2026-10-03'), 'Oct 3, 2026');
    assert.equal(P.fmtDate(''), '—');
  });
});

describe('loaded the way the browser loads it', () => {
  // Classic <script> tags share top-level const declarations without putting them on window and
  // without `require`/`module`. Running the files in one vm context reproduces exactly that.
  const ctx = vm.createContext({ console });
  for (const f of ['softskills.js', 'contrib-core.js', 'signature.js', 'pdf.js']) {
    vm.runInContext(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'), ctx, { filename: f });
  }
  it('builds the model using the globals from the other scripts', () => {
    const m = vm.runInContext(`PridePdf.model(${JSON.stringify(evaluation())}, [], new Date('2026-10-04T15:30:00Z'))`, ctx);
    assert.equal(m.title, '60-Day Evaluation');
    assert.deepEqual(Array.from(m.flagged), ['Guest engagement & hospitality mindset']);
    assert.equal(m.signatures[0].image, PNG);
  });
  it('maps skill notes to skills, which needs PrideContrib', () => {
    const notes = JSON.stringify([{ id: 'k', section: 'skill:guest_engagement', note: 'hi', authorName: 'L2', retracted: false }]);
    const m = vm.runInContext(`PridePdf.model(${JSON.stringify(evaluation())}, ${notes}, new Date())`, ctx);
    assert.equal(m.skills.all[0].notes[0].text, 'hi');
  });
});

describe('render', () => {
  const make = (e, notes) => {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    P.render(doc, P.model(e, notes, NOW), autoTable);
    return doc;
  };
  it('produces a valid, multi-section PDF', () => {
    const doc = make(evaluation(), [note(), note({ section: 'skill:guest_engagement', note: 'Coached on greetings' })]);
    const out = Buffer.from(doc.output('arraybuffer'));
    assert.equal(out.subarray(0, 5).toString(), '%PDF-');
    assert.ok(out.length > 5000);
    assert.ok(doc.getNumberOfPages() >= 1);
  });
  it('flows onto extra pages when there is a lot of content', () => {
    const many = Array.from({ length: 40 }, (_, i) => note({ id: 'n' + i, section: 'policies', note: 'A long note. '.repeat(40) }));
    const doc = make(evaluation({ policies: 'Policy text. '.repeat(400) }), many);
    assert.ok(doc.getNumberOfPages() >= 4, `pages: ${doc.getNumberOfPages()}`);
  });
  it('survives an evaluation with almost nothing in it', () => {
    const doc = make({ tmName: 'Min', period: 14, evalDate: '2026-10-03' }, []);
    assert.ok(doc.getNumberOfPages() >= 1);
  });
  it('survives text jsPDF fonts cannot draw', () => {
    const doc = make(evaluation({ policies: 'Check ✔ and warn ⚠ 漢字 😀' }), [note({ note: 'emoji 😀 → ok' })]);
    assert.ok(Buffer.from(doc.output('arraybuffer')).length > 3000);
  });
});
