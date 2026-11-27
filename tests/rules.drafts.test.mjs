import { describe, it, before, after, beforeEach } from 'node:test';
import { doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, collection, query, where, serverTimestamp, Timestamp } from 'firebase/firestore';
import { createEnv, dbAs, anonDb, assertSucceeds, assertFails, LEADER_A, LEADER_B } from './helpers.mjs';

let env;
before(async () => { env = await createEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const draftDoc = (ownerUid, over = {}) => ({
  ownerUid, tmName: 'Pat', period: '30', payload: '{"vals":{}}',
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...over,
});

// Seed a draft owned by `ownerUid`, bypassing rules
async function seedDraft(id, ownerUid) {
  await env.withSecurityRulesDisabled(ctx =>
    setDoc(doc(ctx.firestore(), 'drafts', id), { ...draftDoc(ownerUid), createdAt: Timestamp.now(), updatedAt: Timestamp.now() }));
}

describe('drafts: create', () => {
  it('owner can create a draft for themselves', async () => {
    await assertSucceeds(setDoc(doc(dbAs(env, LEADER_A), 'drafts', 'd1'), draftDoc('a')));
  });

  it('cannot create a draft owned by someone else', async () => {
    await assertFails(setDoc(doc(dbAs(env, LEADER_A), 'drafts', 'd1'), draftDoc('someone-else')));
  });

  it('signed-out users cannot create drafts', async () => {
    await assertFails(setDoc(doc(anonDb(env), 'drafts', 'd1'), draftDoc('a')));
  });

  it('rejects a draft with an extra field', async () => {
    await assertFails(setDoc(doc(dbAs(env, LEADER_A), 'drafts', 'd1'), draftDoc('a', { isAdmin: true })));
  });

  it('rejects a name longer than 200 characters', async () => {
    await assertFails(setDoc(doc(dbAs(env, LEADER_A), 'drafts', 'd1'), draftDoc('a', { tmName: 'x'.repeat(201) })));
  });

  it('rejects a payload over the size cap', async () => {
    await assertFails(setDoc(doc(dbAs(env, LEADER_A), 'drafts', 'd1'), draftDoc('a', { payload: 'x'.repeat(900001) })));
  });

  it('rejects a client-chosen createdAt', async () => {
    await assertFails(setDoc(doc(dbAs(env, LEADER_A), 'drafts', 'd1'),
      draftDoc('a', { createdAt: Timestamp.fromMillis(0) })));
  });
});

describe('drafts: read and list', () => {
  it('owner can read their draft', async () => {
    await seedDraft('d1', 'a');
    await assertSucceeds(getDoc(doc(dbAs(env, LEADER_A), 'drafts', 'd1')));
  });

  it('another leader cannot read the draft', async () => {
    await seedDraft('d1', 'a');
    await assertFails(getDoc(doc(dbAs(env, LEADER_B), 'drafts', 'd1')));
  });

  it('a list query scoped to the owner succeeds', async () => {
    await seedDraft('d1', 'a');
    await assertSucceeds(getDocs(query(collection(dbAs(env, LEADER_A), 'drafts'), where('ownerUid', '==', 'a'))));
  });

  it('an unscoped list of all drafts is refused', async () => {
    await seedDraft('d1', 'a');
    await assertFails(getDocs(collection(dbAs(env, LEADER_B), 'drafts')));
  });
});

describe('drafts: update', () => {
  it('owner can update their draft', async () => {
    await seedDraft('d1', 'a');
    await assertSucceeds(updateDoc(doc(dbAs(env, LEADER_A), 'drafts', 'd1'),
      { tmName: 'Sam', payload: '{"vals":{"f-tm-name":"Sam"}}', updatedAt: serverTimestamp() }));
  });

  it('another leader cannot update the draft', async () => {
    await seedDraft('d1', 'a');
    await assertFails(updateDoc(doc(dbAs(env, LEADER_B), 'drafts', 'd1'), { tmName: 'x', updatedAt: serverTimestamp() }));
  });

  it('cannot hand a draft to another owner', async () => {
    await seedDraft('d1', 'a');
    await assertFails(updateDoc(doc(dbAs(env, LEADER_A), 'drafts', 'd1'), { ownerUid: 'b', updatedAt: serverTimestamp() }));
  });

  it('cannot change createdAt', async () => {
    await seedDraft('d1', 'a');
    await assertFails(updateDoc(doc(dbAs(env, LEADER_A), 'drafts', 'd1'),
      { createdAt: Timestamp.fromMillis(0), updatedAt: serverTimestamp() }));
  });
});

describe('drafts: delete', () => {
  it('owner can delete their draft', async () => {
    await seedDraft('d1', 'a');
    await assertSucceeds(deleteDoc(doc(dbAs(env, LEADER_A), 'drafts', 'd1')));
  });

  it('another leader cannot delete the draft', async () => {
    await seedDraft('d1', 'a');
    await assertFails(deleteDoc(doc(dbAs(env, LEADER_B), 'drafts', 'd1')));
  });
});
