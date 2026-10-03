import { describe, it, before, after, beforeEach } from 'node:test';
import { doc, getDoc } from 'firebase/firestore';
import {
  createEnv, dbAs, anonDb, seedEvaluation, seedContribution, addContribution, changeContribution,
  assertSucceeds, assertFails, LEADER_A, LEADER_B,
} from './helpers.mjs';

let env;
before(async () => { env = await createEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); await seedEvaluation(env); });

describe('contributions: read', () => {
  it('any signed-in leader can read', async () => {
    await seedContribution(env);
    await assertSucceeds(getDoc(doc(dbAs(env, LEADER_B), 'evaluations', 'e1', 'contributions', 'c1')));
  });
  it('signed-out users cannot read', async () => {
    await seedContribution(env);
    await assertFails(getDoc(doc(anonDb(env), 'evaluations', 'e1', 'contributions', 'c1')));
  });
});

describe('contributions: create', () => {
  it('another leader can add input with its log entry', async () => {
    await assertSucceeds(addContribution(dbAs(env, LEADER_B), { by: LEADER_B }));
  });
  it('fails without the log entry', async () => {
    await assertFails(addContribution(dbAs(env, LEADER_B), { by: LEADER_B, withLog: false }));
  });
  it('fails when authorEmail is someone else', async () => {
    await assertFails(addContribution(dbAs(env, LEADER_B), { by: LEADER_A }));
  });
  it('fails when rev is not 1', async () => {
    await assertFails(addContribution(dbAs(env, LEADER_B), { by: LEADER_B, contribOver: { rev: 2 } }));
  });
  it('fails when created already retracted', async () => {
    await assertFails(addContribution(dbAs(env, LEADER_B), { by: LEADER_B, contribOver: { retracted: true } }));
  });
  it('fails with an unexpected extra field', async () => {
    await assertFails(addContribution(dbAs(env, LEADER_B), { by: LEADER_B, contribOver: { admin: true } }));
  });
  it('fails when the log "after" does not match the contribution', async () => {
    await assertFails(addContribution(dbAs(env, LEADER_B), {
      by: LEADER_B, logOver: { after: { note: 'something else', ratings: null } },
    }));
  });
  it('fails on an evaluation that does not exist', async () => {
    await assertFails(addContribution(dbAs(env, LEADER_B), { by: LEADER_B, evalId: 'nope' }));
  });
  it('fails when signed out', async () => {
    await assertFails(addContribution(anonDb(env)));
  });

  // Review Focus 1: legacy evaluation (no submitted log entry)
  it('works on an evaluation submitted before logging existed', async () => {
    await env.clearFirestore();
    await seedEvaluation(env, { withLog: false });
    await assertSucceeds(addContribution(dbAs(env, LEADER_B), { by: LEADER_B }));
  });

  // Review Focus 5: ratings-only vs empty
  it('allows ratings with an empty note', async () => {
    const ratings = { Pride: 3, Passion: null, Professionalism: null };
    await assertSucceeds(addContribution(dbAs(env, LEADER_B), { by: LEADER_B, note: '', ratings }));
  });
  it('rejects an empty note with no ratings', async () => {
    await assertFails(addContribution(dbAs(env, LEADER_B), { by: LEADER_B, note: '', ratings: null }));
  });
  it('rejects an empty note when every rating is null', async () => {
    const ratings = { Pride: null, Passion: null, Professionalism: null };
    await assertFails(addContribution(dbAs(env, LEADER_B), { by: LEADER_B, note: '', ratings }));
  });

  it('accepts a 5000-character note and rejects 5001', async () => {
    await assertSucceeds(addContribution(dbAs(env, LEADER_B), { by: LEADER_B, cid: 'ok', note: 'x'.repeat(5000) }));
    await assertFails(addContribution(dbAs(env, LEADER_B), { by: LEADER_B, cid: 'big', note: 'x'.repeat(5001) }));
  });
  it('rejects a rating outside 1-3', async () => {
    const ratings = { Pride: 4, Passion: null, Professionalism: null };
    await assertFails(addContribution(dbAs(env, LEADER_B), { by: LEADER_B, ratings }));
  });
  it('rejects an unknown rating key', async () => {
    const ratings = { Pride: 3, Passion: null, Professionalism: null, Bonus: 1 };
    await assertFails(addContribution(dbAs(env, LEADER_B), { by: LEADER_B, ratings }));
  });
});

