# Leader Contributions — Part 1: Firestore Rules & Test Harness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Firestore backend enforce the leader-contribution model (open reads for leaders, append-only contributions, rules-enforced activity log) with an emulator test suite proving it.

**Architecture:** `evaluations/{id}` stays immutable. Leader input lives in `evaluations/{id}/contributions/{cid}`; every change must be written in the same batch as an `evaluations/{id}/activity/{activityId}` entry, which the rules cross-check with `getAfter()`/`get()`. No Cloud Functions.

**Tech Stack:** Firestore security rules (`rules_version = '2'`), Node 24, `node:test`, `@firebase/rules-unit-testing` 5.x, `firebase` 12.x, `firebase-tools` 15.x, Firestore emulator (needs Java 21+).

**Spec:** `docs/superpowers/specs/2026-10-03-leader-contributions-design.md`
**Part 2 (client UI):** `docs/superpowers/plans/2026-10-03-leader-contributions-part2-client.md` — do Part 1 first.

## Global Constraints

- Free Firebase (Spark) plan: no Cloud Functions, no paid features.
- Contribution `note`: 0–5000 characters; ratings each 1–3 or null; note non-empty OR at least one rating.
- Activity doc IDs: `submitted` for the original submission, otherwise `{contributionId}_{rev}`.
- Contributions are never deleted (retract flag only); evaluations and activity are never updated or deleted.
- Admin emails in the rules: `arlo.bedolla@gmail.com`, `abedolla@pechanga.com` (must match `ADMIN_EMAILS` in `index.html`).
- Do **not** add a `Co-Authored-By` trailer to commits (project CLAUDE.md rule).
- Keep every file under 500 lines.

## Review Focus

Failure modes the spec implies; each has a test in the named task.

1. Evaluations submitted before this feature have no `activity/submitted` doc — leaders must still be able to add contributions to them (Task 3).
2. A leader edits a contribution after retracting it — must be rejected (Task 4).
3. The same user edits from two tabs: the second write carries a stale `rev` and must be rejected (Task 4).
4. A forged log entry that points at an existing contribution revision, or at a contribution that does not exist, must be rejected (Task 5).
5. A ratings-only contribution (empty note) is valid; an empty note with no ratings is not (Task 3).

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` (create) | test scripts and dev dependencies |
| `firebase.json` (modify) | emulator ports, indexes file, hosting ignores |
| `firestore.rules` (modify) | all access rules |
| `firestore.indexes.json` (create, Task 5) | collection-group index for the admin feed |
| `tests/helpers.mjs` (create) | emulator setup, users, document builders, seed helpers |
| `tests/rules.evaluations.test.mjs` (create) | evaluation + submitted-log rules |
| `tests/rules.contributions.test.mjs` (create) | contribution create/edit/retract rules |
| `tests/rules.activity.test.mjs` (create) | activity read/forgery/delete rules |

---

### Task 1: Test harness

**Files:**
- Create: `package.json`, `tests/helpers.mjs`, `tests/rules.evaluations.test.mjs`
- Modify: `firebase.json`

**Interfaces:**
- Produces (`tests/helpers.mjs`): `ADMIN`, `LEADER_A`, `LEADER_B` (email strings); `createEnv() → Promise<RulesTestEnvironment>`; `dbAs(env, email)`, `anonDb(env)`; `submitEvaluation(db, opts)`, `addContribution(db, opts)`, `changeContribution(db, opts)` (batch commits, return promises); `seedEvaluation(env, opts)`, `seedContribution(env, opts)`; document builders `evalDoc`, `submittedLog`, `contribDoc`, `addedLog`; re-exports `assertSucceeds`, `assertFails`.

- [ ] **Step 1: Verify Java 21+ is available**

Run: `java -version`
Expected: a version line with 21 or higher. If `java: command not found`, **ask the user for permission**, then install: `winget install EclipseAdoptium.Temurin.21.JDK`, open a new shell, and re-run `java -version`.

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "pride-training-log",
  "private": true,
  "scripts": {
    "test": "npm run test:core && npm run test:rules",
    "test:core": "node --test tests/contrib-core.test.mjs",
    "test:rules": "firebase emulators:exec --only firestore --project demo-pride \"node --test --test-concurrency=1 tests/rules.*.test.mjs\""
  },
  "devDependencies": {
    "@firebase/rules-unit-testing": "^5.0.2",
    "firebase": "^12.19.0",
    "firebase-tools": "^15.32.1"
  }
}
```

(`test:core` points at a file created in Part 2; until then run `npm run test:rules` directly.)

- [ ] **Step 3: Install**

