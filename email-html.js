/* Builds the HTML "new evaluation" alert email. Pure: no DOM, no network, so it can be tested
   in Node. Loaded in the browser as the global `PrideEmail`; needs PrideSkills (softskills.js).

   Email clients ignore <style> blocks and modern CSS, so everything is inline and laid out with
   tables, 600px wide. Every value from the evaluation is escaped. The result is an HTML fragment
   (no <html>/<body>) for the EmailJS template, whose content is just {{{body_html}}}. */
const PrideEmail = (() => {
  const Skills = (typeof PrideSkills !== 'undefined') ? PrideSkills
    : (typeof require === 'function' ? require('./softskills.js') : null);

  const C = {
    ink: '#1d1a14', muted: '#6b6457', line: '#e7e1d4', paper: '#ffffff', page: '#f4f1ea',
    dark: '#14110c', gold: '#c9a24a', goldSoft: '#f6efdc',
    good: '#2f7a4f', goodBg: '#e6f3ec', bad: '#b4432f', badBg: '#fbe9e5', mid: '#6b5a2e', midBg: '#f3ecd9',
  };
  const FONT = "font-family:Helvetica,Arial,sans-serif;";

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const nl2br = s => esc(s).replace(/\r?\n/g, '<br>');
  const has = s => String(s == null ? '' : s).trim() !== '';

  // rating 3 / 2 / 1 → coloured pill
  function pill(rating, text) {
    const r = Number(rating);
    const [fg, bg] = r === 3 ? [C.good, C.goodBg] : r === 1 ? [C.bad, C.badBg] : r === 2 ? [C.mid, C.midBg] : [C.muted, C.page];
    return `<span style="${FONT}display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:bold;color:${fg};background:${bg};white-space:nowrap;">${esc(text)}</span>`;
  }

  function section(title, inner) {
    return `<tr><td style="padding:22px 32px 0;">
      <div style="${FONT}font-size:11px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:${C.gold};padding-bottom:8px;border-bottom:1px solid ${C.line};">${esc(title)}</div>
      <div style="padding-top:12px;">${inner}</div>
    </td></tr>`;
  }
  const para = s => `<p style="${FONT}margin:0;font-size:14px;line-height:1.55;color:${C.ink};">${nl2br(s)}</p>`;

  // [label, value] pairs → two-column details table
  function details(rows) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${
      rows.map(([k, v]) => `<tr>
        <td style="${FONT}padding:5px 12px 5px 0;font-size:13px;color:${C.muted};width:130px;vertical-align:top;">${esc(k)}</td>
        <td style="${FONT}padding:5px 0;font-size:14px;color:${C.ink};vertical-align:top;">${esc(v || '—')}</td></tr>`).join('')
    }</table>`;
  }

  // label | pill, with an optional note underneath
  function ratingRows(items) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${
      items.map(i => `<tr><td style="${FONT}padding:8px 0;border-bottom:1px solid ${C.line};font-size:14px;color:${C.ink};vertical-align:top;">
          ${esc(i.name)}${i.critical ? ` <span style="font-size:10px;font-weight:bold;letter-spacing:.8px;color:${C.bad};">CRITICAL</span>` : ''}
          ${has(i.note) ? `<div style="font-size:12px;color:${C.muted};padding-top:3px;line-height:1.45;">${nl2br(i.note)}</div>` : ''}
        </td><td align="right" style="padding:8px 0 8px 12px;border-bottom:1px solid ${C.line};vertical-align:top;">${pill(i.rating, i.label)}</td></tr>`).join('')
    }</table>`;
  }

  function softSkillsHtml(softSkills) {
    const entries = Object.values(softSkills || {});
    if (!entries.length) return para('No soft skills recorded.');
    const row = s => ({ name: s.name, critical: s.critical, note: s.note, rating: s.rating,
      label: Skills ? Skills.scaleLabel(s.rating) : String(s.rating || 'Not rated') });
    const all = entries.filter(s => s.group !== 'leadership').map(row);
    const lead = entries.filter(s => s.group === 'leadership').map(row);
    const sub = t => `<div style="${FONT}font-size:12px;font-weight:bold;color:${C.muted};padding:4px 0 2px;">${esc(t)}</div>`;
    return (all.length ? (lead.length ? sub('All-employee skills') : '') + ratingRows(all) : '')
      + (lead.length ? `<div style="height:10px"></div>${sub('Leadership focus')}${ratingRows(lead)}` : '');
  }

  function competenciesHtml(competencies, comments) {
    const words = Skills ? Skills.RATING_WORDS : { 3: 'Exceeds expectations', 2: 'Meets expectations', 1: 'Needs improvement' };
    const entries = Object.entries(competencies || {});
    if (!entries.length) return para('No competency ratings recorded.');
    return ratingRows(entries.map(([name, rating]) => ({
      name, rating, note: (comments || {})[name],
      label: rating ? `${rating} · ${words[rating] || ''}` : 'Not rated',
    })));
  }

  function signed(img, typed, fallback) {
    if (img) return 'Signed';
    return has(typed) ? typed : fallback;
  }

  /**
   * @param ev        the evaluation as saved
   * @param opts      { teamName, appUrl }
   * @returns HTML string for the whole email
   */
  function buildHtml(ev, { teamName = '', appUrl = '' } = {}) {
    const flagged = Skills ? Skills.flaggedSkills(ev.softSkills) : [];
    const level = ev.roleLevel === 'leadership' ? 'Leadership' : 'Line level';

    const rows = [];
    rows.push(section('Team member', details([
      ['Name', ev.tmName], ['Position', ev.position ? `${ev.position} (${level})` : ''],
      ['Outlet', ev.outlet], ['Area', ev.area], ['Team', teamName],
      ['Start date', ev.startDate], ['Evaluation date', ev.evalDate],
    ])));
    rows.push(section('Soft skills', softSkillsHtml(ev.softSkills)));
    rows.push(section('Competency ratings', competenciesHtml(ev.competencies, ev.competencyComments)));
    if (has(ev.strengths)) rows.push(section('Strengths & highlights', para(ev.strengths)));
    if (has(ev.improvements)) rows.push(section('Areas for improvement', para(ev.improvements)));
    if (has(ev.expectations)) rows.push(section('Expectations for next period', para(ev.expectations)));
    if (has(ev.policies)) rows.push(section('Policies reviewed', para(ev.policies)));
    if (has(ev.trainerNotes)) rows.push(section('Trainer observation notes', para(ev.trainerNotes)));
    rows.push(section('Signatures', details([
      ['Trainer', ev.trainerName ? `${ev.trainerName} · ${signed(ev.trainerSigImg, ev.trainerSig, 'Not signed')}` : ''],
      ['Team member', signed(ev.tmSigImg, ev.tmSig, 'Not signed')],
      ['Manager', ev.managerSig],
    ])));

    const alert = flagged.length ? `<tr><td style="padding:20px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.badBg};border-left:4px solid ${C.bad};border-radius:4px;">
          <tr><td style="${FONT}padding:12px 14px;font-size:14px;color:${C.bad};line-height:1.45;">
            <strong>Critical skill needs attention:</strong> ${esc(flagged.join(', '))} rated Improves.
          </td></tr></table></td></tr>` : '';

    const button = appUrl ? `<tr><td style="padding:22px 32px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background:${C.gold};">
          <a href="${esc(appUrl)}" style="${FONT}display:inline-block;padding:12px 22px;font-size:14px;font-weight:bold;color:${C.dark};text-decoration:none;border-radius:6px;">View evaluation &amp; add feedback</a>
        </td></tr></table></td></tr>` : '';

    // A fragment, not a full page: EmailJS places it inside its own email wrapper
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};"><tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${C.paper};border:1px solid ${C.line};border-radius:10px;overflow:hidden;">
    <tr><td style="background:${C.dark};padding:22px 32px;">
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;letter-spacing:6px;color:${C.gold};font-weight:bold;">PRIDE</div>
      <div style="${FONT}font-size:12px;color:#cfc6b2;padding-top:4px;">Team Member Training Log · Pechanga Resort Casino Food &amp; Beverage</div>
    </td></tr>
    <tr><td style="padding:26px 32px 0;">
      <div style="${FONT}font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${C.muted};">New ${esc(ev.period)}-Day Evaluation</div>
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:26px;color:${C.ink};padding-top:6px;line-height:1.2;">${esc(ev.tmName)}</div>
      <div style="${FONT}font-size:14px;color:${C.muted};padding-top:6px;">${esc([ev.position, ev.outlet].filter(has).join(' · '))}</div>
      <div style="${FONT}font-size:13px;color:${C.muted};padding-top:10px;">Submitted by <strong style="color:${C.ink};">${esc(ev.submittedByName || ev.submittedBy || '—')}</strong>${teamName ? ` for the <strong style="color:${C.ink};">${esc(teamName)}</strong> team` : ''}</div>
    </td></tr>
    ${alert}
    ${button}
    ${rows.join('\n')}
    <tr><td style="padding:28px 32px 26px;">
      <div style="${FONT}font-size:12px;color:${C.muted};line-height:1.5;border-top:1px solid ${C.line};padding-top:14px;">
        You are receiving this because you are on the ${teamName ? esc(teamName) + ' team' : 'admin alert list'} in the PRIDE Training Log.
        This message was sent automatically; reply to reach the leader who submitted it.
      </div>
    </td></tr>
  </table>
</td></tr></table>`;
  }

  return { buildHtml, esc };
})();

if (typeof module !== 'undefined') module.exports = PrideEmail;
