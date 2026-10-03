# Leader Contributions — Part 2: Client (UI, Core Logic, Rollout)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any signed-in leader add, edit and retract their own input on a submitted evaluation from the detail modal, and give admins an Activity tab showing every change with before/after.

**Architecture:** Pure logic (validation, document/log builders, activity descriptions, HTML escaping) lives in `contrib-core.js`, unit-tested in Node. DOM and Firestore calls live in `contrib-ui.js`, which uses event delegation on the modal. `index.html` gets small edits: tabs, visibility, batched submit, script tags, CSS. Every write is a Firestore `WriteBatch` containing the contribution change and its log entry, matching the Part 1 rules.

**Tech Stack:** Vanilla JS (classic scripts), Firebase compat SDK 10.12.2 (already loaded), `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-03-leader-contributions-design.md`
**Part 1 (rules, must be done first):** `docs/superpowers/plans/2026-10-03-leader-contributions-part1-rules.md`

## Global Constraints

- Note ≤ 5000 chars; ratings 1–3 or null; a contribution needs a note or at least one rating.
- Document shapes must match Part 1 rules exactly: contribution fields `authorEmail, authorName, note, ratings, createdAt, updatedAt, rev, retracted`; activity fields `type, contributionId, rev, byEmail, byName, at, before, after`.
- Activity IDs: `submitted`, or `{contributionId}_{rev}`.
- All user-supplied text rendered into HTML must go through `PrideContrib.escapeHtml`.
- No new emails for contributions; the first-submission email is unchanged.
- Do **not** add a `Co-Authored-By` trailer to commits (project CLAUDE.md rule).
- Keep every file under 500 lines; `index.html` is already large, so new logic goes in the new files.

## Review Focus

1. Note text containing `<script>`, quotes or `&` must render as text in the modal and the admin feed (Task 1 unit test, Task 4 manual check).
2. A permission-denied write (stale tab, or rules mismatch) must keep the user's typed text for "add", and reload the list with a message for "edit/retract" (Task 3).
3. A leader who opens an evaluation submitted before logging existed sees an empty input list and can still add input (Task 5 manual check).
4. Admin feed rows whose evaluation is not in the loaded list (older than the 200 most recent) must still render, without a View button (Task 4).
5. Double-clicking Add/Save/Retract must not write twice (Task 3 busy guard, Task 5 manual check).

---

## File Structure

| File | Responsibility |
|---|---|
| `contrib-core.js` (create) | pure helpers, exported as global `PrideContrib` and via `module.exports` |
| `tests/contrib-core.test.mjs` (create) | unit tests for the core |
| `contrib-ui.js` (create) | contributions section in the modal, admin Activity feed |
| `index.html` (modify) | tab markup, visibility, batched submit, emulator hook, CSS, script tags |

---

### Task 1: Core logic (`contrib-core.js`)

**Files:**
- Create: `contrib-core.js`, `tests/contrib-core.test.mjs`

**Interfaces:**
- Produces (all on `PrideContrib`): `COMPETENCIES: string[]`, `MAX_NOTE: number`, `escapeHtml(s) → string`, `normalizeRatings(r) → {Pride,Passion,Professionalism}|null`, `ratingText(r) → string`, `validateInput({note, ratings}) → string|null`, `buildSubmitted({user, ts}) → activity`, `buildAdd({user, contributionId, note, ratings, ts}) → {contribution, activityId, activity}`, `buildEdit({user, existing, note, ratings, ts}) → {update, activityId, activity}`, `buildRetract({user, existing, ts}) → {update, activityId, activity}`, `describeActivity(entry) → {label, lines[]}`. `user` is `{email, displayName}`; `existing` is a contribution `{id, rev, note, ratings}`; `ts` is an opaque timestamp value (the server-timestamp sentinel in the browser).

- [ ] **Step 1: Write failing tests**

`tests/contrib-core.test.mjs`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const P = createRequire(import.meta.url)('../contrib-core.js');
const user = { email: 'a@pechanga.com', displayName: 'Alex' };
const TS = Symbol('ts');

describe('validateInput', () => {
  it('rejects empty note with no ratings', () => {
    assert.ok(P.validateInput({ note: '', ratings: null }));
    assert.ok(P.validateInput({ note: '   ', ratings: { Pride: '', Passion: '', Professionalism: '' } }));
  });
  it('accepts a note alone', () => assert.equal(P.validateInput({ note: 'good', ratings: null }), null));
  it('accepts ratings alone (select values are strings)', () => {
    assert.equal(P.validateInput({ note: '', ratings: { Pride: '3', Passion: '', Professionalism: '' } }), null);
  });
  it('enforces the 5000-character limit', () => {
    assert.equal(P.validateInput({ note: 'x'.repeat(5000), ratings: null }), null);
    assert.ok(P.validateInput({ note: 'x'.repeat(5001), ratings: null }));
  });
});

