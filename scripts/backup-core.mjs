// Shared helpers for backup-firestore.mjs and restore-firestore.mjs.
//
// File format: NDJSON, gzipped, optionally AES-256-GCM encrypted.
//   line 1   {"format":"firestore-backup/1","projectId":...,"createdAt":...}
//   line 2+  {"path":"evaluations/abc","data":{...}}     (one per document)
//   last     {"end":true,"docs":N}                       (detects truncation)
//
// Firestore types that JSON cannot carry are stored as {"__t": "<tag>", ...}.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { Timestamp, GeoPoint, DocumentReference } from 'firebase-admin/firestore';

export const FORMAT = 'firestore-backup/1';
const MAGIC = Buffer.from('FSBK1');
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;

export function encodeValue(v) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : { __t: 'num', v: String(v) };
  }
  if (v instanceof Timestamp) return { __t: 'ts', s: v.seconds, n: v.nanoseconds };
  if (v instanceof GeoPoint) return { __t: 'geo', lat: v.latitude, lng: v.longitude };
  if (v instanceof DocumentReference) return { __t: 'ref', path: v.path };
  if (v instanceof Uint8Array) return { __t: 'bytes', b64: Buffer.from(v).toString('base64') };
  if (Array.isArray(v)) return v.map(encodeValue);
  if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = encodeValue(val);
    // A user map that happens to use the reserved key is wrapped so it round-trips.
    return Object.hasOwn(out, '__t') ? { __t: 'map', v: out } : out;
  }
  // Unknown Firestore type (e.g. vector): fail loudly rather than silently lose data.
  throw new Error(`Unsupported Firestore value type: ${v?.constructor?.name ?? typeof v}`);
}

export function decodeValue(v, db) {
  if (Array.isArray(v)) return v.map(x => decodeValue(x, db));
  if (v === null || typeof v !== 'object') return v;
  switch (v.__t) {
    case undefined: break;
    case 'num': return Number(v.v);
    case 'ts': return new Timestamp(v.s, v.n);
    case 'geo': return new GeoPoint(v.lat, v.lng);
    case 'ref': return db.doc(v.path);
    case 'bytes': return Buffer.from(v.b64, 'base64');
    case 'map': return decodeFields(v.v, db);
    default: throw new Error(`Unknown encoded type tag: ${v.__t}`);
  }
  return decodeFields(v, db);
}

function decodeFields(obj, db) {
  const out = {};
  for (const [k, val] of Object.entries(obj)) out[k] = decodeValue(val, db);
  return out;
}

/** @param {{path:string,data:object}[]} docs data already encoded */
export function buildBackup({ projectId, docs, createdAt = new Date().toISOString() }) {
  const lines = [JSON.stringify({ format: FORMAT, projectId, createdAt })];
  for (const d of docs) lines.push(JSON.stringify({ path: d.path, data: d.data }));
  lines.push(JSON.stringify({ end: true, docs: docs.length }));
  return Buffer.from(lines.join('\n') + '\n', 'utf8');
}

/** Parses and validates a backup body; throws on a truncated or foreign file. */
export function parseBackup(buf) {
  const lines = buf.toString('utf8').split('\n').filter(Boolean);
  if (lines.length < 2) throw new Error('Backup file is empty or truncated');
  const header = JSON.parse(lines[0]);
  if (header.format !== FORMAT) throw new Error(`Unrecognised backup format: ${header.format}`);
  const footer = JSON.parse(lines[lines.length - 1]);
  if (!footer.end) throw new Error('Backup is truncated: end marker missing');
  const docs = lines.slice(1, -1).map(l => JSON.parse(l));
  if (docs.length !== footer.docs) {
    throw new Error(`Backup is corrupt: expected ${footer.docs} docs, found ${docs.length}`);
  }
  return { header, docs };
}

function deriveKey(passphrase, salt) {
  return scryptSync(passphrase, salt, 32);
}

export function pack(body, passphrase) {
  const gz = gzipSync(body);
  if (!passphrase) return gz;
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  const enc = Buffer.concat([cipher.update(gz), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, enc, cipher.getAuthTag()]);
}

export function unpack(file, passphrase) {
  const encrypted = file.subarray(0, MAGIC.length).equals(MAGIC);
  if (!encrypted) return gunzipSync(file);
  if (!passphrase) throw new Error('This backup is encrypted: set BACKUP_ENCRYPTION_KEY');
  const salt = file.subarray(MAGIC.length, MAGIC.length + SALT_LEN);
  const iv = file.subarray(MAGIC.length + SALT_LEN, MAGIC.length + SALT_LEN + IV_LEN);
  const tag = file.subarray(file.length - TAG_LEN);
  const enc = file.subarray(MAGIC.length + SALT_LEN + IV_LEN, file.length - TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  try {
    return gunzipSync(Buffer.concat([decipher.update(enc), decipher.final()]));
  } catch {
    throw new Error('Decryption failed: wrong BACKUP_ENCRYPTION_KEY or the file was altered');
  }
}

export function backupFileName(date = new Date(), encrypted = false) {
  const stamp = date.toISOString().replace(/[:]/g, '-').replace(/\.\d+Z$/, 'Z');
  return `firestore-${stamp}.ndjson.gz${encrypted ? '.enc' : ''}`;
}

export const BACKUP_FILE_PATTERN = /^firestore-.+\.ndjson\.gz(\.enc)?$/;
