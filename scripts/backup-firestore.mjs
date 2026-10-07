// Backs up every Firestore document (all collections and subcollections) to one
// compressed, optionally encrypted file. Read-only: it never writes to Firestore.
//
//   node scripts/backup-firestore.mjs [--project ID] [--out DIR] [--keep-days N]
//
// Credentials (production):  GOOGLE_APPLICATION_CREDENTIALS=<service-account.json>
//   Use a dedicated service account with only the "Cloud Datastore Viewer" role.
//   Keep the key OUTSIDE this repo: firebase.json serves the whole folder.
// Emulator (testing):        FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
//
// Encryption: set BACKUP_ENCRYPTION_KEY (AES-256-GCM). Set BACKUP_REQUIRE_ENCRYPTION=1
//   to refuse to write an unencrypted file (the GitHub workflow does this, because
//   this repo is public and the data includes evaluations and signatures).
//
// Output dir defaults to <home>/firestore-backups/<project>. Document contents are
// never printed; only counts.

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  encodeValue, buildBackup, parseBackup, pack, unpack, backupFileName, BACKUP_FILE_PATTERN,
} from './backup-core.mjs';

const { values: opts } = parseArgs({
  options: {
    project: { type: 'string' },
    out: { type: 'string' },
    'keep-days': { type: 'string' },
  },
});

const projectId = opts.project || process.env.FIREBASE_PROJECT_ID || 'onboarding-23722';
const passphrase = process.env.BACKUP_ENCRYPTION_KEY || '';
const keepDays = Number(opts['keep-days'] ?? process.env.BACKUP_KEEP_DAYS ?? 30);
const outDir = resolve(opts.out || process.env.BACKUP_DIR || join(homedir(), 'firestore-backups', projectId));
const useEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

function fail(msg) {
  console.error(`backup failed: ${msg}`);
  process.exit(1);
}
process.on('uncaughtException', e => fail(e.message));

if (process.env.BACKUP_REQUIRE_ENCRYPTION === '1' && !passphrase) {
  fail('BACKUP_REQUIRE_ENCRYPTION=1 but BACKUP_ENCRYPTION_KEY is not set');
}
if (!useEmulator && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  fail('set GOOGLE_APPLICATION_CREDENTIALS to a service-account key file (or FIRESTORE_EMULATOR_HOST for testing)');
}

initializeApp(useEmulator ? { projectId } : { projectId, credential: applicationDefault() });
const db = getFirestore();

/** Collects every document under a collection, recursing into subcollections. */
async function collect(collectionRef, docs) {
  const refs = await collectionRef.listDocuments(); // includes docs that only hold subcollections
  const snaps = refs.length ? await db.getAll(...refs) : [];
  for (const snap of snaps) {
    if (snap.exists) docs.push({ path: snap.ref.path, data: encodeValue(snap.data()) });
    for (const sub of await snap.ref.listCollections()) await collect(sub, docs);
  }
}

const docs = [];
for (const col of await db.listCollections()) await collect(col, docs);

const body = buildBackup({ projectId, docs });
const file = pack(body, passphrase);
mkdirSync(outDir, { recursive: true });
const target = join(outDir, backupFileName(new Date(), Boolean(passphrase)));
writeFileSync(target, file, { mode: 0o600 });

// Verify by reading the file back and checking the integrity markers.
const check = parseBackup(unpack(readFileSync(target), passphrase));
if (check.docs.length !== docs.length) fail('verification mismatch after writing');

const perCollection = {};
for (const d of docs) perCollection[d.path.split('/')[0]] = (perCollection[d.path.split('/')[0]] ?? 0) + 1;

console.log(`project:    ${projectId}${useEmulator ? ' (emulator)' : ''}`);
console.log(`documents:  ${docs.length}  ${JSON.stringify(perCollection)}`);
console.log(`encrypted:  ${passphrase ? 'yes (AES-256-GCM)' : 'NO'}`);
console.log(`file:       ${target} (${file.length} bytes)`);

// Retention: only ever touches files that match this script's own naming pattern.
if (keepDays > 0) {
  const cutoff = Date.now() - keepDays * 86_400_000;
  let pruned = 0;
  for (const name of readdirSync(outDir)) {
    const p = join(outDir, name);
    if (BACKUP_FILE_PATTERN.test(name) && statSync(p).mtimeMs < cutoff) { unlinkSync(p); pruned++; }
  }
  if (pruned) console.log(`pruned:     ${pruned} backup(s) older than ${keepDays} days`);
}