describe('normalizeRatings', () => {
  it('returns null when nothing is rated', () => {
    assert.equal(P.normalizeRatings(null), null);
    assert.equal(P.normalizeRatings({ Pride: '', Passion: null, Professionalism: undefined }), null);
  });
  it('converts strings to ints and blanks to null', () => {
    assert.deepEqual(P.normalizeRatings({ Pride: '3', Passion: '', Professionalism: '1' }),
      { Pride: 3, Passion: null, Professionalism: 1 });
  });
  it('drops out-of-range values', () => {
    assert.deepEqual(P.normalizeRatings({ Pride: '9', Passion: '2', Professionalism: '' }),
      { Pride: null, Passion: 2, Professionalism: null });
  });
});

describe('builders', () => {
  it('buildSubmitted matches the rules shape', () => {
    assert.deepEqual(P.buildSubmitted({ user, ts: TS }), {
      type: 'submitted', contributionId: null, rev: null,
      byEmail: 'a@pechanga.com', byName: 'Alex', at: TS, before: null, after: null,
    });
  });
  it('buildAdd creates rev 1 with an "added" log entry', () => {
    const r = P.buildAdd({ user, contributionId: 'c1', note: '  hi ', ratings: { Pride: '2', Passion: '', Professionalism: '' }, ts: TS });
    assert.deepEqual(r.contribution, {
      authorEmail: 'a@pechanga.com', authorName: 'Alex', note: 'hi',
      ratings: { Pride: 2, Passion: null, Professionalism: null },
      createdAt: TS, updatedAt: TS, rev: 1, retracted: false,
    });
    assert.equal(r.activityId, 'c1_1');
    assert.deepEqual(r.activity, {
      type: 'added', contributionId: 'c1', rev: 1, byEmail: 'a@pechanga.com', byName: 'Alex', at: TS,
      before: null, after: { note: 'hi', ratings: { Pride: 2, Passion: null, Professionalism: null } },
    });
  });
  it('falls back to the email when there is no display name', () => {
    const r = P.buildAdd({ user: { email: 'z@x.com' }, contributionId: 'c', note: 'n', ratings: null, ts: TS });
    assert.equal(r.contribution.authorName, 'z@x.com');
  });
  it('buildEdit bumps rev and records before/after', () => {
    const existing = { id: 'c1', rev: 1, note: 'old', ratings: null };
    const r = P.buildEdit({ user, existing, note: 'new', ratings: null, ts: TS });
    assert.deepEqual(r.update, { note: 'new', ratings: null, updatedAt: TS, rev: 2, retracted: false });
    assert.equal(r.activityId, 'c1_2');
    assert.equal(r.activity.type, 'edited');
    assert.deepEqual(r.activity.before, { note: 'old', ratings: null });
    assert.deepEqual(r.activity.after, { note: 'new', ratings: null });
  });
  it('buildRetract only flips the flag and keeps content in before and after', () => {
    const existing = { id: 'c1', rev: 2, note: 'keep', ratings: { Pride: 1, Passion: null, Professionalism: null } };
    const r = P.buildRetract({ user, existing, ts: TS });
    assert.deepEqual(r.update, { updatedAt: TS, rev: 3, retracted: true });
    assert.equal(r.activityId, 'c1_3');
    assert.equal(r.activity.type, 'retracted');
    assert.deepEqual(r.activity.before, r.activity.after);
    assert.equal(r.activity.after.note, 'keep');
  });
});

describe('describeActivity', () => {
  const base = { byName: 'Alex', contributionId: 'c1' };
  it('describes a submission', () => {
    assert.deepEqual(P.describeActivity({ ...base, type: 'submitted' }), { label: 'submitted the evaluation', lines: [] });
  });
  it('describes an addition with note and ratings', () => {
    const d = P.describeActivity({ ...base, type: 'added', after: { note: 'nice', ratings: { Pride: 3, Passion: null, Professionalism: null } } });
    assert.equal(d.label, 'added input');
    assert.deepEqual(d.lines, ['Note: nice', 'Ratings: Pride 3']);
  });
  it('lists only what changed in an edit', () => {
    const d = P.describeActivity({ ...base, type: 'edited',
      before: { note: 'a', ratings: null }, after: { note: 'b', ratings: null } });
    assert.deepEqual(d.lines, ['Note: "a" → "b"']);
    const d2 = P.describeActivity({ ...base, type: 'edited',
      before: { note: 'a', ratings: null }, after: { note: 'a', ratings: { Pride: 2, Passion: null, Professionalism: null } } });
    assert.deepEqual(d2.lines, ['Ratings: none → Pride 2']);
  });
  it('describes a retraction', () => {
    const d = P.describeActivity({ ...base, type: 'retracted', before: { note: 'oops', ratings: null }, after: { note: 'oops', ratings: null } });
    assert.equal(d.label, 'retracted their input');
    assert.deepEqual(d.lines, ['Was: oops']);
  });
});

