import { describe, it, before, after, beforeEach } from 'node:test';
import {
  doc, getDoc, getDocs, updateDoc, deleteDoc, deleteField, collection, query, where, orderBy,
} from 'firebase/firestore';
import {
  createEnv, dbAs, anonDb, seedEvaluation, seedTeam, submitEvaluation, assertSucceeds, assertFails,
  ADMIN, LEADER_A, LEADER_B, LEADER_C, TEAM,
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
  it('a leader on the team can read', async () => {
    await seedEvaluation(env);
    await assertSucceeds(getDoc(doc(dbAs(env, LEADER_B), 'evaluations', 'e1')));
  });
  it('a leader on another team cannot read', async () => {
    await seedEvaluation(env);
    await seedTeam(env, { id: 't2', members: [LEADER_C] });
    await assertFails(getDoc(doc(dbAs(env, LEADER_C), 'evaluations', 'e1')));
  });
  it('a leader on no team cannot read', async () => {
    await seedEvaluation(env);
    await assertFails(getDoc(doc(dbAs(env, LEADER_C), 'evaluations', 'e1')));
  });
  it('team membership ignores email case', async () => {
    await seedEvaluation(env);
    await assertSucceeds(getDoc(doc(dbAs(env, 'B@Pechanga.com'), 'evaluations', 'e1')));
  });
  it('an admin can read any evaluation', async () => {
    await seedEvaluation(env);
    await assertSucceeds(getDoc(doc(dbAs(env, ADMIN), 'evaluations', 'e1')));
  });
  it('the directors are admins and can read any evaluation', async () => {
    await seedEvaluation(env);
    await assertSucceeds(getDoc(doc(dbAs(env, 'apena@pechanga.com'), 'evaluations', 'e1')));
    await assertSucceeds(getDoc(doc(dbAs(env, 'wallen@pechanga.com'), 'evaluations', 'e1')));
  });
  it('an evaluation with no team is admin-only', async () => {
    await seedEvaluation(env, { evalOver: { teamId: undefined } });
    await assertFails(getDoc(doc(dbAs(env, LEADER_A), 'evaluations', 'e1')));
    await assertSucceeds(getDoc(doc(dbAs(env, ADMIN), 'evaluations', 'e1')));
  });
  it('an evaluation whose team was deleted is admin-only', async () => {
    await seedEvaluation(env, { team: false });
    await assertFails(getDoc(doc(dbAs(env, LEADER_A), 'evaluations', 'e1')));
  });
  it('removing a leader from the team removes their access', async () => {
    await seedEvaluation(env);
    await seedTeam(env, { members: [LEADER_A] });
    await assertFails(getDoc(doc(dbAs(env, LEADER_B), 'evaluations', 'e1')));
  });
});

describe('evaluations: list queries', () => {
  const byTeam = (db, teamId) => getDocs(query(collection(db, 'evaluations'),
    where('teamId', '==', teamId), orderBy('submittedAt', 'desc')));
  it('a member can list their team\'s evaluations', async () => {
    await seedEvaluation(env);
    await assertSucceeds(byTeam(dbAs(env, LEADER_A), TEAM));
  });
  it('a non-member cannot list another team\'s evaluations', async () => {
    await seedEvaluation(env);
    await assertFails(byTeam(dbAs(env, LEADER_C), TEAM));
  });
  it('a leader cannot list every evaluation', async () => {
    await seedEvaluation(env);
    await assertFails(getDocs(collection(dbAs(env, LEADER_A), 'evaluations')));
  });
  it('an admin can list every evaluation', async () => {
    await seedEvaluation(env);
    await assertSucceeds(getDocs(query(collection(dbAs(env, ADMIN), 'evaluations'), orderBy('submittedAt', 'desc'))));
  });
});

describe('evaluations: create', () => {
  beforeEach(async () => { await seedTeam(env); });
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
  it('a leader cannot file it under a team they are not on', async () => {
    await seedTeam(env, { id: 't2', members: [LEADER_C] });
    await assertFails(submitEvaluation(dbAs(env, LEADER_A), { evalOver: { teamId: 't2' } }));
  });
  it('a leader cannot file it with no team', async () => {
    await assertFails(submitEvaluation(dbAs(env, LEADER_A), { evalOver: { teamId: undefined } }));
  });
  it('a leader cannot file it under a team that does not exist', async () => {
    await assertFails(submitEvaluation(dbAs(env, LEADER_A), { evalOver: { teamId: 'nope' } }));
  });
  it('an admin can file it under any team, even one they are not on', async () => {
    await assertSucceeds(submitEvaluation(dbAs(env, ADMIN), { by: ADMIN }));
  });
  it('an admin can file it with no team', async () => {
    await assertSucceeds(submitEvaluation(dbAs(env, ADMIN), { by: ADMIN, evalOver: { teamId: undefined } }));
  });
  it('an admin cannot file it under a team that does not exist', async () => {
    await assertFails(submitEvaluation(dbAs(env, ADMIN), { by: ADMIN, evalOver: { teamId: 'nope' } }));
  });
});

describe('evaluations: immutable except team assignment', () => {
  it('nobody can change the evaluation itself, even an admin', async () => {
    await seedEvaluation(env);
    await assertFails(updateDoc(doc(dbAs(env, ADMIN), 'evaluations', 'e1'), { tmName: 'X' }));
  });
  it('an admin cannot change the team and something else together', async () => {
    await seedEvaluation(env);
    await seedTeam(env, { id: 't2', members: [LEADER_C] });
    await assertFails(updateDoc(doc(dbAs(env, ADMIN), 'evaluations', 'e1'), { teamId: 't2', tmName: 'X' }));
  });
  it('nobody can delete an evaluation, even an admin', async () => {
    await seedEvaluation(env);
    await assertFails(deleteDoc(doc(dbAs(env, ADMIN), 'evaluations', 'e1')));
  });
  it('an admin can move it to another team', async () => {
    await seedEvaluation(env);
    await seedTeam(env, { id: 't2', members: [LEADER_C] });
    await assertSucceeds(updateDoc(doc(dbAs(env, ADMIN), 'evaluations', 'e1'), { teamId: 't2' }));
    await assertSucceeds(getDoc(doc(dbAs(env, LEADER_C), 'evaluations', 'e1')));
    await assertFails(getDoc(doc(dbAs(env, LEADER_A), 'evaluations', 'e1')));
  });
  it('an admin can assign an evaluation that had no team', async () => {
    await seedEvaluation(env, { evalOver: { teamId: undefined } });
    await assertSucceeds(updateDoc(doc(dbAs(env, ADMIN), 'evaluations', 'e1'), { teamId: TEAM }));
  });
  it('an admin can take it off its team', async () => {
    await seedEvaluation(env);
    await assertSucceeds(updateDoc(doc(dbAs(env, ADMIN), 'evaluations', 'e1'), { teamId: deleteField() }));
  });
  it('an admin cannot move it to a team that does not exist', async () => {
    await seedEvaluation(env);
    await assertFails(updateDoc(doc(dbAs(env, ADMIN), 'evaluations', 'e1'), { teamId: 'nope' }));
  });
  it('a team member cannot move it to another team', async () => {
    await seedEvaluation(env);
    await seedTeam(env, { id: 't2', members: [LEADER_A] });
    await assertFails(updateDoc(doc(dbAs(env, LEADER_A), 'evaluations', 'e1'), { teamId: 't2' }));
  });
});
