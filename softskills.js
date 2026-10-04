/* Soft skills for the PRIDE Training Log (from the "Top 10 Soft Skills" flyer). Loaded as the global
   `PrideSkills`. Pure data and logic: no DOM, no Firebase, so it can be unit-tested in Node.

   - SOFT_SKILLS: the 10 skills for every team member. `critical` marks the flyer's Top 3
     non-negotiables. `from` is the first evaluation period (days) in which the skill is assessed.
   - LEADERSHIP_SKILLS: the 5 extra skills for leadership roles, phased the same way.
   - POSITIONS: the position dropdown, each tagged line or leadership. */
const PrideSkills = (() => {
  const SOFT_SKILLS = [
    { id: 'guest_engagement', num: 1, name: 'Guest engagement & hospitality mindset', critical: true, from: 14,
      desc: "Show genuine warmth with eye contact and by reading the guest's mood to make them feel valued.",
      example: 'Greet returning guests by name and anticipate their preferences.' },
    { id: 'communication_clarity', num: 2, name: 'Communication clarity', critical: true, from: 30,
      desc: 'Ensure clear communication, especially across a multilingual, multi-outlet team to avoid misunderstandings.',
      example: 'Repeat an order back to confirm accuracy before sending it.' },
    { id: 'adaptability', num: 3, name: 'Adaptability', critical: false, from: 45,
      desc: 'Effectively handle volume swings, menu changes, and outlet rotations to maintain service quality.',
      example: 'Shift smoothly from Agave to Pronto when a rush hits.' },
    { id: 'teamwork', num: 4, name: 'Teamwork & collaboration', critical: false, from: 30,
      desc: 'Support colleagues by covering various outlets like Pronto, Agave, Little Wok during busy times.',
      example: 'Run food for a swamped colleague without being asked.' },
    { id: 'conflict_resolution', num: 5, name: 'Conflict resolution', critical: true, from: 60,
      desc: 'Calmly de-escalate guest complaints to uphold a positive guest experience. Stay level-headed during rushes and difficult moments.',
      example: 'Listen fully, apologize, and offer a fair solution on the spot.' },
    { id: 'time_management', num: 6, name: 'Time management', critical: false, from: 45,
      desc: 'Meet speed-of-service standards even under pressure to keep operations smooth.',
      example: 'Prep stations before peak so orders flow without delays.' },
    { id: 'attention_to_detail', num: 7, name: 'Attention to detail', critical: false, from: 60,
      desc: 'Focus on order accuracy, cash handling, and presentation to maintain high standards.',
      example: 'Double-check bills and plating before delivery.' },
    { id: 'positive_attitude', num: 8, name: 'Positive attitude & resilience', critical: false, from: 14,
      desc: 'Stay upbeat and resilient through long shifts and challenging guest interactions.',
      example: 'Keep a smile and steady energy through a double shift.' },
    { id: 'active_listening', num: 9, name: 'Active listening', critical: false, from: 60,
      desc: 'Quickly catch special requests, allergy concerns, and complaints to respond appropriately.',
      example: 'Note a nut allergy and flag it to the kitchen at once.' },
    { id: 'professionalism', num: 10, name: 'Professionalism & appearance', critical: false, from: 14,
      desc: 'Consistently represent the 4-diamond brand standard at every interaction.',
      example: 'Arrive groomed, in full uniform, and ready before shift.' },
  ];

  const LEADERSHIP_SKILLS = [
    { id: 'emotional_intelligence', num: 1, name: 'Emotional intelligence', critical: false, from: 14,
      desc: 'Read both guest and employee dynamics with awareness, especially across six direct reports who each bring different styles, motivations, and needs.' },
    { id: 'coaching', num: 2, name: 'Coaching & developing others', critical: false, from: 60,
      desc: "Turn appraisals and training into real skill growth, not just paperwork. Invest in each team member's progress so the whole team levels up over time." },
    { id: 'decisiveness', num: 3, name: 'Decisiveness under pressure', critical: false, from: 30,
      desc: "Labor call-outs, 86'd items, POS issues: make fast, confident calls that keep service moving and give the team clear direction when it matters most." },
    { id: 'delegation', num: 4, name: 'Delegation & accountability', critical: false, from: 45,
      desc: 'Trust managers and leads to own their outlets while staying informed. Set clear expectations, then hold people accountable for the results they deliver.' },
    { id: 'cross_functional_communication', num: 5, name: 'Cross-functional communication', critical: false, from: 14,
      desc: 'Translate floor issues upward to upper management and strategy downward to 43 employees, clearly and consistently, so everyone stays aligned.' },
  ];

  // `area` is the side of the house the position works in; null means it could be either,
  // so the evaluator picks it on the form.
  const POSITIONS = [
    { label: 'Food Server', level: 'line', area: 'FOH' },
    { label: 'Server Assistant / Busser', level: 'line', area: 'FOH' },
    { label: 'Host / Hostess', level: 'line', area: 'FOH' },
    { label: 'Food Runner', level: 'line', area: 'FOH' },
    { label: 'Bartender', level: 'line', area: 'FOH' },
    { label: 'Barback', level: 'line', area: 'FOH' },
    { label: 'Line Cook', level: 'line', area: 'BOH' },
    { label: 'Prep Cook', level: 'line', area: 'BOH' },
    { label: 'Dishwasher', level: 'line', area: 'BOH' },
    { label: 'Cashier', level: 'line', area: 'FOH' },
    { label: 'Other (line level)', level: 'line', area: null },
    { label: 'Lead (any area)', level: 'leadership', area: null },
    { label: 'Sous Chef', level: 'leadership', area: 'BOH' },
    { label: 'Asst. Chef', level: 'leadership', area: 'BOH' },
    { label: 'Chef', level: 'leadership', area: 'BOH' },
    { label: 'Supervisor', level: 'leadership', area: null },
    { label: 'Assistant Manager', level: 'leadership', area: null },
    { label: 'Manager', level: 'leadership', area: null },
    { label: 'Director', level: 'leadership', area: null },
    { label: 'Other (leadership)', level: 'leadership', area: null },
  ];

  const SCALE = { 3: 'Exceeds (3)', 2: 'Meets (2)', 1: 'Improves (1)' };
  const scaleLabel = rating => SCALE[rating] || 'Not rated';

  // Skills (and, for leadership roles, leadership skills) assessed in a given period
  function skillsFor(period, level) {
    const p = Number(period);
    return {
      skills: SOFT_SKILLS.filter(s => s.from <= p),
      leadership: level === 'leadership' ? LEADERSHIP_SKILLS.filter(s => s.from <= p) : [],
    };
  }

  // 'line' | 'leadership' | null when the position is empty or not in the list
  function roleLevel(position) {
    const key = String(position || '').trim().toLowerCase();
    if (!key) return null;
    const hit = POSITIONS.find(p => p.label.toLowerCase() === key);
    return hit ? hit.level : null;
  }

  // 'FOH' | 'BOH' | null when the position is empty, unknown, or could be either side
  function areaFor(position) {
    const key = String(position || '').trim().toLowerCase();
    const hit = key && POSITIONS.find(p => p.label.toLowerCase() === key);
    return hit ? hit.area : null;
  }

  function positionsByLevel() {
    return {
      line: POSITIONS.filter(p => p.level === 'line').map(p => p.label),
      leadership: POSITIONS.filter(p => p.level === 'leadership').map(p => p.label),
    };
  }

  // Names of critical skills in `skills` that have no rating yet (`ratings` is { skillId: 1-3 })
  function missingCritical(skills, ratings) {
    return skills.filter(s => s.critical && !ratings[s.id]).map(s => s.name);
  }

  // Names of critical skills that were rated 1 (Improves) in a saved softSkills map
  function flaggedSkills(softSkills) {
    return Object.values(softSkills || {}).filter(s => s.critical && s.rating === 1).map(s => s.name);
  }

  // Plain-text lines for the notification email
  function emailLines(softSkills) {
    const entries = Object.values(softSkills || {});
    if (!entries.length) return ['(none recorded)'];
    const line = s => `• ${s.name}${s.critical ? ' [CRITICAL]' : ''}: ${scaleLabel(s.rating)}${s.note ? ' — ' + s.note : ''}`;
    const all = entries.filter(s => s.group !== 'leadership');
    const lead = entries.filter(s => s.group === 'leadership');
    const out = [];
    if (all.length) out.push('All-employee soft skills:', ...all.map(line));
    if (lead.length) out.push('', 'Leadership focus:', ...lead.map(line));
    const flagged = flaggedSkills(softSkills);
    if (flagged.length) out.push('', `⚠ Critical skills rated Improves: ${flagged.join(', ')}`);
    return out;
  }

  // ── competency rating comments ──
  // The three competencies are rated 3 (Exceeds), 2 (Meets) or 1 (Needs improvement). A 3 or a 1 stands
  // out from the norm, so the evaluator has to say why.
  const RATING_WORDS = { 3: 'Exceeds expectations', 2: 'Meets expectations', 1: 'Needs improvement' };
  const needsComment = rating => Number(rating) === 3 || Number(rating) === 1;
  const commentLabel = rating => (Number(rating) === 3 ? 'Why does this exceed expectations?'
    : Number(rating) === 1 ? 'Why does this need improvement?' : '');

  // [{ name, rating }] for every 3 or 1 that has no comment yet
  function missingCompetencyComments(competencies, comments) {
    return Object.entries(competencies || {})
      .filter(([name, rating]) => needsComment(rating) && !String((comments || {})[name] || '').trim())
      .map(([name, rating]) => ({ name, rating: Number(rating) }));
  }

  // The comments worth saving: trimmed, and only those that go with a 3 or a 1
  function cleanCompetencyComments(competencies, comments) {
    const out = {};
    Object.entries(competencies || {}).forEach(([name, rating]) => {
      const text = String((comments || {})[name] || '').trim();
      if (needsComment(rating) && text) out[name] = text;
    });
    return out;
  }

  // Plain-text lines for the notification email
  function competencyLines(competencies, comments) {
    const entries = Object.entries(competencies || {});
    if (!entries.length) return ['(none recorded)'];
    return entries.map(([name, rating]) => {
      const base = rating ? `${name}: ${rating} (${RATING_WORDS[rating]})` : `${name}: Not rated`;
      const why = String((comments || {})[name] || '').trim();
      return why ? `${base} — ${why}` : base;
    });
  }

  return { SOFT_SKILLS, LEADERSHIP_SKILLS, POSITIONS, RATING_WORDS, needsComment, commentLabel,
           missingCompetencyComments, cleanCompetencyComments, competencyLines, skillsFor, roleLevel, areaFor, positionsByLevel,
           missingCritical, flaggedSkills, scaleLabel, emailLines };
})();

if (typeof module !== 'undefined') module.exports = PrideSkills;
