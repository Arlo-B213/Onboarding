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
