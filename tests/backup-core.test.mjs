import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp, GeoPoint } from 'firebase-admin/firestore';
import {
  encodeValue, decodeValue, buildBackup, parseBackup, pack, unpack, backupFileName, BACKUP_FILE_PATTERN,
} from '../scripts/backup-core.mjs';

const fakeDb = { doc: path => ({ path }) };
const roundTrip = v => decodeValue(JSON.parse(JSON.stringify(encodeValue(v))), fakeDb);

describe('value encoding', () => {
  it('round-trips timestamps, geo points and bytes', () => {
    const v = { at: new Timestamp(1790000000, 123000000), where: new GeoPoint(33.5, -117.1), sig: Buffer.from([1, 2, 3]) };
    const back = roundTrip(v);
    assert.ok(back.at.isEqual(v.at));
    assert.ok(back.where.isEqual(v.where));
    assert.deepEqual([...back.sig], [1, 2, 3]);
  });

  it('round-trips nested maps, arrays, null and non-finite numbers', () => {
    const v = { a: { b: [1, 'x', null, { c: true }] }, nan: NaN, inf: Infinity };
    const back = roundTrip(v);
    assert.deepEqual(back.a, v.a);
    assert.ok(Number.isNaN(back.nan));
    assert.equal(back.inf, Infinity);
  });

  it('keeps a user map that uses the reserved __t key intact', () => {
    const v = { odd: { __t: 'ts', s: 1 } };
    assert.deepEqual(roundTrip(v), v);
  });

  it('fails loudly on a value type it cannot represent', () => {
    assert.throws(() => encodeValue(new Map()), /Unsupported Firestore value type/);
  });
});

describe('backup file format', () => {
  const docs = [{ path: 'evaluations/a', data: { n: 1 } }, { path: 'evaluations/a/activity/b', data: { n: 2 } }];

  it('parses what it builds, subcollections included', () => {
    const parsed = parseBackup(buildBackup({ projectId: 'p', docs }));
    assert.equal(parsed.header.projectId, 'p');
    assert.deepEqual(parsed.docs.map(d => d.path), ['evaluations/a', 'evaluations/a/activity/b']);
  });

  it('rejects a truncated file', () => {
    const lines = buildBackup({ projectId: 'p', docs }).toString().trim().split('\n');
    const cut = Buffer.from(lines.slice(0, -1).join('\n') + '\n');
    assert.throws(() => parseBackup(cut), /truncated|end marker/);
  });

  it('rejects a file whose document count does not match the footer', () => {
    const lines = buildBackup({ projectId: 'p', docs }).toString().trim().split('\n');
    lines.splice(1, 1);
    assert.throws(() => parseBackup(Buffer.from(lines.join('\n') + '\n')), /corrupt/);
  });
});

describe('compression and encryption', () => {
  const body = buildBackup({ projectId: 'p', docs: [{ path: 'x/y', data: { secret: 'value' } }] });

  it('round-trips with and without a passphrase', () => {
    assert.deepEqual(unpack(pack(body, ''), ''), body);
    assert.deepEqual(unpack(pack(body, 'correct horse'), 'correct horse'), body);
  });

  it('does not leave plaintext in an encrypted file', () => {
    assert.ok(!pack(body, 'k').toString('latin1').includes('secret'));
  });

  it('rejects a wrong passphrase, a missing passphrase, and a tampered file', () => {
    const enc = pack(body, 'right');
    assert.throws(() => unpack(enc, 'wrong'), /Decryption failed/);
    assert.throws(() => unpack(enc, ''), /encrypted/);
    enc[enc.length - 20] ^= 0xff;
    assert.throws(() => unpack(enc, 'right'), /Decryption failed/);
  });
});

describe('file naming', () => {
  it('names files the retention pattern recognises', () => {
    assert.match(backupFileName(new Date('2026-10-07T03:04:05.678Z')), BACKUP_FILE_PATTERN);
    assert.match(backupFileName(new Date(), true), BACKUP_FILE_PATTERN);
    assert.doesNotMatch('notes.txt', BACKUP_FILE_PATTERN);
  });
});
