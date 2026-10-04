/* DOM + Firestore layer for leader notes and the admin Activity feed.
   Relies on globals from index.html: db, currentUser, currentIsAdmin, allEvals, openDetail.
   Pure logic lives in contrib-core.js (PrideContrib).

   Notes live in "slots": one under each section of the evaluation detail (`.notes-slot[data-section]`)
   plus the General box at the bottom (`#contrib-section`, data-section="general"). A slot only
   re-renders when its own notes change, so text typed in another slot is never lost. */

const escHtml = PrideContrib.escapeHtml;
const SERVER_TS = () => firebase.firestore.FieldValue.serverTimestamp();
const contribState = { evalId: null, list: [], editingId: null, openForms: new Set(), busy: false };

const evalDocRef = id => db.collection('evaluations').doc(id);
const fmtTime = t => (t && t.toDate) ? t.toDate().toLocaleString() : '—';

const sectionOf = c => PrideContrib.normalizeSection(c.section);
const slotEl = section => document.querySelector(`.notes-slot[data-section="${section}"]`);
const notesFor = section => contribState.list.filter(c => sectionOf(c) === section);
// Errors for a slot show next to its form when open, otherwise at the foot of the slot
const slotErrorScope = section => (section === 'general' ? 'new' : `slot-${section}`);

// ── loading ────────────────────────────────────────────────────────────

async function initContributions(evalId) {
  contribState.evalId = evalId;
  contribState.editingId = null;
  contribState.openForms = new Set();
  contribState.list = [];
  document.querySelectorAll('.notes-slot').forEach(h => { h.innerHTML = ''; });
  const general = slotEl('general');
  if (general) general.innerHTML = '<div class="detail-section"><h4>General Notes</h4><p class="contrib-empty">Loading…</p></div>';
  await refreshContributions();
}

// Reload the notes; re-render everything, or just one section's slot after a write
async function refreshContributions(onlySection) {
  const evalId = contribState.evalId;
  try {
    const snap = await evalDocRef(evalId).collection('contributions').orderBy('createdAt', 'asc').get();
    if (contribState.evalId !== evalId) return; // the modal moved on to another evaluation
    contribState.list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (onlySection) renderSlot(onlySection);
    else renderContributions();
  } catch (e) {
    console.error(e);
    const general = slotEl('general');
    if (general) general.innerHTML = `<div class="detail-section"><h4>General Notes</h4><p class="error-msg show">Could not load leader notes: ${escHtml(e.message)}</p></div>`;
  }
}

// ── rendering ──────────────────────────────────────────────────────────

const RATING_OPTIONS = [['', '—'], ['3', '3 — Exceeds'], ['2', '2 — Meets'], ['1', '1 — Improves']];

function ratingSelect(scope, comp, current) {
  const opts = RATING_OPTIONS
    .map(([v, l]) => `<option value="${v}"${String(current == null ? '' : current) === v ? ' selected' : ''}>${l}</option>`)
    .join('');
  return `<div class="field"><label for="cf-${scope}-${comp}">${comp}</label><select id="cf-${scope}-${comp}">${opts}</select></div>`;
}

// scope: 'new' (General add), 'edit' (editing a note), or `sec-<section>` (adding a section note).
// Only General notes carry ratings.
function contribFormHtml(scope, { note = '', ratings = null, id = '', withRatings = true, section = 'general' } = {}) {
  const selects = withRatings ? `<div class="contrib-ratings">${PrideContrib.COMPETENCIES.map(c => ratingSelect(scope, c, ratings && ratings[c])).join('')}</div>` : '';
  let buttons;
  if (scope === 'new') buttons = '<button class="btn btn-primary btn-sm" data-action="contrib-add">Add Input</button>';
  else if (scope === 'edit') buttons = `<button class="btn btn-primary btn-sm" data-action="contrib-save" data-id="${escHtml(id)}">Save</button>
       <button class="btn btn-ghost btn-sm" data-action="contrib-cancel">Cancel</button>`;
  else buttons = `<button class="btn btn-primary btn-sm" data-action="note-add" data-section="${escHtml(section)}">Add note</button>
       <button class="btn btn-ghost btn-sm" data-action="note-cancel" data-section="${escHtml(section)}">Cancel</button>`;
  return `<div class="field"><label for="cf-${scope}-note">Note</label>
      <textarea id="cf-${scope}-note" rows="${withRatings ? 3 : 2}" maxlength="${PrideContrib.MAX_NOTE}">${escHtml(note)}</textarea></div>
    ${selects}
    <div class="error-msg" data-error-for="${scope}"></div>
    <div class="contrib-actions">${buttons}</div>`;
}

