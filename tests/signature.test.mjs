import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const S = createRequire(import.meta.url)('../signature.js');
const PNG = 'data:image/png;base64,';

describe('isValidDataUrl', () => {
  it('accepts a small PNG data URL', () => {
    assert.equal(S.isValidDataUrl(PNG + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), true);
  });
  it('rejects things that are not PNG data URLs', () => {
    ['', null, undefined, 42, 'javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=',
     'data:image/svg+xml;base64,PHN2Zz4=', 'https://example.com/a.png', 'data:image/png;base64,'].forEach(bad =>
      assert.equal(S.isValidDataUrl(bad), false, String(bad)));
  });
  it('rejects PNG prefixes followed by anything other than base64', () => {
    assert.equal(S.isValidDataUrl(PNG + '"><script>alert(1)</script>'), false);
    assert.equal(S.isValidDataUrl(PNG + 'abc def'), false);
  });
  it('enforces the size limit so an evaluation stays far below the 1 MB document limit', () => {
    const ok = PNG + 'A'.repeat(S.MAX_DATA_URL - PNG.length);
    const tooBig = PNG + 'A'.repeat(S.MAX_DATA_URL - PNG.length + 1);
    assert.equal(S.isValidDataUrl(ok), true);
    assert.equal(S.isValidDataUrl(tooBig), false);
  });
});

describe('safeImageSrc', () => {
  it('returns the data URL when valid and an empty string otherwise', () => {
    const good = PNG + 'AAAA';
    assert.equal(S.safeImageSrc(good), good);
    assert.equal(S.safeImageSrc('javascript:alert(1)'), '');
    assert.equal(S.safeImageSrc(undefined), '');
  });
});
