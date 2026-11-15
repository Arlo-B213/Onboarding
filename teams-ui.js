/* DOM + Firestore layer for teams: loading the signed-in user's teams, the Team picker on the
   form, the Team column/filter, moving an evaluation to another team, and the admin Teams tab.
   Relies on globals from index.html: db, currentUser, currentIsAdmin, allEvals, myTeams, teamsReady,
   detailEvalId, loadEvals, filterEvals, queueDraftSave, esc. Pure logic lives in teams-core.js (PrideTeams).

   Who sees what is enforced by firestore.rules; this file only shapes the page to match. */

const NO_TEAM = '__none__';       // form/filter value for "no team" (admins only)
let teamsLoaded = false;
let pendingDraftTeam = null;      // team saved in a draft, applied once the team list has loaded
const TEAM_HINT = 'Only leaders on this team will see the evaluation and its feedback.';
const teamTs = () => firebase.firestore.FieldValue.serverTimestamp();
const teamsCol = () => db.collection('teams');

// ── loading ────────────────────────────────────────────────────────────

async function loadMyTeams() {
  teamsLoaded = false;
  try {
    const q = currentIsAdmin
      ? teamsCol()
      : teamsCol().where('memberEmails', 'array-contains', PrideTeams.normalizeEmail(currentUser.email));
    const snap = await q.get();
    myTeams = PrideTeams.sortTeams(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (e) {
    console.error('Could not load teams', e);
    myTeams = [];
  }
  teamsLoaded = true;
  fillTeamSelect();
  fillTeamFilter();
}

// ── New Evaluation: Team picker ────────────────────────────────────────

function fillTeamSelect() {
  const sel = document.getElementById('f-team');
  const hint = document.getElementById('f-team-hint');
  if (!sel) return;
  if (!teamsLoaded) {
    sel.innerHTML = '<option value="">Loading teams…</option>';
    sel.disabled = true;
    return;
  }
  const want = pendingDraftTeam || sel.value;
  if (!currentIsAdmin && !myTeams.length) {
    sel.innerHTML = '<option value="">You are not on a team yet</option>';
    sel.disabled = true;
    hint.textContent = 'Ask an admin to add you to a team. You can fill in the form now, but you cannot submit it until then.';
    hint.classList.add('warn');
    return;
  }
  const onlyOne = !currentIsAdmin && myTeams.length === 1;
  sel.innerHTML = (onlyOne ? '' : '<option value="">Select team…</option>')
    + myTeams.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')
    + (currentIsAdmin ? `<option value="${NO_TEAM}">No team (admins only)</option>` : '');
  sel.disabled = false;
  hint.textContent = TEAM_HINT;
  hint.classList.remove('warn');
  const values = [...sel.options].map(o => o.value);
  sel.value = values.includes(want) ? want : (onlyOne ? myTeams[0].id : '');
  if (pendingDraftTeam) { pendingDraftTeam = null; queueDraftSave(); }
}

// ── Evaluations list: Team filter and column ───────────────────────────

function fillTeamFilter() {
  const sel = document.getElementById('filter-team');
  if (!sel) return;
  const keep = sel.value;
  sel.innerHTML = '<option value="">All Teams</option>'
    + myTeams.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')
    + (currentIsAdmin ? `<option value="${NO_TEAM}">No team</option>` : '');
  sel.value = [...sel.options].some(o => o.value === keep) ? keep : '';
  // A leader on just one team has nothing to filter by
  sel.closest('.field').hidden = !currentIsAdmin && myTeams.length <= 1;
}

function teamCellHtml(e) {
  const known = e.teamId && myTeams.some(t => t.id === e.teamId);
  const label = PrideTeams.teamLabel(myTeams, e.teamId);
  return known
    ? `<span class="chip">${esc(label)}</span>`
    : `<span class="chip flag-chip" title="Only admins can see this evaluation until it is put on a team">${esc(label)}</span>`;
}

// ── Evaluation detail: admins can move it to another team ──────────────

function teamAssignHtml(e) {
  const cur = e.teamId && myTeams.some(t => t.id === e.teamId) ? e.teamId : NO_TEAM;
  const opts = myTeams.map(t => `<option value="${esc(t.id)}"${t.id === cur ? ' selected' : ''}>${esc(t.name)}</option>`).join('')
    + `<option value="${NO_TEAM}"${cur === NO_TEAM ? ' selected' : ''}>No team (admins only)</option>`;
  return `<div class="field" style="margin:3px 0 0">
      <select id="detail-team" data-current="${esc(cur)}" aria-label="Team">${opts}</select>
      <small class="field-hint" id="detail-team-status">Leaders on this team can see it and add feedback.</small>
    </div>`;
}

async function onDetailTeamChange(sel) {
  const evalId = detailEvalId;
  const status = document.getElementById('detail-team-status');
  const v = sel.value;
  sel.disabled = true;
  status.classList.remove('warn');
  status.textContent = 'Saving…';
  try {
    await db.collection('evaluations').doc(evalId).update({
      teamId: v === NO_TEAM ? firebase.firestore.FieldValue.delete() : v,
    });
    const ev = allEvals.find(x => x.id === evalId);
    if (ev) { if (v === NO_TEAM) delete ev.teamId; else ev.teamId = v; }
    sel.dataset.current = v;
    status.textContent = v === NO_TEAM
      ? 'Saved. Only admins can see this evaluation now.'
      : `Saved. Leaders on ${PrideTeams.teamLabel(myTeams, v)} can see it now.`;
    filterEvals();
  } catch (e) {
    console.error(e);
    sel.value = sel.dataset.current;
    status.textContent = 'Could not change the team: ' + (e.message || e);
    status.classList.add('warn');
  } finally {
    sel.disabled = false;
  }
}

document.getElementById('modal-body').addEventListener('change', e => {
  if (e.target.id === 'detail-team') onDetailTeamChange(e.target);
});

// ── admin Teams tab ────────────────────────────────────────────────────

async function loadTeamsPanel() {
  teamsReady = loadMyTeams();
  await loadEvals(); // waits for the teams, then refreshes the counts
  renderTeamsPanel();
}

function renderTeamsPanel() {
  const counts = PrideTeams.countByTeam(allEvals, myTeams);

  // Suggest emails of leaders who have submitted evaluations
  const known = new Set();
  allEvals.forEach(e => e.submittedBy && known.add(PrideTeams.normalizeEmail(e.submittedBy)));
  myTeams.forEach(t => (t.memberEmails || []).forEach(m => known.add(m)));
  document.getElementById('team-email-suggestions').innerHTML =
    [...known].sort().map(m => `<option value="${esc(m)}"></option>`).join('');

  // Evaluations that no leader can see yet
  const un = counts[''];
  const unBox = document.getElementById('teams-unassigned');
  unBox.innerHTML = !un ? '' : `
    <div class="section-card">
      <div class="section-header"><span class="section-badge">To do</span>
        <span class="section-title">${un} evaluation${un === 1 ? ' is' : 's are'} not on a team</span></div>
      <div class="section-body">
        <p class="contrib-empty" style="margin:0">Only admins can see ${un === 1 ? 'it' : 'them'} until ${un === 1 ? 'it is' : 'they are'} put on a team.
          You can also open any evaluation and change its team there.${allEvals.length >= 200 ? ' Only the latest 200 evaluations are counted here.' : ''}</p>
        ${myTeams.length ? `<div class="team-assign field" style="margin:0">
            <select id="team-bulk-select" aria-label="Team for unassigned evaluations">
              ${myTeams.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}
            </select>
            <button class="btn btn-outline btn-sm" type="button" data-action="bulk-assign">Put all ${un} on this team</button>
          </div>` : '<p class="contrib-empty" style="margin:10px 0 0">Create a team first.</p>'}
        <div class="error-msg" id="team-bulk-error"></div>
      </div>
    </div>`;

  const list = document.getElementById('teams-list');
  if (!myTeams.length) {
    list.innerHTML = '<div class="empty-state"><div class="icon">👥</div><p>No teams yet. Create one above, then add leaders to it.</p></div>';
    return;
  }
  list.innerHTML = myTeams.map(t => {
    const members = t.memberEmails || [];
    const n = counts[t.id] || 0;
    return `
    <div class="section-card team-card" data-team="${esc(t.id)}">
      <div class="section-header">
        <div class="team-head-left">
          <span class="section-title">${esc(t.name)}</span>
          <span class="chip">${members.length} leader${members.length === 1 ? '' : 's'}</span>
          <span class="chip">${n} evaluation${n === 1 ? '' : 's'}</span>
        </div>
        <div class="team-head-actions">
          <button class="btn btn-ghost btn-sm" type="button" data-action="rename-team">Rename</button>
          <button class="btn btn-danger-ghost btn-sm" type="button" data-action="delete-team">Delete</button>
        </div>
      </div>
      <div class="section-body">
        <div class="team-members">
          ${members.length ? members.map(m => `<span class="chip team-member">${esc(m)}
              <button type="button" data-action="remove-member" data-email="${esc(m)}" aria-label="Remove ${esc(m)} from ${esc(t.name)}">✕</button></span>`).join('')
            : '<p class="contrib-empty" style="margin:0">No leaders on this team yet.</p>'}
        </div>
        <div class="team-add-row field" style="margin:0">
          <input type="text" data-role="add-input" list="team-email-suggestions" placeholder="Add leader emails, separated by commas" aria-label="Add leaders to ${esc(t.name)}">
          <button class="btn btn-outline btn-sm" type="button" data-action="add-members">Add</button>
        </div>
        <div class="error-msg" data-role="team-error"></div>
      </div>
    </div>`;
  }).join('');
}

function showTeamError(el, msg) {
  if (!el) { alert(msg); return; }
  el.textContent = msg;
  el.classList.toggle('show', !!msg);
}

async function afterTeamWrite() {
  teamsReady = loadMyTeams();
  await loadEvals();
  renderTeamsPanel();
}

async function createTeam() {
  const btn = document.getElementById('team-new-btn');
  const nameEl = document.getElementById('team-new-name');
  const membersEl = document.getElementById('team-new-members');
  const err = document.getElementById('team-new-error');
  showTeamError(err, '');
  const name = nameEl.value.trim();
  const nameErr = PrideTeams.validateName(name, myTeams);
  if (nameErr) return showTeamError(err, nameErr);
  const { emails, invalid } = PrideTeams.parseEmails(membersEl.value);
  if (invalid.length) return showTeamError(err, `These are not email addresses: ${invalid.join(', ')}`);
  if (emails.length > PrideTeams.MAX_MEMBERS) return showTeamError(err, `A team can have at most ${PrideTeams.MAX_MEMBERS} leaders.`);
  btn.disabled = true;
  try {
    await teamsCol().add({ name, memberEmails: emails, createdAt: teamTs(), updatedAt: teamTs() });
    nameEl.value = '';
    membersEl.value = '';
    await afterTeamWrite();
  } catch (e) {
    console.error(e);
    showTeamError(err, 'Could not create the team: ' + (e.message || e));
  } finally {
    btn.disabled = false;
  }
}

async function onTeamsClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'bulk-assign') return bulkAssign(btn);

  const card = btn.closest('.team-card');
  if (!card) return;
  const team = myTeams.find(t => t.id === card.dataset.team);
  if (!team) return;
  const err = card.querySelector('[data-role="team-error"]');
  const ref = teamsCol().doc(team.id);
  showTeamError(err, '');

  try {
    if (action === 'add-members') {
      const input = card.querySelector('[data-role="add-input"]');
      const { emails, invalid } = PrideTeams.parseEmails(input.value);
      if (invalid.length) return showTeamError(err, `These are not email addresses: ${invalid.join(', ')}`);
      const fresh = emails.filter(m => !(team.memberEmails || []).includes(m));
      if (!fresh.length) return showTeamError(err, emails.length ? 'They are already on this team.' : 'Type one or more emails to add.');
      if ((team.memberEmails || []).length + fresh.length > PrideTeams.MAX_MEMBERS) {
        return showTeamError(err, `A team can have at most ${PrideTeams.MAX_MEMBERS} leaders.`);
      }
      btn.disabled = true;
      await ref.update({ memberEmails: firebase.firestore.FieldValue.arrayUnion(...fresh), updatedAt: teamTs() });
    } else if (action === 'remove-member') {
      const email = btn.dataset.email;
      if (!confirm(`Remove ${email} from ${team.name}? They will no longer see this team's evaluations or feedback.`)) return;
      btn.disabled = true;
      await ref.update({ memberEmails: firebase.firestore.FieldValue.arrayRemove(email), updatedAt: teamTs() });
    } else if (action === 'rename-team') {
      const name = prompt('New name for this team:', team.name);
      if (name == null || name.trim() === team.name) return;
      const nameErr = PrideTeams.validateName(name, myTeams, team.id);
      if (nameErr) return showTeamError(err, nameErr);
      await ref.update({ name: name.trim(), updatedAt: teamTs() });
    } else if (action === 'delete-team') {
      const n = PrideTeams.countByTeam(allEvals, myTeams)[team.id] || 0;
      const msg = `Delete the team "${team.name}"?` + (n
        ? `\n\nIts ${n} evaluation${n === 1 ? '' : 's'} will not be deleted, but only admins will see ${n === 1 ? 'it' : 'them'} until ${n === 1 ? 'it is' : 'they are'} put on another team.`
        : '');
      if (!confirm(msg)) return;
      btn.disabled = true;
      await ref.delete();
    } else {
      return;
    }
    await afterTeamWrite();
  } catch (e2) {
    console.error(e2);
    btn.disabled = false;
    showTeamError(err, 'That did not save: ' + (e2.message || e2));
  }
}

