/* Pure helpers for leader contributions. No DOM and no Firebase calls, so they can be
   unit-tested in Node. Loaded in the browser as the global `PrideContrib`. */
const PrideContrib = (() => {
  const COMPETENCIES = ['Pride', 'Passion', 'Professionalism'];
  const MAX_NOTE = 5000;

  // Evaluation sections that can take leader notes. 'general' is the box at the bottom (the only one
  // that also takes ratings) and is what notes saved before sections existed count as.
  const GENERAL = 'general';
  const SECTIONS = [
    { id: 'info', label: 'Team Member Information' },
    { id: 'classes', label: 'Classes / Training Modules' },
    { id: 'soft_skills', label: 'Soft Skills' },
    { id: 'competencies', label: 'Competency Ratings' },
    { id: 'policies', label: 'Policies Reviewed' },
    { id: 'expectations', label: 'Expectations for Next Period' },
    { id: 'observations', label: 'Trainer Observations' },
    { id: 'signatures', label: 'Signatures' },
  ];
  // A note can also be about one soft skill: section 'skill:<skill id>' (ids come from softskills.js)
  const isSkillSection = id => typeof id === 'string' && /^skill:[a-z_]{1,60}$/.test(id);
  const isSection = id => SECTIONS.some(s => s.id === id) || isSkillSection(id);
  const normalizeSection = id => (isSection(id) ? id : GENERAL);

  // Skill names come from softskills.js: a browser global, or required when running in Node
  function skillName(skillId) {
    let skills = null;
    try { skills = typeof PrideSkills !== 'undefined' ? PrideSkills : (typeof require !== 'undefined' ? require('./softskills.js') : null); } catch (e) { /* not available */ }
    const hit = skills && [...skills.SOFT_SKILLS, ...skills.LEADERSHIP_SKILLS].find(s => s.id === skillId);
    return hit ? hit.name : null;
  }
  const sectionLabel = id => (isSkillSection(id)
    ? (skillName(id.slice('skill:'.length)) || 'Soft skill')
    : (SECTIONS.find(s => s.id === id) || { label: 'General' }).label);

  const actorName = user => (user.displayName || user.email).slice(0, 200);

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // null when nothing is rated, otherwise all three competencies as 1-3 or null
  function normalizeRatings(ratings) {
    if (!ratings) return null;
    const out = {};
    let any = false;
    for (const c of COMPETENCIES) {
      const raw = ratings[c];
      const n = raw === '' || raw == null ? null : Number(raw);
      out[c] = n === 1 || n === 2 || n === 3 ? n : null;
      if (out[c] !== null) any = true;
    }
    return any ? out : null;
  }

  function ratingText(ratings) {
    if (!ratings) return 'none';
    const parts = COMPETENCIES.filter(c => ratings[c] != null).map(c => `${c} ${ratings[c]}`);
    return parts.length ? parts.join(', ') : 'none';
  }

  function validateInput({ note, ratings, section }) {
    const text = (note || '').trim();
    if (text.length > MAX_NOTE) return `Note must be ${MAX_NOTE} characters or fewer.`;
    if (isSection(section)) return text ? null : 'Write a note first.';
    if (!text && !normalizeRatings(ratings)) return 'Add a note or rate at least one competency.';
    return null;
  }

  const snapshot = c => ({ note: c.note, ratings: c.ratings == null ? null : c.ratings });

  function buildSubmitted({ user, ts }) {
    return {
      type: 'submitted', contributionId: null, rev: null,
      byEmail: user.email, byName: actorName(user), at: ts, before: null, after: null,
    };
  }

  function buildAdd({ user, contributionId, note, ratings, section, ts }) {
    const sec = normalizeSection(section);
    const n = (note || '').trim();
    const r = sec === GENERAL ? normalizeRatings(ratings) : null; // section notes are text only
    return {
      contribution: {
        authorEmail: user.email, authorName: actorName(user), note: n, ratings: r,
        createdAt: ts, updatedAt: ts, rev: 1, retracted: false, section: sec,
      },
      activityId: `${contributionId}_1`,
      activity: {
        type: 'added', contributionId, rev: 1, byEmail: user.email, byName: actorName(user), at: ts,
        before: null, after: { note: n, ratings: r }, section: sec,
      },
    };
  }

  function buildEdit({ user, existing, note, ratings, ts }) {
    const n = (note || '').trim();
    const r = normalizeRatings(ratings);
    const rev = existing.rev + 1;
    return {
      update: { note: n, ratings: r, updatedAt: ts, rev, retracted: false },
      activityId: `${existing.id}_${rev}`,
      activity: {
        type: 'edited', contributionId: existing.id, rev, byEmail: user.email, byName: actorName(user), at: ts,
        before: snapshot(existing), after: { note: n, ratings: r }, section: normalizeSection(existing.section),
      },
    };
  }

  function buildRetract({ user, existing, ts }) {
    const rev = existing.rev + 1;
    return {
      update: { updatedAt: ts, rev, retracted: true },
      activityId: `${existing.id}_${rev}`,
      activity: {
        type: 'retracted', contributionId: existing.id, rev, byEmail: user.email, byName: actorName(user), at: ts,
        before: snapshot(existing), after: snapshot(existing), section: normalizeSection(existing.section),
      },
    };
  }

  // Human-readable summary of one activity entry; `lines` are plain text (escape before rendering)
  function describeActivity(e) {
    const sec = normalizeSection(e.section);
    const on = sec === GENERAL ? '' : ` on ${sectionLabel(sec)}`;
    switch (e.type) {
      case 'submitted':
        return { label: 'submitted the evaluation', lines: [] };
      case 'added':
        return {
          label: sec === GENERAL ? 'added input' : `added a note${on}`,
          lines: sec === GENERAL ? [`Note: ${e.after.note || '(none)'}`, `Ratings: ${ratingText(e.after.ratings)}`] : [`Note: ${e.after.note || '(none)'}`],
        };
      case 'edited': {
        const lines = [];
        if (e.before.note !== e.after.note) lines.push(`Note: "${e.before.note}" → "${e.after.note}"`);
        if (ratingText(e.before.ratings) !== ratingText(e.after.ratings)) {
          lines.push(`Ratings: ${ratingText(e.before.ratings)} → ${ratingText(e.after.ratings)}`);
        }
        return { label: sec === GENERAL ? 'edited their input' : `edited their note${on}`, lines };
      }
      case 'retracted':
        return { label: sec === GENERAL ? 'retracted their input' : `retracted their note${on}`, lines: [`Was: ${e.before.note || ratingText(e.before.ratings)}`] };
      default:
        return { label: String(e.type), lines: [] };
    }
  }

  return { COMPETENCIES, MAX_NOTE, GENERAL, SECTIONS, sectionLabel, normalizeSection, isSkillSection, escapeHtml, normalizeRatings, ratingText, validateInput,
           buildSubmitted, buildAdd, buildEdit, buildRetract, describeActivity };
})();

if (typeof module !== 'undefined') module.exports = PrideContrib;
