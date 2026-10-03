# Leader Contributions & Activity Log — Design

Date: 2026-10-03
Status: Draft for review

## Goal

Let several leaders work together on one PRIDE evaluation. After the first
leader submits an evaluation, other leaders can add their own input to it.
Admins can see a log of everything that was added or changed, and by whom.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Collaboration workflow | Submit first, then other leaders add input |
| What leaders can do after submit | Add input; edit or retract **their own** input. The original submission is never editable. |
| Who can see/add to evaluations | Every signed-in leader sees all evaluations |
| Emails | First submission emails the admin as today. Later input sends **no** email. |
| Infrastructure | Firebase free (Spark) plan. No Cloud Functions. |

## Non-goals

- Editing the original submission after it is saved.
- Hard-deleting anything (retract only).
- Per-outlet or per-leader visibility restrictions.
- Emails or digests for added input.
- @mentions, notifications, real-time co-editing.
- Backfilling log entries for evaluations submitted before this feature.

## Data model

```
evaluations/{evalId}                      (unchanged shape, still immutable)
  └─ contributions/{cid}                  leader input
  └─ activity/{activityId}                append-only log (admin-read-only)
```

### `contributions/{cid}`

| Field | Type | Notes |
|---|---|---|
| `authorEmail` | string | `request.auth.token.email`; never changes |
| `authorName` | string | `displayName` or email, as `submittedByName` today |
| `note` | string | 0–5000 chars. Required unless `ratings` is set. |
| `ratings` | map or null | Optional `{Pride, Passion, Professionalism}`, each 1–3 or null |
| `createdAt` | timestamp | server time, never changes |
| `updatedAt` | timestamp | server time of last change |
| `rev` | int | starts at 1; +1 on every edit or retract |
| `retracted` | bool | starts false; once true, no further edits |

### `activity/{activityId}`

| Field | Type | Notes |
|---|---|---|
| `type` | string | `submitted`, `added`, `edited`, `retracted` |
| `contributionId` | string or null | null for `submitted` |
| `rev` | int or null | contribution revision this entry records; null for `submitted` |
| `byEmail`, `byName` | string | actor |
| `at` | timestamp | server time |
| `before` | map or null | `{note, ratings}` prior to the change (null for `added`/`submitted`) |
| `after` | map or null | `{note, ratings}` after the change (null for `submitted`) |

Document IDs: `submitted` for the original submission, otherwise
`{contributionId}_{rev}`. The deterministic ID is what lets the rules tie each
log entry to exactly one contribution change.

## Security rules

All rules live in `firestore.rules`. Admin = the existing `isAdmin()` email list.

**`evaluations/{evalId}`**
- `read`: any signed-in user (was admin-only).
- `create`: signed-in, `submittedBy == token.email`, `submittedAt == request.time`,
  and `activity/submitted` exists in the same batch (`getAfter`).
- `update`, `delete`: never.

**`evaluations/{evalId}/contributions/{cid}`**
- `read`: any signed-in user.
- `create`: `authorEmail == token.email`, `rev == 1`, `retracted == false`,
  `createdAt == updatedAt == request.time`, field limits above, and
  `activity/{cid}_1` exists after the batch with `type == 'added'`.
- `update`: only if `resource.data.authorEmail == token.email`,
  `resource.data.retracted == false`, `authorEmail` and `createdAt` unchanged,
  `rev == resource.rev + 1`, `updatedAt == request.time`, and
  `activity/{cid}_{newRev}` exists after the batch with type `edited` or
  `retracted` (`retracted` iff the flag flips to true).
- `delete`: never.

**`evaluations/{evalId}/activity/{activityId}`**
- `read`: admin only.
- `create`: `byEmail == token.email`, `at == request.time`, `type` in the allowed
  set, and
  - `submitted`: id is `submitted` and the parent evaluation exists after the batch with
    `submittedBy == byEmail`;
  - other types: id is `{contributionId}_{rev}`, the contribution exists after the
    batch with that `rev`, `after` matches the contribution's post-state
    (`getAfter`), and `before` matches its pre-state (`get`).
