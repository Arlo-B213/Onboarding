import { describe, it, before, after, beforeEach } from 'node:test';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, writeBatch, serverTimestamp } from 'firebase/firestore';
import {
  createEnv, dbAs, seedEvaluation, seedContribution, assertSucceeds, assertFails,
  ADMIN, LEADER_A,
} from './helpers.mjs';

let env;
before(async () => { env = await createEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const record = (by = ADMIN, over = {}) => ({
  tmName: 'Pat', period: 30, outlet: 'Great Oak', teamId: 't1', submittedBy: LEADER_A,
  byEmail: by, byName: 'Admin', at: serverTimestamp(), ...over,
});

// What the page does: delete notes, log entries and the evaluation, and write the record, in one batch
function deleteEvaluation(db, { by = ADMIN, id = 'e1', withRecord = true, recordOver = {}, children = [] } = {}) {
  const b = writeBatch(db);
  children.forEach(p => b.delete(doc(db, ...p)));
  b.delete(doc(db, 'evaluations', id));
  if (withRecord) b.set(doc(db, 'deletions', id), record(by, recordOver));
  return b.commit();
}

describe('deleting an evaluation', () => {
  it('an admin can delete it with its notes and log, leaving a deletion record', async () => {
    await seedEvaluation(env);
    await seedContribution(env);
    const db = dbAs(env, ADMIN);
    await assertSucceeds(deleteEvaluation(db, { children: [
      ['evaluations', 'e1', 'contributions', 'c1'],
      ['evaluations', 'e1', 'activity', 'c1_1'],
      ['evaluations', 'e1', 'activity', 'submitted'],
    ] }));
    await assertSucceeds(getDoc(doc(db, 'deletions', 'e1')));
  });
  it('fails without the deletion record', async () => {
    await seedEvaluation(env);
    await assertFails(deleteEvaluation(dbAs(env, ADMIN), { withRecord: false }));
  });
  it('fails when the record names someone else as the deleter', async () => {
    await seedEvaluation(env);
    await assertFails(deleteEvaluation(dbAs(env, ADMIN), { recordOver: { byEmail: 'abedolla@pechanga.com' } }));
  });
  it('fails when the record names a different team member', async () => {
    await seedEvaluation(env);
    await assertFails(deleteEvaluation(dbAs(env, ADMIN), { recordOver: { tmName: 'Someone else' } }));
  });
  it('a leader on the team cannot delete it', async () => {
    await seedEvaluation(env);
    await assertFails(deleteEvaluation(dbAs(env, LEADER_A), { by: LEADER_A }));
  });
  it('a leader cannot delete notes or log entries', async () => {
    await seedEvaluation(env);
    await seedContribution(env);
    await assertFails(deleteDoc(doc(dbAs(env, LEADER_A), 'evaluations', 'e1', 'contributions', 'c1')));
    await assertFails(deleteDoc(doc(dbAs(env, LEADER_A), 'evaluations', 'e1', 'activity', 'submitted')));
  });
});

describe('deletion records', () => {
  it('only admins can read them', async () => {
    await seedEvaluation(env);
    await deleteEvaluation(dbAs(env, ADMIN));
    await assertSucceeds(getDocs(collection(dbAs(env, ADMIN), 'deletions')));
    await assertFails(getDocs(collection(dbAs(env, LEADER_A), 'deletions')));
  });
  it('cannot be written for an evaluation that does not exist', async () => {
    await assertFails(setDoc(doc(dbAs(env, ADMIN), 'deletions', 'nope'), record()));
  });
  it('cannot be changed or removed afterwards', async () => {
    await seedEvaluation(env);
    await deleteEvaluation(dbAs(env, ADMIN));
    await assertFails(updateDoc(doc(dbAs(env, ADMIN), 'deletions', 'e1'), { tmName: 'X' }));
    await assertFails(deleteDoc(doc(dbAs(env, ADMIN), 'deletions', 'e1')));
  });
});
