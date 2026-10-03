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
