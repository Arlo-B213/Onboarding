/* DOM + Firestore layer for leader contributions and the admin Activity feed.
   Relies on globals from index.html: db, currentUser, currentIsAdmin, allEvals, openDetail.
   Pure logic lives in contrib-core.js (PrideContrib). */

const escHtml = PrideContrib.escapeHtml;
const SERVER_TS = () => firebase.firestore.FieldValue.serverTimestamp();
const contribState = { evalId: null, list: [], editingId: null, busy: false };

const evalDocRef = id => db.collection('evaluations').doc(id);
const fmtTime = t => (t && t.toDate) ? t.toDate().toLocaleString() : '—';

// ── contributions in the detail modal ──────────────────────────────────

async function initContributions(evalId) {
  contribState.evalId = evalId;
  contribState.editingId = null;
  contribState.list = [];
  const host = document.getElementById('contrib-section');
  if (host) host.innerHTML = '<div class="detail-section"><h4>Leader Input</h4><p class="contrib-empty">Loading…</p></div>';
  await refreshContributions();
}

async function refreshContributions() {
  const evalId = contribState.evalId;
  try {
    const snap = await evalDocRef(evalId).collection('contributions').orderBy('createdAt', 'asc').get();
    if (contribState.evalId !== evalId) return; // the modal moved on to another evaluation
    contribState.list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderContributions();
  } catch (e) {
    console.error(e);
    const host = document.getElementById('contrib-section');
    if (host) host.innerHTML = `<div class="detail-section"><h4>Leader Input</h4><p class="error-msg show">Could not load leader input: ${escHtml(e.message)}</p></div>`;
  }
}

const RATING_OPTIONS = [['', '—'], ['3', '3 — Exceeds'], ['2', '2 — Meets'], ['1', '1 — Improves']];

function ratingSelect(scope, comp, current) {
  const opts = RATING_OPTIONS
    .map(([v, l]) => `<option value="${v}"${String(current == null ? '' : current) === v ? ' selected' : ''}>${l}</option>`)
    .join('');
  return `<div class="field"><label for="cf-${scope}-${comp}">${comp}</label><select id="cf-${scope}-${comp}">${opts}</select></div>`;
}

function contribFormHtml(scope, { note = '', ratings = null, id = '' } = {}) {
  const selects = PrideContrib.COMPETENCIES.map(c => ratingSelect(scope, c, ratings && ratings[c])).join('');
  const buttons = scope === 'new'
    ? '<button class="btn btn-primary btn-sm" data-action="contrib-add">Add Input</button>'
    : `<button class="btn btn-primary btn-sm" data-action="contrib-save" data-id="${escHtml(id)}">Save</button>
       <button class="btn btn-ghost btn-sm" data-action="contrib-cancel">Cancel</button>`;
  return `<div class="field"><label for="cf-${scope}-note">Note</label>
      <textarea id="cf-${scope}-note" rows="3" maxlength="${PrideContrib.MAX_NOTE}">${escHtml(note)}</textarea></div>
    <div class="contrib-ratings">${selects}</div>
    <div class="error-msg" data-error-for="${scope}"></div>
    <div class="contrib-actions">${buttons}</div>`;
}

