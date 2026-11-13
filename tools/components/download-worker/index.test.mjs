// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { byteRange, download } from './index.mjs';

const BYTES = Buffer.from('a component with enough bytes to resume');
const ETAG = '"known-content"';
const UPLOADED = new Date('2026-11-10T10:30:00Z');
function fixture({ missing = false, changed = false } = {}) {
  const calls = [];
  const metadata = {
    size: BYTES.length,
    etag: 'known-content',
    httpEtag: ETAG,
    uploaded: UPLOADED,
    writeHttpMetadata: (headers) => {
      headers.set('content-type', 'application/octet-stream');
      headers.set('cache-control', 'public, max-age=31536000, immutable');
    },
  };
  const bucket = {
    head: async (key) => {
      calls.push(['head', key]);
      return missing ? null : metadata;
    },
    get: async (key, options) => {
      calls.push(['get', key, options]);
      if (changed) return metadata;
      const { offset = 0, length = BYTES.length } = options.range ?? {};
      return { ...metadata, body: BYTES.subarray(offset, offset + length) };
    },
  };
  return { bucket, calls };
}
function request(headers = {}, method = 'GET', path = '/component/1.0/file.tar.zst') {
  return new Request(`https://components.taalcut.app${path}`, { method, headers });
}

test('closed, open and suffix ranges clamp to the actual object', () => {
  assert.equal(byteRange(null, 20), null);
  for (const [input, expected] of [
    ['bytes=2-4', { offset: 2, length: 3 }],
    ['bytes=15-99', { offset: 15, length: 5 }],
    ['bytes=12-', { offset: 12, length: 8 }],
    ['bytes=-4', { offset: 16, length: 4 }],
    ['bytes=-99', { offset: 0, length: 20 }],
  ])
    assert.deepEqual(byteRange(input, 20), expected);
  for (const input of [
    'bytes=-',
    'bytes=-0',
    'bytes=20-',
    'bytes=4-3',
    'bytes=1-2,4-5',
    'items=1-2',
    'bytes=9007199254740992-',
  ])
    assert.equal(byteRange(input, 20), false, input);
  assert.equal(byteRange('bytes=0-', 0), false);
});

test('full download preserves metadata and HEAD does not fetch the body', async () => {
  const { bucket, calls } = fixture();
  const response = await download(request({ origin: 'https://taalcut.app' }), bucket);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), BYTES);
  assert.equal(response.headers.get('etag'), ETAG);
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.match(response.headers.get('cache-control'), /immutable/);
  assert.equal(response.headers.get('last-modified'), UPLOADED.toUTCString());
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.match(response.headers.get('link'), /download-gateway-source\.tar\.zst>; rel="source"/);
  const head = await download(request({ range: 'bytes=1-2' }, 'HEAD'), bucket);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(BYTES.length));
  assert.equal(await head.text(), '');
  assert.equal(calls.filter(([kind]) => kind === 'get').length, 1);
  assert.deepEqual(calls[1][2].onlyIf, { etagMatches: 'known-content' });
});

test('resumed pieces reconstruct the complete content and known checksum', async () => {
  const { bucket } = fixture();
  const chunks = [];
  for (const [start, end] of [
    [0, 10],
    [11, BYTES.length - 1],
  ]) {
    const response = await download(request({ range: `bytes=${start}-${end}`, 'if-range': ETAG }), bucket);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${BYTES.length}`);
    assert.equal(response.headers.get('content-length'), String(end - start + 1));
    chunks.push(Buffer.from(await response.arrayBuffer()));
  }
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash(Buffer.concat(chunks)), hash(BYTES));
});

test('If-Range uses only matching strong validators or fresh dates', async () => {
  for (const [validator, status] of [
    [ETAG, 206],
    [UPLOADED.toUTCString(), 206],
    ['"stale"', 200],
    [`W/${ETAG}`, 200],
    ['Tue, 10 Nov 2026 10:29:59 GMT', 200],
    ['invalid', 200],
  ]) {
    const response = await download(request({ range: 'bytes=-3', 'if-range': validator }), fixture().bucket);
    assert.equal(response.status, status, validator);
    assert.equal((await response.arrayBuffer()).byteLength, status === 206 ? 3 : BYTES.length);
  }
});

test('conditional GET avoids body access and ETag takes precedence over date', async () => {
  for (const headers of [
    { 'if-none-match': `"other", W/${ETAG}` },
    { 'if-none-match': '*' },
    { 'if-modified-since': UPLOADED.toUTCString() },
  ]) {
    const { bucket, calls } = fixture();
    assert.equal((await download(request(headers), bucket)).status, 304);
    assert.equal(calls.length, 1);
  }
  assert.equal(
    (
      await download(
        request({ 'if-none-match': '"stale"', 'if-modified-since': UPLOADED.toUTCString() }),
        fixture().bucket,
      )
    ).status,
    200,
  );
});

test('invalid ranges return non-cacheable 416 without opening the object', async () => {
  const { bucket, calls } = fixture();
  const response = await download(request({ range: 'bytes=999-' }), bucket);
  assert.equal(response.status, 416);
  assert.equal(response.headers.get('content-range'), `bytes */${BYTES.length}`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), '');
  assert.equal(calls.length, 1);
});

test('unsupported methods, unsafe or missing keys and replacement races fail closed', async () => {
  const { bucket, calls } = fixture();
  const response = await download(request({}, 'POST'), bucket);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, HEAD');
  for (const path of ['/', '/a//b', '/a/%2Fsecret', '/a/file%20name'])
    assert.equal((await download(request({}, 'GET', path), bucket)).status, 404);
  assert.equal(calls.length, 0);
  assert.equal((await download(request(), fixture({ missing: true }).bucket)).status, 404);
  assert.equal((await download(request(), fixture({ changed: true }).bucket)).status, 412);
});
