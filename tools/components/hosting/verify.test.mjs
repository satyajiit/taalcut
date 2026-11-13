// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { after, before, describe, it } from 'node:test';
import { staticHost } from './test-servers.mjs';
import { artifactRows, sourceRows, verify } from './verify.mjs';
import { checkArtifact, checkNotice } from './verify-url.mjs';

const body = randomBytes(4096);
const sha256 = createHash('sha256').update(body).digest('hex');
const binary = {
  'content-type': 'application/octet-stream',
  'cache-control': 'public, max-age=31536000, immutable',
};
const noticeBody = Buffer.from('X 1 (Taalcut component "good")\n');
const notice = (path) => ({
  url: `${host.url}${path}`,
  size: noticeBody.length,
  sha256: createHash('sha256').update(noticeBody).digest('hex'),
});
const text = {
  'content-type': 'text/plain; charset=utf-8',
  'cache-control': 'public, max-age=31536000, immutable',
};
let host;

before(async () => {
  host = await staticHost({
    '/good/1/model.onnx': { body, headers: binary },
    '/good/1/source/model.onnx': { body, headers: binary },
    '/good/1/NOTICE.txt': { body: noticeBody, headers: text },
    '/short/1/NOTICE.txt': {
      body: noticeBody,
      headers: { ...text, 'cache-control': 'public, max-age=86400' },
    },
    '/gzip/1/model.onnx': { body: gzipSync(body), headers: { ...binary, 'content-encoding': 'gzip' } },
    '/noranges/1/model.onnx': { body, headers: binary, ranges: false },
    '/mutable/1/model.onnx': { body, headers: { ...binary, 'cache-control': 'max-age=60' } },
  });
});
after(() => host.close());

const artifact = (path, extra = {}) => ({
  url: `${host.url}${path}`,
  size: body.length,
  sha256,
  contentType: 'application/octet-stream',
  ...extra,
});

describe('checkArtifact', () => {
  it('passes a file served as the app needs it, whole and resumable', async () => {
    const result = await checkArtifact(artifact('/good/1/model.onnx'));
    assert.deepEqual(result.problems, []);
    assert.equal(result.sha256, sha256);
    assert.deepEqual((await checkArtifact(artifact('/good/1/model.onnx'), { quick: true })).problems, []);
  });

  it('finds a wrong sha256 or size', async () => {
    const wrong = await checkArtifact(artifact('/good/1/model.onnx', { sha256: '0'.repeat(64), size: 4095 }));
    assert.ok(wrong.problems.some((p) => p.startsWith('sha256 ')));
    assert.ok(wrong.problems.some((p) => p.startsWith('Content-Length 4096, expected 4095')));
  });

  it('finds compression, a missing range answer and a short cache', async () => {
    const gzip = await checkArtifact(artifact('/gzip/1/model.onnx'));
    assert.ok(gzip.problems.includes('Content-Encoding gzip'));
    assert.ok(
      gzip.problems.some((p) => p.startsWith('range 0-0: Content-Range')),
      'ranges of compressed bytes',
    );
    assert.ok(
      (await checkArtifact(artifact('/noranges/1/model.onnx'))).problems.includes('range 0-0: HTTP 200'),
    );
    const mutable = await checkArtifact(artifact('/mutable/1/model.onnx'));
    assert.ok(mutable.problems.some((p) => p.includes('expected immutable')));
    assert.deepEqual((await checkArtifact(artifact('/missing/1/x.bin'))).problems.slice(0, 1), [
      'range 0-0: HTTP 404',
    ]);
  });

  it('checks the notice is the pinned bytes, immutable, and names its component', async () => {
    assert.deepEqual(await checkNotice(notice('/good/1/NOTICE.txt'), 'good'), []);
    assert.deepEqual(await checkNotice(notice('/good/1/NOTICE.txt'), 'other'), [
      'notice: does not name the component',
    ]);
    const changed = { ...notice('/good/1/NOTICE.txt'), sha256: '0'.repeat(64) };
    assert.match(
      (await checkNotice(changed, 'good'))[0],
      /^notice: 31 bytes, sha256 [0-9a-f]{64}; the manifest pins 31, 0{64}$/,
    );
    assert.deepEqual(await checkNotice(notice('/short/1/NOTICE.txt'), 'good'), [
      'notice: Cache-Control public, max-age=86400, expected immutable',
    ]);
  });
});

describe('verify', () => {
  const manifest = (url, noticeUrl) => ({
    components: [
      {
        id: 'good',
        licence: { spdx: 'MIT', notice: { ...notice('/good/1/NOTICE.txt'), url: noticeUrl } },
        artifacts: [{ urls: [url], size: body.length, sha256 }],
      },
    ],
  });

  it('passes a manifest whose every url is on the base and served right', async () => {
    const lines = [];
    const result = await verify({
      manifest: manifest(`${host.url}/good/1/model.onnx`, `${host.url}/good/1/NOTICE.txt`),
      base: host.url,
      only: new Set(),
      log: (line) => lines.push(line),
    });
    assert.equal(result.failures.length, 0);
    assert.match(lines[0], /^ok\tgood\t4096\t/);
  });

  it('checks the sources release.json lists, without a notice of their own', async () => {
    const release = {
      objects: [
        { key: 'good/1/model.onnx', size: 1, sha256: 'x' },
        { key: 'good/1/source/model.onnx', size: body.length, sha256 },
      ],
    };
    assert.deepEqual(
      sourceRows(release, host.url, new Set()).map((row) => row.url),
      [`${host.url}/good/1/source/model.onnx`],
    );
    assert.deepEqual(sourceRows(release, host.url, new Set(['other'])), []);
    const lines = [];
    const result = await verify({
      manifest: { components: [] },
      release,
      base: host.url,
      only: new Set(),
      log: (line) => lines.push(line),
    });
    assert.equal(result.failures.length, 0);
    assert.match(lines[0], /^ok\tgood model\.onnx\t4096\t/);
  });

  it('records a network failure and goes on', async () => {
    const result = await verify({
      manifest: manifest('http://127.0.0.1:9/good/1/model.onnx', 'http://127.0.0.1:9/good/1/NOTICE.txt'),
      base: 'http://127.0.0.1:9',
      only: new Set(),
      fetch: () => Promise.reject(new Error('connect ECONNREFUSED')),
      log: () => {},
    });
    assert.deepEqual(result.failures[0].problems, [
      'fetch failed: connect ECONNREFUSED',
      'notice fetch failed: connect ECONNREFUSED',
    ]);
  });

  it('fails a url or a notice off the base without fetching it', async () => {
    const offBase = manifest('https://huggingface.co/x/model.onnx', 'https://github.com/x/LICENSE');
    const rows = artifactRows(offBase, host.url, new Set());
    assert.equal(rows[0].offBase, true);
    const result = await verify({ manifest: offBase, base: host.url, only: new Set(), log: () => {} });
    assert.deepEqual(result.failures[0].problems, [
      `not on ${host.url}`,
      `licence notice https://github.com/x/LICENSE not on ${host.url}`,
    ]);
  });
});