function contribItemHtml(c) {
  const mine = c.authorEmail === currentUser.email;
  const who = escHtml(c.authorName || c.authorEmail);
  const section = sectionOf(c);
  if (c.retracted) {
    return `<div class="contrib-item retracted"><div class="contrib-meta">Retracted by ${who} · ${fmtTime(c.updatedAt)}</div></div>`;
  }
  if (contribState.editingId === c.id) {
    return `<div class="contrib-item"><div class="contrib-meta">Editing your note</div>${contribFormHtml('edit', { note: c.note, ratings: c.ratings, id: c.id, withRatings: section === 'general', section })}</div>`;
  }
  const edited = c.rev > 1 ? ` <span class="chip">edited ${fmtTime(c.updatedAt)}</span>` : '';
  const ratings = c.ratings ? `<div class="contrib-ratings-line">${escHtml(PrideContrib.ratingText(c.ratings))}</div>` : '';
  const note = c.note ? `<div class="detail-text">${escHtml(c.note)}</div>` : '';
  const actions = mine
    ? `<div class="contrib-actions">
         <button class="btn btn-ghost btn-sm" data-action="contrib-edit" data-id="${escHtml(c.id)}">Edit</button>
         <button class="btn btn-ghost btn-sm" data-action="contrib-retract" data-id="${escHtml(c.id)}">Retract</button>
       </div>`
    : '';
  return `<div class="contrib-item"><div class="contrib-meta"><strong>${who}</strong> · ${fmtTime(c.createdAt)}${edited}</div>${ratings}${note}${actions}</div>`;
}

function renderGeneralSlot(host) {
  const items = notesFor('general').map(contribItemHtml).join('')
    || '<p class="contrib-empty">No general notes from other leaders yet.</p>';
  host.innerHTML = `
    <div class="detail-section"><h4>General Notes</h4>${items}</div>
    <div class="detail-section"><h4>Add a General Note</h4>${contribFormHtml('new')}</div>`;
}

function renderSlot(section) {
  const host = slotEl(section);
  if (!host) return;
  if (section === 'general') return renderGeneralSlot(host);
  const label = PrideContrib.sectionLabel(section);
  const items = notesFor(section);
  const live = items.filter(c => !c.retracted).length;
  const head = items.length
    ? `<div class="notes-head"><span class="notes-title">Leader notes</span>${live ? `<span class="notes-count">${live}</span>` : ''}</div>`
    : '';
  const add = contribState.openForms.has(section)
    ? contribFormHtml(`sec-${section}`, { withRatings: false, section })
    : `<button type="button" class="btn btn-ghost btn-sm" data-action="note-open" data-section="${escHtml(section)}" aria-label="Add a note on ${escHtml(label)}">${PrideContrib.isSkillSection(section) ? '＋ Add note' : `＋ Add a note on ${escHtml(label)}`}</button>`;
  host.innerHTML = `${head}${items.map(contribItemHtml).join('')}
    <div class="notes-add">${add}</div>
    <div class="error-msg" data-error-for="${slotErrorScope(section)}"></div>`;
}

function renderContributions() {
  document.querySelectorAll('.notes-slot').forEach(h => renderSlot(h.dataset.section));
}

