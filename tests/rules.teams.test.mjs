import { describe, it, before, after, beforeEach } from 'node:test';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where,
  arrayUnion, arrayRemove, serverTimestamp,
} from 'firebase/firestore';
import {
  createEnv, dbAs, anonDb, seedTeam, teamDoc, assertSucceeds, assertFails,
  ADMIN, LEADER_A, LEADER_C, TEAM,
} from './helpers.mjs';

let env;
before(async () => { env = await createEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const teamRef = (db, id = TEAM) => doc(db, 'teams', id);
const myTeams = (db, email) => getDocs(query(collection(db, 'teams'), where('memberEmails', 'array-contains', email)));

describe('teams: read', () => {
  beforeEach(async () => { await seedTeam(env); });
  it('a member can read their team', async () => {
    await assertSucceeds(getDoc(teamRef(dbAs(env, LEADER_A))));
  });
  it('a non-member cannot read it', async () => {
    await assertFails(getDoc(teamRef(dbAs(env, LEADER_C))));
  });
  it('signed-out users cannot read it', async () => {
    await assertFails(getDoc(teamRef(anonDb(env))));
  });
  it('a leader can list the teams they are on', async () => {
    await assertSucceeds(myTeams(dbAs(env, LEADER_A), LEADER_A));
  });
  it('a leader cannot list teams by someone else\'s email', async () => {
    await assertFails(myTeams(dbAs(env, LEADER_C), LEADER_A));
  });
  it('a leader cannot list every team', async () => {
    await assertFails(getDocs(collection(dbAs(env, LEADER_A), 'teams')));
  });
  it('an admin can list every team', async () => {
    await assertSucceeds(getDocs(collection(dbAs(env, ADMIN), 'teams')));
  });
});

describe('teams: write', () => {
  it('an admin can create a team', async () => {
    await assertSucceeds(setDoc(teamRef(dbAs(env, ADMIN), 't9'), teamDoc([LEADER_A])));
  });
  it('a leader cannot create a team', async () => {
    await assertFails(setDoc(teamRef(dbAs(env, LEADER_A), 't9'), teamDoc([LEADER_A])));
  });
  it('rejects a team with no name', async () => {
    await assertFails(setDoc(teamRef(dbAs(env, ADMIN), 't9'), teamDoc([], { name: '' })));
  });
  it('rejects a team with an extra field', async () => {
    await assertFails(setDoc(teamRef(dbAs(env, ADMIN), 't9'), teamDoc([], { lead: LEADER_A })));
  });
  it('rejects members that are not a list', async () => {
    await assertFails(setDoc(teamRef(dbAs(env, ADMIN), 't9'), teamDoc([], { memberEmails: LEADER_A })));
  });
  it('an admin can add and remove members', async () => {
    await seedTeam(env);
    const db = dbAs(env, ADMIN);
    await assertSucceeds(updateDoc(teamRef(db), { memberEmails: arrayUnion(LEADER_C), updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(teamRef(db), { memberEmails: arrayRemove(LEADER_A), updatedAt: serverTimestamp() }));
  });
  it('an admin can rename a team', async () => {
    await seedTeam(env);
    await assertSucceeds(updateDoc(teamRef(dbAs(env, ADMIN)), { name: 'Pronto Leads', updatedAt: serverTimestamp() }));
  });
  it('an update must refresh updatedAt', async () => {
    await seedTeam(env);
    await assertFails(updateDoc(teamRef(dbAs(env, ADMIN)), { name: 'Pronto Leads' }));
  });
  it('an update cannot change createdAt', async () => {
    await seedTeam(env);
    await assertFails(updateDoc(teamRef(dbAs(env, ADMIN)), { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  });
  it('a member cannot add someone to their team', async () => {
    await seedTeam(env);
    await assertFails(updateDoc(teamRef(dbAs(env, LEADER_A)), { memberEmails: arrayUnion(LEADER_C), updatedAt: serverTimestamp() }));
  });
  it('an admin can delete a team; a member cannot', async () => {
    await seedTeam(env);
    await assertFails(deleteDoc(teamRef(dbAs(env, LEADER_A))));
    await assertSucceeds(deleteDoc(teamRef(dbAs(env, ADMIN))));
  });
});
