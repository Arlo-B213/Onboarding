/* Pure helpers for leader contributions. No DOM and no Firebase calls, so they can be
   unit-tested in Node. Loaded in the browser as the global `PrideContrib`. */
const PrideContrib = (() => {
  const COMPETENCIES = ['Pride', 'Passion', 'Professionalism'];
  const MAX_NOTE = 5000;

  const actorName = user => user.displayName || user.email;

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

  function validateInput({ note, ratings }) {
    const text = (note || '').trim();
    if (text.length > MAX_NOTE) return `Note must be ${MAX_NOTE} characters or fewer.`;
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

  function buildAdd({ user, contributionId, note, ratings, ts }) {
    const n = (note || '').trim();
    const r = normalizeRatings(ratings);
    return {
      contribution: {
        authorEmail: user.email, authorName: actorName(user), note: n, ratings: r,
        createdAt: ts, updatedAt: ts, rev: 1, retracted: false,
      },
      activityId: `${contributionId}_1`,
      activity: {
        type: 'added', contributionId, rev: 1, byEmail: user.email, byName: actorName(user), at: ts,
        before: null, after: { note: n, ratings: r },
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
        before: snapshot(existing), after: { note: n, ratings: r },
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
        before: snapshot(existing), after: snapshot(existing),
      },
    };
  }

  // Human-readable summary of one activity entry; `lines` are plain text (escape before rendering)
  function describeActivity(e) {
    switch (e.type) {
      case 'submitted':
        return { label: 'submitted the evaluation', lines: [] };
      case 'added':
        return { label: 'added input', lines: [`Note: ${e.after.note || '(none)'}`, `Ratings: ${ratingText(e.after.ratings)}`] };
      case 'edited': {
        const lines = [];
        if (e.before.note !== e.after.note) lines.push(`Note: "${e.before.note}" → "${e.after.note}"`);
        if (ratingText(e.before.ratings) !== ratingText(e.after.ratings)) {
          lines.push(`Ratings: ${ratingText(e.before.ratings)} → ${ratingText(e.after.ratings)}`);
        }
        return { label: 'edited their input', lines };
      }
      case 'retracted':
        return { label: 'retracted their input', lines: [`Was: ${e.before.note || ratingText(e.before.ratings)}`] };
      default:
        return { label: String(e.type), lines: [] };
    }
  }

  return { COMPETENCIES, MAX_NOTE, escapeHtml, normalizeRatings, ratingText, validateInput,
           buildSubmitted, buildAdd, buildEdit, buildRetract, describeActivity };
})();

if (typeof module !== 'undefined') module.exports = PrideContrib;
