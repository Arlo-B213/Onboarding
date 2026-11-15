// Seeds the LOCAL Firebase emulators with test accounts, one team and two sample evaluations.
// Leader One is on the "Sample Team"; Leader Two is on no team, so sees nothing until an admin adds them.
// Never touches production: it only talks to 127.0.0.1.
//
//   npx firebase emulators:start --only auth,firestore,hosting --project onboarding-23722
//   node scripts/seed-emulator.mjs
//   open http://localhost:5000
//
// Emulator-only test accounts (these exist nowhere but in your local emulator):
export const ACCOUNTS = [
  { email: 'arlo.bedolla@gmail.com', password: 'Passw0rd!', name: 'Arlo (admin)' },
  { email: 'leader1@test.com', password: 'Passw0rd!', name: 'Leader One' },
  { email: 'leader2@test.com', password: 'Passw0rd!', name: 'Leader Two' },
];

const AUTH = 'http://127.0.0.1:9099';
const FIRESTORE = 'http://127.0.0.1:8080';
const PROJECT = 'onboarding-23722';
const DOCS = `${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents`;

async function createAccount({ email, password, name }) {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, displayName: name, returnSecureToken: true }),
  });
  const body = await res.json();
  if (body.error && body.error.message !== 'EMAIL_EXISTS') throw new Error(`${email}: ${body.error.message}`);
  console.log(`${body.error ? 'exists ' : 'created'} ${email}`);
}

// "Bearer owner" bypasses the security rules in the emulator, so we can write the seed directly
async function put(path, fields) {
  const res = await fetch(`${DOCS}/${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
}

const str = s => ({ stringValue: s });
const int = n => ({ integerValue: String(n) });
const now = () => ({ timestampValue: new Date().toISOString() });
const nul = { nullValue: null };

for (const a of ACCOUNTS) await createAccount(a);

await put('teams/sample-team', {
  name: str('Sample Team'),
  memberEmails: { arrayValue: { values: [str('leader1@test.com')] } },
  createdAt: now(), updatedAt: now(),
});
console.log('seeded team sample-team (Leader One)');

const by = 'leader1@test.com';
await put('evaluations/sample1', {
  teamId: str('sample-team'),
  tmName: str('Sample Teammate'), outlet: str('Great Oak'), position: str('Food Server'),
  startDate: str('2026-09-01'), evalDate: str(new Date().toISOString().slice(0, 10)),
  period: int(30),
  competencies: { mapValue: { fields: { Pride: int(3), Passion: int(2), Professionalism: int(2) } } },
  policies: str('Reviewed cash handling and the 5/10 rule.'), expectations: str('Lead a section independently.'),
  strengths: str('Warm with guests.'), improvements: str('Speed during rushes.'), trainerNotes: str(''),
  trainerName: str('Leader One'), trainerSig: str('Leader One'), tmSig: str(''), managerSig: str(''),
  submittedBy: str(by), submittedByName: str('Leader One'), submittedAt: now(),
});
await put('evaluations/sample1/activity/submitted', {
  type: str('submitted'), contributionId: nul, rev: nul, byEmail: str(by), byName: str('Leader One'),
  at: now(), before: nul, after: nul,
});
console.log('seeded evaluation sample1');

// An older-style evaluation with no team: only the admin sees it until it is put on a team
await put('evaluations/sample2', {
  tmName: str('Unassigned Teammate'), outlet: str('Pronto'), position: str('Cashier'),
  startDate: str('2026-08-15'), evalDate: str(new Date().toISOString().slice(0, 10)),
  period: int(14),
  competencies: { mapValue: { fields: { Pride: int(2), Passion: int(2), Professionalism: int(2) } } },
  policies: str(''), expectations: str(''), strengths: str(''), improvements: str(''), trainerNotes: str(''),
  trainerName: str('Arlo'), trainerSig: str('Arlo'), tmSig: str(''), managerSig: str(''),
  submittedBy: str('arlo.bedolla@gmail.com'), submittedByName: str('Arlo (admin)'), submittedAt: now(),
});
console.log('seeded evaluation sample2 (no team)');