Run: `npm install`
Expected: completes without errors; `node_modules/` appears (already git-ignored).

- [ ] **Step 4: Update `firebase.json`**

Replace the whole file with:

```json
{
  "firestore": {
    "rules": "firestore.rules"
  },
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "hosting": { "port": 5000 },
    "ui": { "enabled": false },
    "singleProjectMode": true
  },
  "hosting": {
    "public": ".",
    "ignore": [
      "firebase.json",
      "firestore.rules",
      "firestore.indexes.json",
      "package.json",
      "package-lock.json",
      "tests/**",
      "docs/**",
      "**/.*",
      "**/node_modules/**"
    ],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  }
}
```

- [ ] **Step 5: Create `tests/helpers.mjs`**

```js
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

export { assertSucceeds, assertFails };

export const ADMIN = 'arlo.bedolla@gmail.com';
export const LEADER_A = 'a@pechanga.com';
export const LEADER_B = 'b@pechanga.com';

export function createEnv() {
  return initializeTestEnvironment({
    projectId: 'demo-pride',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
}

export const dbAs = (env, email) =>
  env.authenticatedContext(email.split('@')[0], { email }).firestore();
export const anonDb = env => env.unauthenticatedContext().firestore();

// ── document builders ──
export const evalDoc = (by, over = {}) => ({
  tmName: 'Pat', outlet: 'Great Oak', period: 30,
  submittedBy: by, submittedAt: serverTimestamp(), ...over,
});
export const submittedLog = (by, over = {}) => ({
  type: 'submitted', contributionId: null, rev: null,
  byEmail: by, byName: by, at: serverTimestamp(), before: null, after: null, ...over,
});
export const contribDoc = ({ by, note = 'hello', ratings = null, over = {} }) => ({
  authorEmail: by, authorName: by, note, ratings,
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(), rev: 1, retracted: false, ...over,
});
export const addedLog = ({ cid, by, note = 'hello', ratings = null, over = {} }) => ({
  type: 'added', contributionId: cid, rev: 1, byEmail: by, byName: by,
  at: serverTimestamp(), before: null, after: { note, ratings }, ...over,
});

// ── batch writers (what the real client does) ──
export function submitEvaluation(db, { id = 'e1', by = LEADER_A, evalOver = {}, logOver = {}, withLog = true } = {}) {
  const b = writeBatch(db);
  b.set(doc(db, 'evaluations', id), evalDoc(by, evalOver));
  if (withLog) b.set(doc(db, 'evaluations', id, 'activity', 'submitted'), submittedLog(by, logOver));
  return b.commit();
}

export function addContribution(db, { evalId = 'e1', cid = 'c1', by = LEADER_A, note = 'hello', ratings = null,
  contribOver = {}, logOver = {}, withLog = true } = {}) {
  const b = writeBatch(db);
  b.set(doc(db, 'evaluations', evalId, 'contributions', cid), contribDoc({ by, note, ratings, over: contribOver }));
  if (withLog) b.set(doc(db, 'evaluations', evalId, 'activity', `${cid}_1`), addedLog({ cid, by, note, ratings, over: logOver }));
  return b.commit();
}

// Edit (retract=false) or retract (retract=true) an existing contribution.
// `before`/`after` are {note, ratings} snapshots; for a retract pass the same value for both.
export function changeContribution(db, { evalId = 'e1', cid = 'c1', by = LEADER_A, rev = 2, before, after,
  retract = false, contribOver = {}, logOver = {}, withLog = true, logId } = {}) {
  const b = writeBatch(db);
  b.update(doc(db, 'evaluations', evalId, 'contributions', cid), {
    note: after.note, ratings: after.ratings, updatedAt: serverTimestamp(), rev, retracted: retract, ...contribOver,
  });
  if (withLog) {
    b.set(doc(db, 'evaluations', evalId, 'activity', logId ?? `${cid}_${rev}`), {
      type: retract ? 'retracted' : 'edited', contributionId: cid, rev,
      byEmail: by, byName: by, at: serverTimestamp(), before, after, ...logOver,
    });
  }
  return b.commit();
}

// ── seeds (bypass rules) ──
export async function seedEvaluation(env, { id = 'e1', by = LEADER_A, withLog = true } = {}) {
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    await setDoc(doc(db, 'evaluations', id), evalDoc(by));
    if (withLog) await setDoc(doc(db, 'evaluations', id, 'activity', 'submitted'), submittedLog(by));
  });
}

export async function seedContribution(env, { evalId = 'e1', cid = 'c1', by = LEADER_A, note = 'first', ratings = null } = {}) {
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    await setDoc(doc(db, 'evaluations', evalId, 'contributions', cid), contribDoc({ by, note, ratings }));
    await setDoc(doc(db, 'evaluations', evalId, 'activity', `${cid}_1`), addedLog({ cid, by, note, ratings }));
  });
}
```