// ── form helpers ───────────────────────────────────────────────────────

function readContribForm(scope, withRatings = true) {
  const ratings = {};
  if (withRatings) PrideContrib.COMPETENCIES.forEach(c => { ratings[c] = document.getElementById(`cf-${scope}-${c}`).value; });
  return { note: document.getElementById(`cf-${scope}-note`).value, ratings: withRatings ? ratings : null };
}

function showContribError(scope, msg) {
  const el = document.querySelector(`[data-error-for="${scope}"]`);
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
}

function setContribButtonsDisabled(disabled) {
  document.querySelectorAll('.notes-slot button').forEach(b => { b.disabled = disabled; });
}

// ── writes ─────────────────────────────────────────────────────────────

// Runs one batched write (note change + its log entry). `busy` blocks double clicks.
// `section` is the slot to refresh afterwards; `errorScope` is where a failure is shown.
async function runContribBatch({ section, errorScope, fill, reloadOnDenied }) {
  if (contribState.busy) return;
  contribState.busy = true;
  setContribButtonsDisabled(true);
  try {
    const batch = db.batch();
    fill(batch);
    await batch.commit();
    contribState.editingId = null;
    contribState.openForms.delete(section);
    await refreshContributions(section);
  } catch (e) {
    console.error(e);
    const denied = e.code === 'permission-denied';
    if (denied && reloadOnDenied) {
      // Stale revision (e.g. edited in another tab): reload and let the user retry
      contribState.editingId = null;
      await refreshContributions(section);
      showContribError(slotErrorScope(section), 'That note changed elsewhere, so it was reloaded. Please try again.');
    } else {
      // Keep the typed text so nothing is lost
      showContribError(errorScope, denied ? 'You do not have permission to do that.' : 'Could not save: ' + (e.message || e));
      setContribButtonsDisabled(false);
    }
  } finally {
    contribState.busy = false;
    // Every notes button was disabled while saving, but only one slot is re-rendered afterwards
    setContribButtonsDisabled(false);
  }
}

function logRef(evalId, activityId) { return evalDocRef(evalId).collection('activity').doc(activityId); }

// General box (ratings allowed) and per-section notes (text only) share this
function addNote(section) {
  const scope = section === 'general' ? 'new' : `sec-${section}`;
  const withRatings = section === 'general';
  const input = { ...readContribForm(scope, withRatings), section };
  const problem = PrideContrib.validateInput(input);
  if (problem) return showContribError(scope, problem);
  const evalId = contribState.evalId;
  const ref = evalDocRef(evalId).collection('contributions').doc();
  const built = PrideContrib.buildAdd({ user: currentUser, contributionId: ref.id, ...input, ts: SERVER_TS() });
  return runContribBatch({
    section, errorScope: scope, reloadOnDenied: false,
    fill: batch => { batch.set(ref, built.contribution); batch.set(logRef(evalId, built.activityId), built.activity); },
  });
}

function saveContributionAction(id) {
  const existing = contribState.list.find(c => c.id === id);
  if (!existing) return;
  const section = sectionOf(existing);
  const input = { ...readContribForm('edit', section === 'general'), section };
  const problem = PrideContrib.validateInput(input);
  if (problem) return showContribError('edit', problem);
  const evalId = contribState.evalId;
  const built = PrideContrib.buildEdit({ user: currentUser, existing, ...input, ts: SERVER_TS() });
  return runContribBatch({
    section, errorScope: 'edit', reloadOnDenied: true,
    fill: batch => {
      batch.update(evalDocRef(evalId).collection('contributions').doc(id), built.update);
      batch.set(logRef(evalId, built.activityId), built.activity);
    },
  });
}