// Put every loaded evaluation that has no (existing) team onto one team
async function bulkAssign(btn) {
  const err = document.getElementById('team-bulk-error');
  const teamId = document.getElementById('team-bulk-select').value;
  const known = new Set(myTeams.map(t => t.id));
  const targets = allEvals.filter(e => !(e.teamId && known.has(e.teamId)));
  if (!teamId || !targets.length) return;
  const name = PrideTeams.teamLabel(myTeams, teamId);
  if (!confirm(`Put ${targets.length} evaluation${targets.length === 1 ? '' : 's'} on ${name}? Every leader on ${name} will be able to see ${targets.length === 1 ? 'it' : 'them'}.`)) return;
  btn.disabled = true;
  showTeamError(err, '');
  try {
    for (let i = 0; i < targets.length; i += 400) {
      const batch = db.batch();
      targets.slice(i, i + 400).forEach(e => batch.update(db.collection('evaluations').doc(e.id), { teamId }));
      await batch.commit();
    }
    await afterTeamWrite();
  } catch (e) {
    console.error(e);
    btn.disabled = false;
    showTeamError(err, 'Could not move them all: ' + (e.message || e) + ' Reload the page to see which ones moved.');
  }
}

document.getElementById('team-new-btn').addEventListener('click', createTeam);
document.getElementById('panel-teams').addEventListener('click', onTeamsClick);
document.getElementById('panel-teams').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('[data-role="add-input"]')) {
    e.target.closest('.team-card').querySelector('[data-action="add-members"]').click();
  }
});