- `update`, `delete`: never.

**Collection-group read.** A `match /{path=**}/activity/{id}` rule gives admins
read access for the global Activity feed. `firestore.indexes.json` adds the
collection-group index on `activity.at` (descending).

**Default:** everything else stays denied.

The rules cannot hide individual fields, so retracted note text remains
readable to any signed-in leader. The UI shows retracted entries struck through
and without their text; the admin log keeps the full before/after.

## Client changes (`index.html`)

### Submitting an evaluation
Generate the ID first (`db.collection('evaluations').doc()`), then write the
evaluation and its `activity/submitted` entry in one `WriteBatch`. The
EmailJS notification is unchanged.

### Visibility
- The "All Evaluations" tab and list are shown to every signed-in leader
  (today only admins). `loadEvals()` runs for everyone.
- The ADMIN badge and the new **Activity** tab stay admin-only (UI gating only;
  the rules are what actually enforce it).

### Evaluation detail modal
Below the original evaluation:
- **Leader input** list, oldest first: author, time, note, ratings, and an
  "edited" badge when `rev > 1`. Retracted entries show "Retracted by {name}" in
  place of the text.
- **Add my input** form: note textarea plus optional Pride/Passion/Professionalism
  ratings (reuse the existing rating control).
- On entries authored by the current user: **Edit** (inline) and **Retract**
  (confirm dialog).
- Contributions are fetched when the modal opens and re-fetched after each write.

### Writes
Add, edit and retract each use a `WriteBatch` containing the contribution write
and its activity entry (`before`/`after` snapshots filled in by the client).
If a batch fails with a permission error caused by a stale `rev` (same user
editing in two tabs), show "This entry changed elsewhere — reloaded" and
re-fetch.

### Admin Activity view
New admin-only tab: a reverse-chronological feed from
`collectionGroup('activity')`, limit 200. Each row shows time, actor, action,
the team member and period of the parent evaluation, and for edits a
before → after comparison of note and ratings. Rows link to the evaluation
modal. Evaluations submitted before this feature have no `submitted` entry,
so the feed only starts from the first logged action.

### Unchanged
Draft autosave, validation, and EmailJS behaviour on submission.

## Error handling

- Permission denied on any write: show the message inline in the modal, keep
  the user's typed text.
- Offline or network failure: same inline error; nothing is partially written
  because each change is a single batch.
- Note over 5000 chars or empty with no ratings: blocked client-side before the write.

## Testing

Add a Firestore rules test suite using the emulator and
`@firebase/rules-unit-testing`:

- `package.json` (dev dependencies, `npm test`), `tests/firestore.rules.test.js`,
  and an emulator entry in `firebase.json`. The emulator needs Java installed locally.
- Cases: signed-out denied everywhere; non-admin cannot read `activity`; admin can;
  evaluation create fails without the `submitted` log entry; contribution create
  fails without its log entry; only the author can edit or retract; no edit after
  retract; `rev` must increase by exactly 1; `before`/`after` mismatch rejected;
  no deletes anywhere; forged `byEmail` rejected.
- Manual checklist for the UI: two leaders on one evaluation, edit and retract,
  admin sees the feed with before/after.

## Rollout and risks

- Deploy rules, indexes and hosting together
  (`firebase deploy --only hosting,firestore`). A browser still running the old
  page will fail to submit until refreshed, because the new rule requires the log
  entry.
- Reads are now open to every signed-in user, so **email/password sign-up must be
  disabled** in the Firebase Console (Authentication) before deploying.
- Admin emails are duplicated between the rules and `ADMIN_EMAILS` in the page;
  keep them in sync.
- The activity log is client-written but rules-enforced: every contribution change
  must come with a log entry whose before/after match the real change, and every
  log entry must correspond to a real change. This stops forged or skipped entries
  from ordinary clients. It is not equivalent to server-written logging, which
  would need Cloud Functions (Blaze plan) and is out of scope.