const FIRST = { note: 'first', ratings: null };
const SECOND = { note: 'second', ratings: { Pride: 2, Passion: null, Professionalism: null } };

describe('contributions: edit', () => {
  beforeEach(async () => { await seedContribution(env, { by: LEADER_A, note: 'first' }); });

  it('the author can edit with a matching log entry', async () => {
    await assertSucceeds(changeContribution(dbAs(env, LEADER_A), { before: FIRST, after: SECOND }));
  });
  it('another leader cannot edit it', async () => {
    await assertFails(changeContribution(dbAs(env, LEADER_B), { by: LEADER_B, before: FIRST, after: SECOND }));
  });
  it('fails without the log entry', async () => {
    await assertFails(changeContribution(dbAs(env, LEADER_A), { before: FIRST, after: SECOND, withLog: false }));
  });
  it('fails when rev skips ahead', async () => {
    await assertFails(changeContribution(dbAs(env, LEADER_A), { rev: 3, before: FIRST, after: SECOND }));
  });
  it('fails when the log "before" is wrong', async () => {
    await assertFails(changeContribution(dbAs(env, LEADER_A), {
      before: { note: 'not what it was', ratings: null }, after: SECOND,
    }));
  });
  it('fails when the log "after" does not match the new content', async () => {
    await assertFails(changeContribution(dbAs(env, LEADER_A), {
      before: FIRST, after: SECOND, logOver: { after: { note: 'lie', ratings: null } },
    }));
  });
  it('cannot change authorEmail', async () => {
    await assertFails(changeContribution(dbAs(env, LEADER_A), {
      before: FIRST, after: SECOND, contribOver: { authorEmail: LEADER_B },
    }));
  });
  it('cannot change authorName', async () => {
    await assertFails(changeContribution(dbAs(env, LEADER_A), {
      before: FIRST, after: SECOND, contribOver: { authorName: 'Someone Else' },
    }));
  });
  it('fails when an edit is logged as "retracted"', async () => {
    await assertFails(changeContribution(dbAs(env, LEADER_A), {
      before: FIRST, after: SECOND, logOver: { type: 'retracted' },
    }));
  });
  it('cannot clear both note and ratings', async () => {
    await assertFails(changeContribution(dbAs(env, LEADER_A), { before: FIRST, after: { note: '', ratings: null } }));
  });

  // Review Focus 3: same user, two tabs — the second write has a stale rev
  it('rejects a second edit that reuses the same rev', async () => {
    await assertSucceeds(changeContribution(dbAs(env, LEADER_A), { before: FIRST, after: SECOND }));
    await assertFails(changeContribution(dbAs(env, LEADER_A), {
      rev: 2, before: FIRST, after: { note: 'third', ratings: null },
    }));
  });
});

describe('contributions: retract', () => {
  beforeEach(async () => { await seedContribution(env, { by: LEADER_A, note: 'first' }); });

  it('the author can retract with a matching log entry', async () => {
    await assertSucceeds(changeContribution(dbAs(env, LEADER_A), { retract: true, before: FIRST, after: FIRST }));
  });
  it('another leader cannot retract it', async () => {
    await assertFails(changeContribution(dbAs(env, LEADER_B), { by: LEADER_B, retract: true, before: FIRST, after: FIRST }));
  });
  it('fails when a retract is logged as "edited"', async () => {
    await assertFails(changeContribution(dbAs(env, LEADER_A), {
      retract: true, before: FIRST, after: FIRST, logOver: { type: 'edited' },
    }));
  });
  it('a retract cannot also change the note', async () => {
    await assertFails(changeContribution(dbAs(env, LEADER_A), {
      retract: true, before: FIRST, after: { note: 'sneaky', ratings: null },
    }));
  });

  // Review Focus 2: edit after retract
  it('cannot be edited after it was retracted', async () => {
    await assertSucceeds(changeContribution(dbAs(env, LEADER_A), { retract: true, before: FIRST, after: FIRST }));
    await assertFails(changeContribution(dbAs(env, LEADER_A), { rev: 3, before: FIRST, after: SECOND }));
  });
  it('cannot be un-retracted', async () => {
    await assertSucceeds(changeContribution(dbAs(env, LEADER_A), { retract: true, before: FIRST, after: FIRST }));
    await assertFails(changeContribution(dbAs(env, LEADER_A), { rev: 3, retract: false, before: FIRST, after: FIRST }));
  });
});
