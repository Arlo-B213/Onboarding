/* Pure helpers for the evaluations list and for editing an evaluation's header details.
   No DOM, no Firebase. Loaded in the browser as the global `PrideEvals`.

   The list shows one row per team member (same name, ignoring case, spaces and punctuation, on the
   same team), with their 14 / 30 / 45 / 60-day evaluations as pills. A period can hold more
   than one submission; those stay separate documents and are shown together. */
const PrideEvals = (() => {
  const PERIODS = [14, 30, 45, 60];
  const DETAIL_FIELDS = ['tmName', 'position', 'outlet', 'area', 'startDate', 'evalDate', 'period'];
  const DETAIL_LABELS = {
    tmName: 'Name', position: 'Position', outlet: 'Outlet', area: 'Area',
    startDate: 'Start date', evalDate: 'Eval date', period: 'Period',
  };

  // Matching key for a name: letters and digits only, so "David St . Onge", "david st. onge" and
  // "David St.Onge" are the same person. Accents are kept apart from the letter and dropped.
  const normalizeName = n => String(n || '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const groupKey = e => normalizeName(e.tmName) + '|' + (e.teamId || '');
  const ms = e => (e && e.submittedAt && typeof e.submittedAt.toMillis === 'function') ? e.submittedAt.toMillis() : 0;
  const newestFirst = (a, b) => ms(b) - ms(a);

  /**
   * evals → [{ key, latest, count, byPeriod: { 14: [newest…], 30: [...] }, otherPeriods: [...] }]
   * Groups are ordered by their most recent submission.
   */
  function groupEvals(evals) {
    const map = new Map();
    (evals || []).forEach(e => {
      const k = groupKey(e);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
    });
    const groups = [...map.entries()].map(([key, list]) => {
      list.sort(newestFirst);
      const byPeriod = {};
      list.forEach(e => { (byPeriod[e.period] = byPeriod[e.period] || []).push(e); });
      const otherPeriods = Object.keys(byPeriod).map(Number).filter(p => !PERIODS.includes(p)).sort((a, b) => a - b);
      return { key, latest: list[0], count: list.length, byPeriod, otherPeriods };
    });
    return groups.sort((a, b) => newestFirst(a.latest, b.latest));
  }

  // The other submissions for the same team member and period, newest first (including e)
  function siblings(evals, e) {
    const k = groupKey(e);
    return (evals || []).filter(x => groupKey(x) === k && Number(x.period) === Number(e.period)).sort(newestFirst);
  }

  // The detail fields of an evaluation, with missing values as '' (period as a number)
  function detailsOf(e) {
    const out = {};
    DETAIL_FIELDS.forEach(f => { out[f] = f === 'period' ? Number(e[f]) || 0 : String(e[f] == null ? '' : e[f]); });
    return out;
  }

  // Returns an error message, or null when the edited details can be saved
  function validateDetails(d) {
    if (!String(d.tmName || '').trim()) return 'Team member name is required.';
    if (String(d.tmName).trim().length > 100) return 'The name can be at most 100 characters.';
    if (!PERIODS.includes(Number(d.period))) return 'Choose the 14, 30, 45 or 60-day period.';
    for (const f of ['position', 'outlet', 'area', 'startDate', 'evalDate']) {
      if (String(d[f] || '').length > 200) return `${DETAIL_LABELS[f]} is too long.`;
    }
    return null;
  }

  // [{ field, label, from, to }] for each field that differs
  function diffDetails(before, after) {
    return DETAIL_FIELDS.filter(f => String(before[f]) !== String(after[f]))
      .map(f => ({ field: f, label: DETAIL_LABELS[f], from: before[f], to: after[f] }));
  }

  return { PERIODS, DETAIL_FIELDS, DETAIL_LABELS, normalizeName, groupKey, groupEvals, siblings,
           detailsOf, validateDetails, diffDetails };
})();

if (typeof module !== 'undefined') module.exports = PrideEvals;