describe('escapeHtml', () => {
  it('escapes markup characters', () => {
    assert.equal(P.escapeHtml(`<script>alert("x")</script> & 'y'`),
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;');
  });
  it('turns null and undefined into an empty string', () => {
    assert.equal(P.escapeHtml(null), '');
    assert.equal(P.escapeHtml(undefined), '');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:core`
Expected: FAIL — "Cannot find module '../contrib-core.js'".

- [ ] **Step 3: Implement `contrib-core.js`**

```js
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
```

- [ ] **Step 4: Run to verify passes**

Run: `npm run test:core`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add contrib-core.js tests/contrib-core.test.mjs
git commit -m "Add contribution core logic with unit tests"
```

---

### Task 2: Page wiring — tabs, visibility, batched submit, emulator hook

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `PrideContrib.buildSubmitted` (Task 1).
- Produces: globals `currentIsAdmin: boolean`; tab ids `tab-activity`, panel `panel-activity` with tbody `activity-table-body`; `switchTab('activity')` calls `loadActivityFeed()` (defined in Task 4); `openDetail(id)` calls `initContributions(id)` (defined in Task 3) and renders `<div id="contrib-section">`.

Edits are exact-string replacements (read the file first).

- [ ] **Step 1: Load the new scripts**

Replace
`<script src="https://cdnjs.cloudflare.com/ajax/libs/firebase/10.12.2/firebase-firestore-compat.min.js"></script>`
with
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/firebase/10.12.2/firebase-firestore-compat.min.js"></script>

<script src="contrib-core.js"></script>
<script src="contrib-ui.js"></script>
```

- [ ] **Step 2: Tab markup**

Replace
```html
    <div id="tab-row" class="tabs" style="display:none;">
      <button class="tab-btn active" onclick="switchTab('new')">New Evaluation</button>
      <button class="tab-btn" onclick="switchTab('admin')">All Evaluations</button>
    </div>
```
with
```html
    <div id="tab-row" class="tabs">
      <button class="tab-btn active" data-tab="new" onclick="switchTab('new')">New Evaluation</button>
      <button class="tab-btn" data-tab="admin" onclick="switchTab('admin')">All Evaluations</button>
      <button class="tab-btn" id="tab-activity" data-tab="activity" onclick="switchTab('activity')" hidden>Activity</button>
    </div>
```

- [ ] **Step 3: Activity panel**

Insert immediately above the line `    <!-- ─── ADMIN PANEL ─── -->`:

```html
    <!-- ─── ACTIVITY LOG (admin) ─── -->
    <div id="panel-activity" hidden>
      <div class="page-title">Activity Log</div>
      <p class="page-sub">Everything leaders added, edited or retracted, newest first.</p>
      <div class="section-card" style="overflow:auto;">
        <table class="eval-table">
          <thead>
            <tr><th>When</th><th>Who</th><th>Action</th><th>Evaluation</th><th>Details</th></tr>
          </thead>
          <tbody id="activity-table-body"></tbody>
        </table>
      </div>
    </div>

```

- [ ] **Step 4: `switchTab`**

Replace the whole `switchTab` function with:

```js
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('panel-new').hidden = tab !== 'new';
  document.getElementById('panel-admin').hidden = tab !== 'admin';
  document.getElementById('panel-activity').hidden = tab !== 'activity';
  if (tab === 'activity' && currentIsAdmin) loadActivityFeed();
}
```

- [ ] **Step 5: Globals, emulator hook, `showApp`**

Replace `let db, auth, currentUser, allEvals = [], currentPeriod = null;` with
`let db, auth, currentUser, currentIsAdmin = false, allEvals = [], currentPeriod = null;`

Replace
```js
auth = firebase.auth();
db = firebase.firestore();
```
with
```js
auth = firebase.auth();
db = firebase.firestore();

// Local development talks to the Firebase emulators, never production
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  auth.useEmulator('http://localhost:9099');
  db.useEmulator('localhost', 8080);
}
```

Replace
```js
  document.getElementById('topbar-admin-badge').hidden = !isAdmin;
  document.getElementById('tab-row').style.display = isAdmin ? '' : 'none';

  if (isAdmin) loadEvals();
  restoreDraft();
```
with
```js
  currentIsAdmin = isAdmin;
  document.getElementById('topbar-admin-badge').hidden = !isAdmin;
  document.getElementById('tab-activity').hidden = !isAdmin;
  switchTab('new');

  loadEvals();
  restoreDraft();
```

- [ ] **Step 6: Batched submit**

Replace
```js
    await db.collection('evaluations').add(evaluation);
```
with
```js
    // The evaluation and its "submitted" log entry must be written together (Firestore rules require it)
    const evalRef = db.collection('evaluations').doc();
    const batch = db.batch();
    batch.set(evalRef, evaluation);
    batch.set(evalRef.collection('activity').doc('submitted'),
      PrideContrib.buildSubmitted({ user: currentUser, ts: firebase.firestore.FieldValue.serverTimestamp() }));
    await batch.commit();
```

- [ ] **Step 7: Modal hook**

In `openDetail`, replace
```js
    </div>
  `;
  document.getElementById('detail-modal').classList.add('open');
```
with
```js
    </div>

    <div id="contrib-section"></div>
  `;
  document.getElementById('detail-modal').classList.add('open');
  initContributions(id);
```

- [ ] **Step 8: CSS**

Replace
```css
.setup-banner code { background: rgba(0,0,0,0.08); padding: 1px 5px; border-radius: 3px; font-family: monospace; }
</style>
```
with
```css
.setup-banner code { background: rgba(0,0,0,0.08); padding: 1px 5px; border-radius: 3px; font-family: monospace; }

/* leader contributions */
.contrib-item { border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; background: var(--white); }
.contrib-item.retracted { opacity: 0.6; font-style: italic; text-decoration: line-through; }
.contrib-meta { font-size: 12px; color: var(--mid); margin-bottom: 6px; }
.contrib-ratings-line { font-size: 12px; font-weight: 600; color: var(--gold); margin-bottom: 6px; }
.contrib-ratings { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
@media (max-width: 480px) { .contrib-ratings { grid-template-columns: 1fr; } }
.contrib-actions { display: flex; gap: 8px; margin-top: 10px; }
.contrib-empty { font-size: 13px; color: var(--mid); margin-bottom: 10px; }
</style>
```

- [ ] **Step 9: Syntax check**

Run (from the repo root):
```bash
python - <<'E'
import re
s=open('index.html',encoding='utf-8').read()
open('chk.tmp.js','w',encoding='utf-8').write(re.findall(r'<script>(.*?)</script>',s,re.S)[-1])
E
node --check chk.tmp.js && echo SYNTAX_OK; rm -f chk.tmp.js
```
Expected: `SYNTAX_OK`. (The page will not work in a browser until Task 3 creates `contrib-ui.js`.)

- [ ] **Step 10: Commit** (together with Task 3 if you prefer a working tree at every commit)

```bash
git add index.html
git commit -m "Wire tabs, leader visibility and batched submit into the page"
```

---

### Task 3: Contributions in the evaluation modal (`contrib-ui.js`)

**Files:**
- Create: `contrib-ui.js`

**Interfaces:**
- Consumes: globals `db`, `currentUser` from `index.html`; `PrideContrib` (Task 1).
- Produces: `initContributions(evalId)` (called by `openDetail`); `loadActivityFeed()` and `renderActivityFeed(rows)` are added in Task 4 to the same file.

- [ ] **Step 1: Create `contrib-ui.js`**

```js
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
```

- [ ] **Step 2: Syntax check**

Run: `node --check contrib-ui.js && echo SYNTAX_OK`
Expected: `SYNTAX_OK`.

- [ ] **Step 3: Commit**

```bash
git add contrib-ui.js index.html
git commit -m "Add leader contributions to the evaluation modal"
```

---

### Task 4: Admin Activity feed

**Files:**
- Modify: `contrib-ui.js` (append)

**Interfaces:**
- Consumes: `PrideContrib.describeActivity`, globals `db`, `allEvals`, `openDetail`, `escHtml`, `fmtTime`.
- Produces: `loadActivityFeed()` (called by `switchTab('activity')`).

- [ ] **Step 1: Append to `contrib-ui.js`**

```js
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
      <td>${fmtTime(r.at)}</td>
      <td>${escHtml(r.byName || r.byEmail)}</td>
      <td>${escHtml(desc.label)}</td>
      <td>${evalCell}</td>
      <td>${desc.lines.map(l => escHtml(l)).join('<br>')}</td>
    </tr>`;
  }).join('');
}

document.getElementById('activity-table-body').addEventListener('click', e => {
  const btn = e.target.closest('[data-action="open-eval"]');
  if (btn) openDetail(btn.dataset.id);
});
```

- [ ] **Step 2: Syntax check and re-run unit tests**

Run: `node --check contrib-ui.js && npm run test:core`
Expected: no syntax errors; core tests PASS.

- [ ] **Step 3: Commit**

```bash
git add contrib-ui.js
git commit -m "Add admin Activity feed"
```

---

### Task 5: End-to-end check on the emulators

No new files. This task verifies everything together locally; nothing here touches production.

- [ ] **Step 1: Full automated suite**

Run: `npm test`
Expected: core and all rules tests PASS.

- [ ] **Step 2: Start the emulators**

Run (in a separate terminal tab):
```bash
npx firebase emulators:start --only auth,firestore,hosting --project onboarding-23722
```
Expected: Auth on 9099, Firestore on 8080, Hosting on 5000. The page switches itself to the emulators on `localhost`.

- [ ] **Step 2b: Create emulator-only test accounts**

For each of `arlo.bedolla@gmail.com` (admin), `leader1@test.com`, `leader2@test.com`:
```bash
curl -s -X POST "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake" -H "Content-Type: application/json" -d "{\"email\":\"leader1@test.com\",\"password\":\"Passw0rd!\"}"
```
These exist only in the local emulator.

- [ ] **Step 3: Walk through the flows at http://localhost:5000**

Note: submitting an evaluation still sends the real EmailJS notification to the admin address; use obviously fake team-member names.

1. Sign in as `leader1`: submit an evaluation (fill required fields, all three ratings, trainer name + signature). Expect success, no console errors.
2. Open **All Evaluations** (now visible to leaders) → **View**. Expect "No input from other leaders yet." and the Add form.
3. Add a note-only input; add a ratings-only input (empty note, set Pride = 3); try to add an empty one (expect the inline "Add a note or rate…" error).
4. Add `<script>alert(1)</script> & "quotes"` as a note. Expect it displayed as literal text, no alert (Review Focus 1).
5. Double-click **Add Input** quickly: expect exactly one new entry (Review Focus 5).
6. Sign out, sign in as `leader2`: open the same evaluation; expect leader1's entries with no Edit/Retract buttons. Add input as leader2. Edit leader2's input; expect the "edited" badge. Retract leader2's input; expect a struck-through "Retracted by…" row.
7. In two tabs signed in as leader2, open the same evaluation, edit an entry in tab 1, then edit it in tab 2 without refreshing: tab 2 should show "That entry changed elsewhere, so it was reloaded." (Review Focus 2).
8. Sign in as the admin: an **Activity** tab appears. Expect rows for the submission, each add, the edit (with `Note: "a" → "b"` style details) and the retraction, newest first. Click **View** on a row: the modal opens.
9. Sign in as `leader1` again: no Activity tab. In the browser console run `db.collectionGroup('activity').get().then(console.log, console.error)`: expect a permission-denied error.
10. Legacy evaluation (Review Focus 3): in the emulator, add an evaluation document without an activity entry (e.g. via the Firestore emulator REST API or a one-off console script using the admin SDK against `localhost:8080`), then open it as a leader: expect an empty list and a working Add form.

- [ ] **Step 4: Stop the emulators**, fix anything found (new commits), and re-run `npm test`.

---

### Task 6: Roll out (needs the user's explicit go-ahead)

- [ ] **Step 1: Pre-flight, confirm with the user before continuing**

Tell the user, and wait for a yes on each:
1. Email/password **sign-up is disabled** in Firebase Console → Authentication (reads are now open to every signed-in user).
2. The page becomes unusable for any browser still on the old version until refreshed (new rules require the log entry).
3. The deploy publishes rules, indexes and hosting to production.

- [ ] **Step 2: Deploy**

Run:
```bash
npx firebase deploy --only hosting,firestore --project onboarding-23722
```
Expected: rules compile and release, indexes deploy (the `activity.at` collection-group index may show as "building" for a minute), hosting release complete.

- [ ] **Step 3: Smoke test production**

Hard-refresh https://onboarding-23722.web.app and repeat Task 5 steps 1–3 and 8 with real accounts: submit, add input from a second leader, and confirm the admin sees the Activity feed. If the feed errors with "requires an index", wait for the index build and retry.

- [ ] **Step 4: Push**

```bash
git push
```

**Part 2 done when:** `npm test` is green, the emulator walkthrough passes, and production smoke test passes.
