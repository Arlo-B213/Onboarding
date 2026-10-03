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