function contribItemHtml(c) {
  const mine = c.authorEmail === currentUser.email;
  const who = escHtml(c.authorName || c.authorEmail);
  if (c.retracted) {
    return `<div class="contrib-item retracted"><div class="contrib-meta">Retracted by ${who} · ${fmtTime(c.updatedAt)}</div></div>`;
  }
  if (contribState.editingId === c.id) {
    return `<div class="contrib-item"><div class="contrib-meta">Editing your input</div>${contribFormHtml('edit', { note: c.note, ratings: c.ratings, id: c.id })}</div>`;
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

function renderContributions() {
  const host = document.getElementById('contrib-section');
  if (!host) return;
  const items = contribState.list.map(contribItemHtml).join('')
    || '<p class="contrib-empty">No input from other leaders yet.</p>';
  host.innerHTML = `
    <div class="detail-section"><h4>Leader Input</h4>${items}</div>
    <div class="detail-section"><h4>Add My Input</h4>${contribFormHtml('new')}</div>`;
}

function readContribForm(scope) {
  const ratings = {};
  PrideContrib.COMPETENCIES.forEach(c => { ratings[c] = document.getElementById(`cf-${scope}-${c}`).value; });
  return { note: document.getElementById(`cf-${scope}-note`).value, ratings };
}

function showContribError(scope, msg) {
  const el = document.querySelector(`[data-error-for="${scope}"]`);
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
}

function setContribButtonsDisabled(disabled) {
  document.querySelectorAll('#contrib-section button').forEach(b => { b.disabled = disabled; });
}

// Runs one batched write (contribution change + its log entry). `busy` blocks double clicks.
async function runContribBatch(scope, fill, { reloadOnDenied }) {
  if (contribState.busy) return;
  contribState.busy = true;
  setContribButtonsDisabled(true);
  try {
    const batch = db.batch();
    fill(batch);
    await batch.commit();
    contribState.editingId = null;
    await refreshContributions();
  } catch (e) {
    console.error(e);
    const denied = e.code === 'permission-denied';
    if (denied && reloadOnDenied) {
      // Stale revision (e.g. edited in another tab): reload and let the user retry
      contribState.editingId = null;
      await refreshContributions();
      showContribError('new', 'That entry changed elsewhere, so it was reloaded. Please try again.');
    } else {
      // Keep the typed text so nothing is lost
      showContribError(scope, denied ? 'You do not have permission to do that.' : 'Could not save: ' + (e.message || e));
      setContribButtonsDisabled(false);
    }
  } finally {
    contribState.busy = false;
  }
}

function addContributionAction() {
  const input = readContribForm('new');
  const problem = PrideContrib.validateInput(input);
  if (problem) return showContribError('new', problem);
  const evalId = contribState.evalId;
  const ref = evalDocRef(evalId).collection('contributions').doc();
  const built = PrideContrib.buildAdd({ user: currentUser, contributionId: ref.id, ...input, ts: SERVER_TS() });
  return runContribBatch('new', batch => {
    batch.set(ref, built.contribution);
    batch.set(evalDocRef(evalId).collection('activity').doc(built.activityId), built.activity);
  }, { reloadOnDenied: false });
}

function saveContributionAction(id) {
  const existing = contribState.list.find(c => c.id === id);
  if (!existing) return;
  const input = readContribForm('edit');
  const problem = PrideContrib.validateInput(input);
  if (problem) return showContribError('edit', problem);
  const evalId = contribState.evalId;
  const built = PrideContrib.buildEdit({ user: currentUser, existing, ...input, ts: SERVER_TS() });
  return runContribBatch('edit', batch => {
    batch.update(evalDocRef(evalId).collection('contributions').doc(id), built.update);
    batch.set(evalDocRef(evalId).collection('activity').doc(built.activityId), built.activity);
  }, { reloadOnDenied: true });
}

function retractContributionAction(id) {
  const existing = contribState.list.find(c => c.id === id);
  if (!existing) return;
  if (!confirm('Retract your input? It stays in the activity log but is hidden from the evaluation.')) return;
  const evalId = contribState.evalId;
  const built = PrideContrib.buildRetract({ user: currentUser, existing, ts: SERVER_TS() });
  return runContribBatch('new', batch => {
    batch.update(evalDocRef(evalId).collection('contributions').doc(id), built.update);
    batch.set(evalDocRef(evalId).collection('activity').doc(built.activityId), built.activity);
  }, { reloadOnDenied: true });
}

function onContribClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn || !btn.dataset.action.startsWith('contrib-')) return;
  const id = btn.dataset.id;
  switch (btn.dataset.action) {
    case 'contrib-add': return addContributionAction();
    case 'contrib-edit': contribState.editingId = id; return renderContributions();
    case 'contrib-cancel': contribState.editingId = null; return renderContributions();
    case 'contrib-save': return saveContributionAction(id);
    case 'contrib-retract': return retractContributionAction(id);
  }
}

document.getElementById('modal-body').addEventListener('click', onContribClick);
