import { describe, it, before, after, beforeEach } from 'node:test';
import { doc, getDoc, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import {
  createEnv, dbAs, seedEvaluation, seedTeam, assertSucceeds, assertFails,
  ADMIN, LEADER_A, LEADER_B, LEADER_C,
} from './helpers.mjs';

let env;
before(async () => { env = await createEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

// The seeded evaluation (evalDoc): tmName Pat, outlet Great Oak, period 30, nothing else set
const BEFORE = { tmName: 'Pat', position: '', outlet: 'Great Oak', area: '', startDate: '', evalDate: '', period: 30 };

// What the page does: update the details and write the matching log entry, in one batch
function editDetails(db, { by = LEADER_A, rev = 1, changes = { tmName: 'Patricia' }, before = BEFORE,
  logAfter = null, logOver = {}, evalOver = {}, withLog = true } = {}) {
  const after = { ...before, ...changes };
  const b = writeBatch(db);
  b.update(doc(db, 'evaluations', 'e1'), {
    ...changes, detailsRev: rev, editedAt: serverTimestamp(), editedBy: by, ...evalOver,
  });
  if (withLog) {
    b.set(doc(db, 'evaluations', 'e1', 'activity', `details_${rev}`), {
      type: 'details', contributionId: null, rev, byEmail: by, byName: by, at: serverTimestamp(),
      before, after: logAfter || after, ...logOver,
    });
  }
  return b.commit();
}

describe('editing evaluation details', () => {
  beforeEach(async () => { await seedEvaluation(env); }); // submitted by LEADER_A, team A + B

  it('the submitter can correct the name', async () => {
    await assertSucceeds(editDetails(dbAs(env, LEADER_A)));
    const snap = await getDoc(doc(dbAs(env, LEADER_A), 'evaluations', 'e1'));
    if (snap.data().tmName !== 'Patricia') throw new Error('name not changed');
  });
  it('an admin can correct any evaluation', async () => {
    await assertSucceeds(editDetails(dbAs(env, ADMIN), { by: ADMIN, changes: { outlet: 'Agave', period: 14 } }));
  });
  it('another leader on the team cannot', async () => {
    await assertFails(editDetails(dbAs(env, LEADER_B), { by: LEADER_B }));
  });
  it('the submitter cannot after being taken off the team', async () => {
    await seedTeam(env, { members: [LEADER_B] });
    await assertFails(editDetails(dbAs(env, LEADER_A)));
  });
  it('a leader off the team cannot', async () => {
    await assertFails(editDetails(dbAs(env, LEADER_C), { by: LEADER_C }));
  });
  it('fails without the log entry', async () => {
    await assertFails(editDetails(dbAs(env, LEADER_A), { withLog: false }));
  });
  it('fails when the log does not match the change', async () => {
    await assertFails(editDetails(dbAs(env, LEADER_A), { logAfter: { ...BEFORE, tmName: 'Someone else' } }));
  });
  it('fails when the log misstates the old values', async () => {
    await assertFails(editDetails(dbAs(env, LEADER_A), { before: { ...BEFORE, tmName: 'Not Pat' } }));
  });
  it('fails when the revision is skipped', async () => {
    await assertFails(editDetails(dbAs(env, LEADER_A), { rev: 2 }));
  });
  it('a second edit uses the next revision', async () => {
    await assertSucceeds(editDetails(dbAs(env, LEADER_A)));
    await assertSucceeds(editDetails(dbAs(env, LEADER_A), {
      rev: 2, before: { ...BEFORE, tmName: 'Patricia' }, changes: { tmName: 'Patricia Diaz' } }));
  });
  it('cannot change ratings or signatures', async () => {
    await assertFails(editDetails(dbAs(env, LEADER_A), { evalOver: { competencies: { Pride: 3 } } }));
    await assertFails(editDetails(dbAs(env, LEADER_A), { evalOver: { trainerSig: 'x' } }));
  });
  it('cannot change who submitted it or the team', async () => {
    await assertFails(editDetails(dbAs(env, LEADER_A), { evalOver: { submittedBy: LEADER_B } }));
    await assertFails(editDetails(dbAs(env, ADMIN), { by: ADMIN, evalOver: { teamId: 't2' } }));
  });
  it('rejects an empty name or a period that does not exist', async () => {
    await assertFails(editDetails(dbAs(env, LEADER_A), { changes: { tmName: '' } }));
    await assertFails(editDetails(dbAs(env, LEADER_A), { changes: { period: 90 } }));
  });
  it('cannot claim someone else made the edit', async () => {
    await assertFails(editDetails(dbAs(env, LEADER_A), { evalOver: { editedBy: ADMIN } }));
  });
  it('a plain update without the edit bookkeeping is refused', async () => {
    await assertFails(updateDoc(doc(dbAs(env, LEADER_A), 'evaluations', 'e1'), { tmName: 'X' }));
  });
});