function retractContributionAction(id) {
  const existing = contribState.list.find(c => c.id === id);
  if (!existing) return;
  if (!confirm('Retract your note? It stays in the activity log but is hidden from the evaluation.')) return;
  const section = sectionOf(existing);
  const evalId = contribState.evalId;
  const built = PrideContrib.buildRetract({ user: currentUser, existing, ts: SERVER_TS() });
  return runContribBatch({
    section, errorScope: slotErrorScope(section), reloadOnDenied: true,
    fill: batch => {
      batch.update(evalDocRef(evalId).collection('contributions').doc(id), built.update);
      batch.set(logRef(evalId, built.activityId), built.activity);
    },
  });
}

// Start or stop editing a note, re-rendering only the slots involved
function setEditing(id) {
  const prev = contribState.list.find(c => c.id === contribState.editingId);
  const next = contribState.list.find(c => c.id === id);
  contribState.editingId = id;
  if (prev) renderSlot(sectionOf(prev));
  if (next && (!prev || sectionOf(prev) !== sectionOf(next))) renderSlot(sectionOf(next));
}

function onContribClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn || !(btn.dataset.action.startsWith('contrib-') || btn.dataset.action.startsWith('note-'))) return;
  const id = btn.dataset.id;
  const section = btn.dataset.section;
  switch (btn.dataset.action) {
    case 'contrib-add': return addNote('general');
    case 'contrib-edit': return setEditing(id);
    case 'contrib-cancel': return setEditing(null);
    case 'contrib-save': return saveContributionAction(id);
    case 'contrib-retract': return retractContributionAction(id);
    case 'note-open':
      contribState.openForms.add(section);
      renderSlot(section);
      return document.getElementById(`cf-sec-${section}-note`)?.focus();
    case 'note-cancel':
      contribState.openForms.delete(section);
      return renderSlot(section);
    case 'note-add': return addNote(section);
  }
}

document.getElementById('modal-body').addEventListener('click', onContribClick);

// ── admin Activity feed ────────────────────────────────────────────────

async function loadActivityFeed() {
  const body = document.getElementById('activity-table-body');
  body.innerHTML = '<tr><td colspan="5"><div class="empty-state"><p>Loading activity…</p></div></td></tr>';
  try {
    const snap = await db.collectionGroup('activity').orderBy('at', 'desc').limit(200).get();
    renderActivityFeed(snap.docs.map(d => ({ id: d.id, evalId: d.ref.parent.parent.id, ...d.data() })));
  } catch (e) {
    console.error(e);
    body.innerHTML = `<tr><td colspan="5" style="color:var(--danger);padding:20px;">Error loading activity: ${escHtml(e.message)}</td></tr>`;
  }
}

function renderActivityFeed(rows) {
  const body = document.getElementById('activity-table-body');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="icon">📋</div><p>No activity logged yet.</p></div></td></tr>';
    return;
  }
  body.innerHTML = rows.map(r => {
    const ev = allEvals.find(x => x.id === r.evalId);
    const desc = PrideContrib.describeActivity(r);
    // The evaluation may be older than the 200 loaded; then show its id and no View button
    const evalCell = ev
      ? `<strong>${escHtml(ev.tmName)}</strong><br><small>${escHtml(ev.period)}-Day · ${escHtml(ev.outlet || '')}</small><br>
         <button class="btn btn-outline btn-sm" data-action="open-eval" data-id="${escHtml(r.evalId)}">View</button>`
      : `<small>${escHtml(r.evalId)}</small>`;
    return `<tr>
      <td data-label="When">${fmtTime(r.at)}</td>
      <td data-label="Who">${escHtml(r.byName || r.byEmail)}</td>
      <td data-label="Action">${escHtml(desc.label)}</td>
      <td data-label="Evaluation"><span>${evalCell}</span></td>
      <td data-label="Details">${desc.lines.map(l => escHtml(l)).join('<br>')}</td>
    </tr>`;
  }).join('');
}

document.getElementById('activity-table-body').addEventListener('click', e => {
  const btn = e.target.closest('[data-action="open-eval"]');
  if (btn) openDetail(btn.dataset.id);
});
