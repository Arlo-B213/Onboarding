// Restores a backup made by backup-firestore.mjs.
//
//   node scripts/restore-firestore.mjs <backup-file>                 dry run: shows what would be written
//   node scripts/restore-firestore.mjs <file> --emulator --apply     write into the local emulator
//   node scripts/restore-firestore.mjs <file> --apply --confirm-project <id>   write to REAL Firestore
//
// Safety:
//   - Default is a dry run; nothing is written without --apply.
//   - Writing to real Firestore also requires --confirm-project to equal the target project id.
//   - Documents are written with set(): a document at the same path is OVERWRITTEN.
//     Documents that exist now but are not in the backup are left alone (nothing is deleted).
//   - Auth accounts are not part of a Firestore backup and are not restored.
// Encrypted backups need BACKUP_ENCRYPTION_KEY. Production writes need
// GOOGLE_APPLICATION_CREDENTIALS with a key that can WRITE (not the read-only backup key).

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseBackup, unpack, decodeValue } from './backup-core.mjs';

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    project: { type: 'string' },
    emulator: { type: 'boolean', default: false },
    apply: { type: 'boolean', default: false },
    'confirm-project': { type: 'string' },
  },
});

function fail(msg) {
  console.error(`restore failed: ${msg}`);
  process.exit(1);
}
process.on('uncaughtException', e => fail(e.message));

const [file] = positionals;
if (!file) fail('usage: restore-firestore.mjs <backup-file> [--emulator] [--apply] [--confirm-project <id>]');

const { header, docs } = parseBackup(unpack(readFileSync(file), process.env.BACKUP_ENCRYPTION_KEY || ''));
const projectId = opts.project || header.projectId;

if (opts.emulator && !process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
}
const useEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const perCollection = {};
for (const d of docs) perCollection[d.path.split('/')[0]] = (perCollection[d.path.split('/')[0]] ?? 0) + 1;

console.log(`backup:     ${file}`);
console.log(`taken:      ${header.createdAt} from project ${header.projectId}`);
console.log(`documents:  ${docs.length}  ${JSON.stringify(perCollection)}`);
console.log(`target:     ${projectId}${useEmulator ? ` (emulator ${process.env.FIRESTORE_EMULATOR_HOST})` : ' (REAL Firestore)'}`);

if (!opts.apply) {
  console.log('\nDry run only. Add --apply to write these documents.');
  process.exit(0);
}
if (!useEmulator) {
  if (opts['confirm-project'] !== projectId) {
    fail(`writing to real Firestore requires --confirm-project ${projectId}`);
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) fail('set GOOGLE_APPLICATION_CREDENTIALS');
}

initializeApp(useEmulator ? { projectId } : { projectId, credential: applicationDefault() });
const db = getFirestore();

const writer = db.bulkWriter();
let failed = 0;
writer.onWriteError(err => { failed++; console.error(`write error: ${err.documentRef.path}: ${err.message}`); return false; });
for (const d of docs) writer.set(db.doc(d.path), decodeValue(d.data, db));
await writer.close();

if (failed) fail(`${failed} document(s) could not be written`);
console.log(`\nrestored ${docs.length} documents.`);
