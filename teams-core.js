/* Pure helpers for teams. No DOM and no Firebase calls, so they can be unit-tested in Node.
   Loaded in the browser as the global `PrideTeams`.

   A team is { id, name, memberEmails } in the `teams` collection. A leader sees an evaluation
   only when they are on its team (evaluation.teamId); see firestore.rules. */
const PrideTeams = (() => {
  const MAX_NAME = 80;
  const MAX_MEMBERS = 200;
  const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

  const normalizeEmail = e => String(e || '').trim().toLowerCase();

  // "a@x.com, B@x.com\nc@x.com" → { emails: ['a@x.com', 'b@x.com', 'c@x.com'], invalid: [] }
  function parseEmails(text) {
    const emails = [], invalid = [];
    String(text || '').split(/[\s,;]+/).map(normalizeEmail).filter(Boolean).forEach(e => {
      if (!EMAIL_RE.test(e)) { if (!invalid.includes(e)) invalid.push(e); }
      else if (!emails.includes(e)) emails.push(e);
    });
    return { emails, invalid };
  }

  // Returns an error message, or null when the name is fine
  function validateName(name, teams = [], exceptId = null) {
    const n = String(name || '').trim();
    if (!n) return 'Give the team a name.';
    if (n.length > MAX_NAME) return `Team names can be at most ${MAX_NAME} characters.`;
    if (teams.some(t => t.id !== exceptId && String(t.name || '').trim().toLowerCase() === n.toLowerCase())) {
      return 'There is already a team with that name.';
    }
    return null;
  }

  const sortTeams = teams => [...teams].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));

  const isMember = (team, email) => !!team && (team.memberEmails || []).includes(normalizeEmail(email));

  // The name to show for an evaluation's team
  function teamLabel(teams, teamId) {
    if (!teamId) return 'No team';
    const t = teams.find(x => x.id === teamId);
    return t ? t.name : 'Deleted team';
  }

  // Several per-team result lists → one list, newest first, each evaluation once
  function mergeEvals(lists, limit = 200) {
    const seen = new Map();
    lists.flat().forEach(e => { if (e && !seen.has(e.id)) seen.set(e.id, e); });
    const ms = e => (e.submittedAt && typeof e.submittedAt.toMillis === 'function') ? e.submittedAt.toMillis() : 0;
    return [...seen.values()].sort((a, b) => ms(b) - ms(a)).slice(0, limit);
  }

  // How many evaluations each team has; unassigned ones (no team or a deleted team) count under ''
  function countByTeam(evals, teams) {
    const ids = new Set(teams.map(t => t.id));
    const counts = { '': 0 };
    teams.forEach(t => { counts[t.id] = 0; });
    evals.forEach(e => { const k = e.teamId && ids.has(e.teamId) ? e.teamId : ''; counts[k]++; });
    return counts;
  }

  return { MAX_NAME, MAX_MEMBERS, normalizeEmail, parseEmails, validateName, sortTeams, isMember,
           teamLabel, mergeEvals, countByTeam };
})();

if (typeof module !== 'undefined') module.exports = PrideTeams;
