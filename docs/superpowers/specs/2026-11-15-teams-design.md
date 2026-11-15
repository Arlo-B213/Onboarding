# Teams — Design

Date: 2026-11-15
Status: Implemented on branch `teams`

## Goal

Only certain leaders should see a team member's evaluation and share feedback on it.
Admins group leaders into teams; each evaluation belongs to one team.

## Decisions

| Question | Decision |
|---|---|
| What is a team | A named group of leader emails, created by an admin. Each evaluation has one `teamId`. |
| Leaders not on the team | See nothing: not the evaluation, not its notes. |
| Who manages teams | Admins only (new **Teams** tab). |
| Evaluations saved before teams | Admin-only until an admin puts them on a team. |
| Admins | See and can add notes to every evaluation, team or not. |

## Data model

```
teams/{teamId}
  name          string, 1–80 chars
  memberEmails  list of lowercase emails (≤ 200)
  createdAt     timestamp (never changes)
  updatedAt     timestamp (server time of last change)

evaluations/{evalId}
  teamId        string (new, optional) — missing, or pointing at a deleted team = admin-only
```

## Rules (`firestore.rules`)

- `teams`: admins read/write/delete; a leader can read a team they are on (so the page can
  list "my teams" with `array-contains`).
- `evaluations` read: admin, or a member of `teamId`'s team (email compared lowercase).
- `evaluations` create: a leader must use a team they are on; an admin may use any existing
  team or none.
- `evaluations` update: still immutable, except an admin may change or remove `teamId` alone.
- `contributions` read / create / update: the same team check as the parent evaluation, on top
  of the existing author and activity-log rules. Taking a leader off a team removes their
  access, including editing their own earlier notes.
- `activity`: unchanged (admin-read only).

## Client

- Leaders load their teams, then one query per team
  (`where teamId == X orderBy submittedAt desc`), merged newest first. Rules reject any
  wider query. Needs the composite index in `firestore.indexes.json`.
- New Evaluation has a required **Team** picker (auto-selected when the leader is on one team).
  A leader on no team can fill the form but not submit it.
- The evaluations list gets a Team column and filter; for leaders the tab is "Team Evaluations".
- In the evaluation detail, admins can move it to another team or to "No team".
- Admin **Teams** tab: create, rename, delete teams; add/remove leader emails; put all
  unassigned evaluations (of the latest 200 loaded) on one team.

Pure helpers are in `teams-core.js` (unit-tested in `tests/teams-core.test.mjs`);
DOM/Firestore code in `teams-ui.js`. Rules tests: `tests/rules.teams.test.mjs` plus team cases
in the evaluations and contributions suites.

## Rollout

1. Deploy rules, indexes and hosting together:
   `firebase deploy --only hosting,firestore`. Wait for the new index to finish building.
2. Sign in as an admin, open **Teams**, create the teams and add leader emails.
3. Use "Put all … on this team" (or each evaluation's Team picker) for older evaluations.

Until step 2, regular leaders see no evaluations and cannot submit; schedule the deploy for a
quiet moment, or create the teams right after deploying.