- [ ] **Step 6: Create the first test file (passes against today's rules)**

`tests/rules.evaluations.test.mjs`:

```js
import { describe, it, before, after, beforeEach } from 'node:test';
import { doc, getDoc } from 'firebase/firestore';
import { createEnv, anonDb, seedEvaluation, assertFails } from './helpers.mjs';

let env;
before(async () => { env = await createEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

describe('evaluations', () => {
  it('signed-out users cannot read an evaluation', async () => {
    await seedEvaluation(env);
    await assertFails(getDoc(doc(anonDb(env), 'evaluations', 'e1')));
  });
});
```

- [ ] **Step 7: Run the harness**

Run: `npm run test:rules`
Expected: emulator starts, 1 test passes, exit code 0. If it fails to start, re-check Java (Step 1).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json firebase.json tests/helpers.mjs tests/rules.evaluations.test.mjs
git commit -m "Add Firestore rules test harness and emulator config"
```

---

### Task 2: Evaluation + `submitted` log rules

**Files:**
- Modify: `firestore.rules` (full rewrite), `tests/rules.evaluations.test.mjs`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: rule helpers later tasks extend — `isAdmin()`, `signedIn()`, `evalPath(evalId)`, `contribPath(evalId, cid)`, `activityPath(evalId, aid)`, `validActivity(d)`, `submittedEntry(evalId, aid, d)`.

- [ ] **Step 1: Add failing tests**

Replace `tests/rules.evaluations.test.mjs` with:

```js
import { describe, it, before, after, beforeEach } from 'node:test';
import { doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import {
  createEnv, dbAs, anonDb, seedEvaluation, submitEvaluation, assertSucceeds, assertFails,
  ADMIN, LEADER_A, LEADER_B,
} from './helpers.mjs';

let env;
before(async () => { env = await createEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

describe('evaluations: read', () => {
  it('signed-out users cannot read', async () => {
    await seedEvaluation(env);
    await assertFails(getDoc(doc(anonDb(env), 'evaluations', 'e1')));
  });
  it('any signed-in leader can read', async () => {
    await seedEvaluation(env);
    await assertSucceeds(getDoc(doc(dbAs(env, LEADER_B), 'evaluations', 'e1')));
  });
});

describe('evaluations: create', () => {
  it('succeeds when written with its submitted log entry', async () => {
    await assertSucceeds(submitEvaluation(dbAs(env, LEADER_A)));
  });
  it('fails without the submitted log entry', async () => {
    await assertFails(submitEvaluation(dbAs(env, LEADER_A), { withLog: false }));
  });
  it('fails when submittedBy is someone else', async () => {
    await assertFails(submitEvaluation(dbAs(env, LEADER_A), { by: LEADER_B }));
  });
  it('fails when the log entry names a different actor', async () => {
    await assertFails(submitEvaluation(dbAs(env, LEADER_A), { logOver: { byEmail: LEADER_B } }));
  });
  it('fails when signed out', async () => {
    await assertFails(submitEvaluation(anonDb(env)));
  });
  it('fails when the log entry has the wrong type', async () => {
    await assertFails(submitEvaluation(dbAs(env, LEADER_A), { logOver: { type: 'added' } }));
  });
});

describe('evaluations: immutable', () => {
  it('nobody can update an evaluation, even an admin', async () => {
    await seedEvaluation(env);
    await assertFails(updateDoc(doc(dbAs(env, ADMIN), 'evaluations', 'e1'), { tmName: 'X' }));
  });
  it('nobody can delete an evaluation, even an admin', async () => {
    await seedEvaluation(env);
    await assertFails(deleteDoc(doc(dbAs(env, ADMIN), 'evaluations', 'e1')));
  });
});
```

- [ ] **Step 2: Run to verify failures**

Run: `npm run test:rules`
Expected: FAIL — "any signed-in leader can read" and "succeeds when written with its submitted log entry" fail against the old rules.

- [ ] **Step 3: Rewrite `firestore.rules`**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ── helpers ──
    // Keep in sync with ADMIN_EMAILS in index.html
    function isAdmin() {
      return request.auth != null
        && request.auth.token.email.lower() in [
          'arlo.bedolla@gmail.com',
          'abedolla@pechanga.com'
        ];
    }
    function signedIn() { return request.auth != null; }

    function evalPath(evalId) {
      return /databases/$(database)/documents/evaluations/$(evalId);
    }
    function contribPath(evalId, cid) {
      return /databases/$(database)/documents/evaluations/$(evalId)/contributions/$(cid);
    }
    function activityPath(evalId, aid) {
      return /databases/$(database)/documents/evaluations/$(evalId)/activity/$(aid);
    }

    // ── activity log entries ──
    function validActivity(d) {
      return d.keys().hasAll(['type', 'contributionId', 'rev', 'byEmail', 'byName', 'at', 'before', 'after'])
        && d.keys().hasOnly(['type', 'contributionId', 'rev', 'byEmail', 'byName', 'at', 'before', 'after'])
        && d.type in ['submitted', 'added', 'edited', 'retracted']
        && d.byEmail == request.auth.token.email
        && d.byName is string && d.byName.size() <= 200
        && d.at == request.time;
    }

    function submittedEntry(evalId, aid, d) {
      return d.type == 'submitted'
        && aid == 'submitted'
        && d.contributionId == null && d.rev == null
        && d.before == null && d.after == null
        && existsAfter(evalPath(evalId))
        && getAfter(evalPath(evalId)).data.submittedBy == d.byEmail;
    }

    // ── evaluations ──
    match /evaluations/{evalId} {
      allow read: if signedIn();
      allow create: if signedIn()
        && request.resource.data.submittedBy == request.auth.token.email
        && request.resource.data.submittedAt == request.time
        && existsAfter(activityPath(evalId, 'submitted'))
        && getAfter(activityPath(evalId, 'submitted')).data.type == 'submitted';
      allow update, delete: if false;

      match /activity/{activityId} {
        allow create: if signedIn()
          && validActivity(request.resource.data)
          && submittedEntry(evalId, activityId, request.resource.data);
        allow update, delete: if false;
      }
    }

    // Deny everything else
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

- [ ] **Step 4: Run to verify passes**

Run: `npm run test:rules`
Expected: all tests in `rules.evaluations.test.mjs` PASS.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules tests/rules.evaluations.test.mjs
git commit -m "Open evaluation reads to leaders; require submitted log entry on create"
```

---

### Task 3: Contribution create + `added` log entry

**Files:**
- Modify: `firestore.rules`
- Create: `tests/rules.contributions.test.mjs`

**Interfaces:**
- Consumes: Task 2 helpers (`validActivity`, `contribPath`, `activityPath`, `evalPath`).
- Produces: rule helpers `validRating`, `validRatings`, `hasAnyRating`, `validContribution(d)`, `changeEntry(evalId, aid, d)` (handles `added`, `edited`, `retracted`).

- [ ] **Step 1: Write failing tests**

`tests/rules.contributions.test.mjs`:

```js
import { describe, it, before, after, beforeEach } from 'node:test';
import { doc, getDoc } from 'firebase/firestore';
import {
  createEnv, dbAs, anonDb, seedEvaluation, seedContribution, addContribution,
  assertSucceeds, assertFails, LEADER_A, LEADER_B,
} from './helpers.mjs';

let env;
before(async () => { env = await createEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); await seedEvaluation(env); });

describe('contributions: read', () => {
  it('any signed-in leader can read', async () => {
    await seedContribution(env);
    await assertSucceeds(getDoc(doc(dbAs(env, LEADER_B), 'evaluations', 'e1', 'contributions', 'c1')));
  });
  it('signed-out users cannot read', async () => {
    await seedContribution(env);
    await assertFails(getDoc(doc(anonDb(env), 'evaluations', 'e1', 'contributions', 'c1')));
  });
});

describe('contributions: create', () => {
  it('another leader can add input with its log entry', async () => {
    await assertSucceeds(addContribution(dbAs(env, LEADER_B), { by: LEADER_B }));
  });
  it('fails without the log entry', async () => {
    await assertFails(addContribution(dbAs(env, LEADER_B), { by: LEADER_B, withLog: false }));
  });
  it('fails when authorEmail is someone else', async () => {
    await assertFails(addContribution(dbAs(env, LEADER_B), { by: LEADER_A }));
  });
  it('fails when rev is not 1', async () => {
    await assertFails(addContribution(dbAs(env, LEADER_B), { by: LEADER_B, contribOver: { rev: 2 } }));
  });
  it('fails when created already retracted', async () => {
    await assertFails(addContribution(dbAs(env, LEADER_B), { by: LEADER_B, contribOver: { retracted: true } }));
  });
  it('fails with an unexpected extra field', async () => {
    await assertFails(addContribution(dbAs(env, LEADER_B), { by: LEADER_B, contribOver: { admin: true } }));
  });
  it('fails when the log "after" does not match the contribution', async () => {
    await assertFails(addContribution(dbAs(env, LEADER_B), {
      by: LEADER_B, logOver: { after: { note: 'something else', ratings: null } },
    }));
  });
  it('fails on an evaluation that does not exist', async () => {
    await assertFails(addContribution(dbAs(env, LEADER_B), { by: LEADER_B, evalId: 'nope' }));
  });
  it('fails when signed out', async () => {
    await assertFails(addContribution(anonDb(env)));
  });

  // Review Focus 1: legacy evaluation (no submitted log entry)
  it('works on an evaluation submitted before logging existed', async () => {
    await env.clearFirestore();
    await seedEvaluation(env, { withLog: false });
    await assertSucceeds(addContribution(dbAs(env, LEADER_B), { by: LEADER_B }));
  });

  // Review Focus 5: ratings-only vs empty
  it('allows ratings with an empty note', async () => {
    const ratings = { Pride: 3, Passion: null, Professionalism: null };
    await assertSucceeds(addContribution(dbAs(env, LEADER_B), { by: LEADER_B, note: '', ratings }));
  });
  it('rejects an empty note with no ratings', async () => {
    await assertFails(addContribution(dbAs(env, LEADER_B), { by: LEADER_B, note: '', ratings: null }));
  });
  it('rejects an empty note when every rating is null', async () => {
    const ratings = { Pride: null, Passion: null, Professionalism: null };
    await assertFails(addContribution(dbAs(env, LEADER_B), { by: LEADER_B, note: '', ratings }));
  });

  it('accepts a 5000-character note and rejects 5001', async () => {
    await assertSucceeds(addContribution(dbAs(env, LEADER_B), { by: LEADER_B, cid: 'ok', note: 'x'.repeat(5000) }));
    await assertFails(addContribution(dbAs(env, LEADER_B), { by: LEADER_B, cid: 'big', note: 'x'.repeat(5001) }));
  });
  it('rejects a rating outside 1-3', async () => {
    const ratings = { Pride: 4, Passion: null, Professionalism: null };
    await assertFails(addContribution(dbAs(env, LEADER_B), { by: LEADER_B, ratings }));
  });
  it('rejects an unknown rating key', async () => {
    const ratings = { Pride: 3, Passion: null, Professionalism: null, Bonus: 1 };
    await assertFails(addContribution(dbAs(env, LEADER_B), { by: LEADER_B, ratings }));
  });
});
```

- [ ] **Step 2: Run to verify failures**

Run: `npm run test:rules`
Expected: FAIL — every "succeeds"/"allows" case fails (no contribution rules yet); the "fails"/"rejects" cases pass for the wrong reason.

- [ ] **Step 3: Add contribution helpers to `firestore.rules`**

Insert after the `activityPath` function:

```
    // ── contributions ──
    function validRating(v) { return v == null || v in [1, 2, 3]; }
    function validRatings(r) {
      return r == null || (r is map
        && r.keys().hasOnly(['Pride', 'Passion', 'Professionalism'])
        && validRating(r.get('Pride', null))
        && validRating(r.get('Passion', null))
        && validRating(r.get('Professionalism', null)));
    }
    function hasAnyRating(r) {
      return r != null && (r.get('Pride', null) != null
        || r.get('Passion', null) != null
        || r.get('Professionalism', null) != null);
    }
    function validContribution(d) {
      return d.keys().hasAll(['authorEmail', 'authorName', 'note', 'ratings', 'createdAt', 'updatedAt', 'rev', 'retracted'])
        && d.keys().hasOnly(['authorEmail', 'authorName', 'note', 'ratings', 'createdAt', 'updatedAt', 'rev', 'retracted'])
        && d.authorEmail is string
        && d.authorName is string && d.authorName.size() <= 200
        && d.note is string && d.note.size() <= 5000
        && validRatings(d.ratings)
        && (d.note.size() > 0 || hasAnyRating(d.ratings))
        && d.rev is int
        && d.retracted is bool;
    }
```

- [ ] **Step 4: Add `changeEntry` after `submittedEntry`**

```
    // Log entry for an added / edited / retracted contribution. It must describe a
    // change that really happens in the same batch.
    function changeEntry(evalId, aid, d) {
      return d.type in ['added', 'edited', 'retracted']
        && d.contributionId is string && d.rev is int
        && aid == d.contributionId + '_' + string(d.rev)
        && existsAfter(contribPath(evalId, d.contributionId))
        && getAfter(contribPath(evalId, d.contributionId)).data.rev == d.rev
        && getAfter(contribPath(evalId, d.contributionId)).data.authorEmail == d.byEmail
        && getAfter(contribPath(evalId, d.contributionId)).data.retracted == (d.type == 'retracted')
        && d.after is map
        && d.after.keys().hasAll(['note', 'ratings'])
        && d.after.keys().hasOnly(['note', 'ratings'])
        && d.after.note == getAfter(contribPath(evalId, d.contributionId)).data.note
        && d.after.ratings == getAfter(contribPath(evalId, d.contributionId)).data.ratings
        && (d.type == 'added'
          ? (d.rev == 1 && d.before == null && !exists(contribPath(evalId, d.contributionId)))
          : (d.rev >= 2 && d.before is map
             && d.before.keys().hasAll(['note', 'ratings'])
             && d.before.keys().hasOnly(['note', 'ratings'])
             && exists(contribPath(evalId, d.contributionId))
             && get(contribPath(evalId, d.contributionId)).data.rev == d.rev - 1
             && d.before.note == get(contribPath(evalId, d.contributionId)).data.note
             && d.before.ratings == get(contribPath(evalId, d.contributionId)).data.ratings));
    }
```

- [ ] **Step 5: Allow change entries and add the contributions match**

In the `match /activity/{activityId}` block, change the create condition to:

```
        allow create: if signedIn()
          && validActivity(request.resource.data)
          && (submittedEntry(evalId, activityId, request.resource.data)
              || changeEntry(evalId, activityId, request.resource.data));
```

Then add, inside `match /evaluations/{evalId}` (above the `activity` match):

```
      match /contributions/{cid} {
        allow read: if signedIn();
        allow create: if signedIn()
          && exists(evalPath(evalId))
          && validContribution(request.resource.data)
          && request.resource.data.authorEmail == request.auth.token.email
          && request.resource.data.rev == 1
          && request.resource.data.retracted == false
          && request.resource.data.createdAt == request.time
          && request.resource.data.updatedAt == request.time
          && existsAfter(activityPath(evalId, cid + '_1'))
          && getAfter(activityPath(evalId, cid + '_1')).data.type == 'added';
        allow update, delete: if false;   // update is added in Task 4
      }
```

- [ ] **Step 6: Run to verify passes**

Run: `npm run test:rules`
Expected: all contribution-create tests and the Task 2 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add firestore.rules tests/rules.contributions.test.mjs
git commit -m "Add contribution create rules with rules-enforced added log entry"
```

---

### Task 4: Edit & retract rules

**Files:**
- Modify: `firestore.rules`, `tests/rules.contributions.test.mjs`

**Interfaces:**
- Consumes: Task 3 `validContribution`, `changeEntry`, `activityPath`.

- [ ] **Step 1: Append failing tests**

Add to the end of `tests/rules.contributions.test.mjs` (also add `changeContribution` to the helpers import):

```js
const FIRST = { note: 'first', ratings: null };
const SECOND = { note: 'second', ratings: { Pride: 2, Passion: null, Professionalism: null } };

describe('contributions: edit', () => {
  beforeEach(async () => { await seedContribution(env, { by: LEADER_A, note: 'first' }); });

  it('the author can edit with a matching log entry', async () => {
    await assertSucceeds(changeContribution(dbAs(env, LEADER_A), { before: FIRST, after: SECOND }));
  });
  it('another leader cannot edit it', async () => {
    await assertFails(changeContribution(dbAs(env, LEADER_B), { by: LEADER_B, before: FIRST, after: SECOND }));
  });
  it('fails without the log entry', async () => {
    await assertFails(changeContribution(dbAs(env, LEADER_A), { before: FIRST, after: SECOND, withLog: false }));
  });
  it('fails when rev skips ahead', async () => {
    await assertFails(changeContribution(dbAs(env, LEADER_A), { rev: 3, before: FIRST, after: SECOND }));
  });
  it('fails when the log "before" is wrong', async () => {
    await assertFails(changeContribution(dbAs(env, LEADER_A), {
      before: { note: 'not what it was', ratings: null }, after: SECOND,
    }));
  });
  it('fails when the log "after" does not match the new content', async () => {
    await assertFails(changeContribution(dbAs(env, LEADER_A), {
      before: FIRST, after: SECOND, logOver: { after: { note: 'lie', ratings: null } },
    }));
  });
  it('cannot change authorEmail', async () => {
    await assertFails(changeContribution(dbAs(env, LEADER_A), {
      before: FIRST, after: SECOND, contribOver: { authorEmail: LEADER_B },
    }));
  });
  it('cannot clear both note and ratings', async () => {
    await assertFails(changeContribution(dbAs(env, LEADER_A), { before: FIRST, after: { note: '', ratings: null } }));
  });

  // Review Focus 3: same user, two tabs — the second write has a stale rev
  it('rejects a second edit that reuses the same rev', async () => {
    await assertSucceeds(changeContribution(dbAs(env, LEADER_A), { before: FIRST, after: SECOND }));
    await assertFails(changeContribution(dbAs(env, LEADER_A), {
      rev: 2, before: FIRST, after: { note: 'third', ratings: null },
    }));
  });
});

describe('contributions: retract', () => {
  beforeEach(async () => { await seedContribution(env, { by: LEADER_A, note: 'first' }); });

  it('the author can retract with a matching log entry', async () => {
    await assertSucceeds(changeContribution(dbAs(env, LEADER_A), { retract: true, before: FIRST, after: FIRST }));
  });
  it('another leader cannot retract it', async () => {
    await assertFails(changeContribution(dbAs(env, LEADER_B), { by: LEADER_B, retract: true, before: FIRST, after: FIRST }));
  });
  it('a retract cannot also change the note', async () => {
    await assertFails(changeContribution(dbAs(env, LEADER_A), {
      retract: true, before: FIRST, after: { note: 'sneaky', ratings: null },
    }));
  });

  // Review Focus 2: edit after retract
  it('cannot be edited after it was retracted', async () => {
    await assertSucceeds(changeContribution(dbAs(env, LEADER_A), { retract: true, before: FIRST, after: FIRST }));
    await assertFails(changeContribution(dbAs(env, LEADER_A), { rev: 3, before: FIRST, after: SECOND }));
  });
  it('cannot be un-retracted', async () => {
    await assertSucceeds(changeContribution(dbAs(env, LEADER_A), { retract: true, before: FIRST, after: FIRST }));
    await assertFails(changeContribution(dbAs(env, LEADER_A), { rev: 3, retract: false, before: FIRST, after: FIRST }));
  });
});
```

- [ ] **Step 2: Run to verify failures**

Run: `npm run test:rules`
Expected: FAIL — the three "can edit/retract" success tests fail (updates are denied).

- [ ] **Step 3: Replace the update line in the contributions match**

Replace `allow update, delete: if false;   // update is added in Task 4` with:

```
        allow update: if signedIn()
          && resource.data.authorEmail == request.auth.token.email
          && resource.data.retracted == false
          && validContribution(request.resource.data)
          && request.resource.data.authorEmail == resource.data.authorEmail
          && request.resource.data.createdAt == resource.data.createdAt
          && request.resource.data.rev == resource.data.rev + 1
          && request.resource.data.updatedAt == request.time
          && (!request.resource.data.retracted
              || (request.resource.data.note == resource.data.note
                  && request.resource.data.ratings == resource.data.ratings))
          && existsAfter(activityPath(evalId, cid + '_' + string(request.resource.data.rev)))
          && getAfter(activityPath(evalId, cid + '_' + string(request.resource.data.rev))).data.type
               == (request.resource.data.retracted ? 'retracted' : 'edited');
        allow delete: if false;
```

- [ ] **Step 4: Run to verify passes**

Run: `npm run test:rules`
Expected: all edit/retract tests PASS.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules tests/rules.contributions.test.mjs
git commit -m "Add contribution edit and retract rules"
```

---

### Task 5: Admin-only activity reads, forgery guards, index

**Files:**
- Modify: `firestore.rules`, `firebase.json`
- Create: `firestore.indexes.json`, `tests/rules.activity.test.mjs`

- [ ] **Step 1: Write failing tests**

`tests/rules.activity.test.mjs`:

```js
import { describe, it, before, after, beforeEach } from 'node:test';
import { doc, getDoc, getDocs, collectionGroup, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import {
  createEnv, dbAs, seedEvaluation, seedContribution, addedLog, assertSucceeds, assertFails,
  ADMIN, LEADER_A, LEADER_B,
} from './helpers.mjs';

let env;
before(async () => { env = await createEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seedEvaluation(env);
  await seedContribution(env, { by: LEADER_A, note: 'first' });
});

const actRef = (db, id) => doc(db, 'evaluations', 'e1', 'activity', id);

describe('activity: read', () => {
  it('a non-admin leader cannot read an entry', async () => {
    await assertFails(getDoc(actRef(dbAs(env, LEADER_A), 'submitted')));
  });
  it('a non-admin leader cannot run the collection-group query', async () => {
    await assertFails(getDocs(collectionGroup(dbAs(env, LEADER_A), 'activity')));
  });
  it('an admin can read an entry', async () => {
    await assertSucceeds(getDoc(actRef(dbAs(env, ADMIN), 'c1_1')));
  });
  it('an admin can run the collection-group query', async () => {
    await assertSucceeds(getDocs(collectionGroup(dbAs(env, ADMIN), 'activity')));
  });
});

describe('activity: immutable', () => {
  it('nobody can update an entry', async () => {
    await assertFails(updateDoc(actRef(dbAs(env, ADMIN), 'submitted'), { byName: 'x' }));
  });
  it('nobody can delete an entry', async () => {
    await assertFails(deleteDoc(actRef(dbAs(env, ADMIN), 'submitted')));
  });
  it('nobody can delete a contribution', async () => {
    await assertFails(deleteDoc(doc(dbAs(env, LEADER_A), 'evaluations', 'e1', 'contributions', 'c1')));
  });
});

describe('activity: forgery', () => {
  // Review Focus 4a: a lone entry pointing at a contribution that does not exist
  it('rejects a standalone "added" entry for a contribution that is not in the batch', async () => {
    const db = dbAs(env, LEADER_B);
    await assertFails(setDoc(actRef(db, 'ghost_1'), addedLog({ cid: 'ghost', by: LEADER_B })));
  });
  // Review Focus 4b: re-logging an existing revision
  it('rejects a standalone entry that re-logs an existing contribution revision', async () => {
    const db = dbAs(env, LEADER_A);
    await assertFails(setDoc(actRef(db, 'c1_1'), addedLog({ cid: 'c1', by: LEADER_A, note: 'first' })));
  });
  it('rejects an entry whose id does not match contributionId and rev', async () => {
    const db = dbAs(env, LEADER_B);
    const b = writeBatch(db);
    b.set(doc(db, 'evaluations', 'e1', 'contributions', 'c9'), {
      authorEmail: LEADER_B, authorName: LEADER_B, note: 'hi', ratings: null,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), rev: 1, retracted: false,
    });
    b.set(actRef(db, 'wrong-id'), addedLog({ cid: 'c9', by: LEADER_B, note: 'hi' }));
    await assertFails(b.commit());
  });
  it('rejects a forged byEmail', async () => {
    const db = dbAs(env, LEADER_B);
    const b = writeBatch(db);
    b.set(doc(db, 'evaluations', 'e1', 'contributions', 'c9'), {
      authorEmail: LEADER_B, authorName: LEADER_B, note: 'hi', ratings: null,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), rev: 1, retracted: false,
    });
    b.set(actRef(db, 'c9_1'), addedLog({ cid: 'c9', by: LEADER_B, note: 'hi', over: { byEmail: LEADER_A } }));
    await assertFails(b.commit());
  });
});
```

- [ ] **Step 2: Run to verify behaviour**

Run: `npm run test:rules`
Expected: FAIL — "an admin can read an entry" and "an admin can run the collection-group query" fail (no read rule yet). The other cases should already pass; if a forgery test unexpectedly passes the rules, fix the rule in Step 3 before continuing.

- [ ] **Step 3: Add the admin read rules**

Inside `match /evaluations/{evalId}` → `match /activity/{activityId}`, add `allow read: if isAdmin();` above the `create` rule. Then, at the same level as `match /evaluations/{evalId}` (directly under `match /databases/{database}/documents`), add:

```
    // Admin-only collection-group read for the global Activity feed
    match /{path=**}/activity/{activityId} {
      allow read: if isAdmin();
    }
```

- [ ] **Step 4: Create `firestore.indexes.json`**

```json
{
  "indexes": [],
  "fieldOverrides": [
    {
      "collectionGroup": "activity",
      "fieldPath": "at",
      "indexes": [
        { "order": "ASCENDING", "queryScope": "COLLECTION" },
        { "order": "DESCENDING", "queryScope": "COLLECTION" },
        { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" },
        { "order": "DESCENDING", "queryScope": "COLLECTION_GROUP" }
      ]
    }
  ]
}
```

- [ ] **Step 5: Reference the indexes file in `firebase.json`**

Change the `firestore` block to:

```json
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
```

- [ ] **Step 6: Run the full rules suite**

Run: `npm run test:rules`
Expected: every test across the three files PASSES, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add firestore.rules firestore.indexes.json firebase.json tests/rules.activity.test.mjs
git commit -m "Add admin-only activity reads, forgery tests and collection-group index"
```

**Part 1 done when:** `npm run test:rules` is green and all five commits exist. Do **not** deploy yet — the old page cannot submit under these rules. Deploy happens in Part 2, Task 6.
