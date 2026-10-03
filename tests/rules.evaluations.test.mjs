import { describe, it, before, after, beforeEach } from 'node:test';
import { doc, getDoc } from 'firebase/firestore';
import { createEnv, anonDb, seedEvaluation, assertFails } from './helpers.mjs';

let env;
before(async () => { env = await createEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

describe('evaluations', () => {
  it('signed-out users cannot read an evaluation', async () => {
    await seedEvaluation(env);
    await assertFails(getDoc(doc(anonDb(env), 'evaluations', 'e1')));
  });
});
