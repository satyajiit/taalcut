// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// pinned.mjs against a local host that cuts, stalls, refuses and ignores ranges (test-servers.mjs, faultyHost).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { pinned, retryAfterMs } from './pinned.mjs';
import { faultyHost } from './test-servers.mjs';

const body = Buffer.alloc(256 * 1024);
for (let i = 0; i < body.length; i++) body[i] = (i * 31 + (i >> 9)) & 0xff;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

let host;
let cacheDir;
let waits;
let lines;
before(async () => {
  host = await faultyHost({
    '/file.bin': { body },
    '/moving.bin': { body, etag: '"v1"' },
    '/encoded.txt': { body: Buffer.from(Buffer.from('a licence text\n').toString('base64')) },
  });
});
after(() => host.close());
beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'pinned-'));
  waits = [];
  lines = [];
  host.requests.length = 0;
});
afterEach(() => rm(cacheDir, { recursive: true, force: true }));

const pin = (path = '/file.bin', bytes = body) => ({
  url: `${host.url}${path}`,
  size: bytes.length,
  sha256: sha256(bytes),
});
const options = (extra = {}) => ({
  cacheDir,
  timeoutMs: 2_000,
  sleep: async (ms) => void waits.push(ms),
  log: (line) => lines.push(line),
  ...extra,
});
const fetched = async (path) => sha256(await readFile(path));

describe('pinned downloads', () => {
  it('resumes a cut-off download from the bytes it has, with If-Range on the ETag', async () => {
    host.next('/file.bin', { dropAfterBytes: 100_000 });
    const path = await pinned(pin(), options());
    assert.equal(await fetched(path), sha256(body));
    const [first, second] = host.requests;
    assert.equal(first.range, undefined);
    assert.match(second.range, /^bytes=\d+-$/);
    assert.ok(Number(/=(\d+)-/.exec(second.range)[1]) > 0, 'the retry asks for the rest, not the start');
    assert.equal(second.ifRange, `"${createHash('md5').update(body).digest('hex')}"`);
    assert.equal(second.status, 206);
    assert.deepEqual(waits, [1_000]);
  });

  it('retries a 503 and a 429 with growing backoff, honouring Retry-After', async () => {
    host.next('/file.bin', { status: 503 });
    host.next('/file.bin', { status: 429, retryAfter: '7' });
    host.next('/file.bin', { status: 502 });
    const path = await pinned(pin(), options());
    assert.equal(await fetched(path), sha256(body));
    assert.deepEqual(waits, [1_000, 7_000, 4_000]);
    assert.equal(host.requests.length, 4);
  });

  it('fails at once on a 404 or a 403, keeping nothing', async () => {
    host.next('/file.bin', { status: 403 });
    await assert.rejects(pinned(pin(), options()), /HTTP 403/);
    await assert.rejects(pinned(pin('/missing.bin'), options()), /HTTP 404/);
    assert.equal(host.requests.length, 2);
    assert.deepEqual(waits, []);
    assert.deepEqual(await readdir(cacheDir), []);
  });

  it('aborts an attempt that stalls and resumes it', async () => {
    host.next('/file.bin', { stallAfterBytes: 50_000 });
    const path = await pinned(pin(), options({ timeoutMs: 300 }));
    assert.equal(await fetched(path), sha256(body));
    assert.match(lines.join('\n'), /no data for 300 ms; attempt 2 of 6 in 1000 ms, resuming at byte \d+/);
    assert.match(host.requests[1].range, /^bytes=\d+-$/);
  });

  it('starts again from zero when the server answers a resume with the whole file', async () => {
    host.next('/file.bin', { dropAfterBytes: 80_000 });
    host.next('/file.bin', { ignoreRange: true });
    const path = await pinned(pin(), options());
    assert.equal(await fetched(path), sha256(body));
    assert.equal(host.requests[1].status, 200);
  });

  it('gives up after its attempts, naming the last error', async () => {
    for (let i = 0; i < 3; i++) host.next('/file.bin', { status: 500 });
    await assert.rejects(pinned(pin(), options({ attempts: 3 })), /HTTP 500 \(gave up after 3 attempts\)/);
    assert.deepEqual(waits, [1_000, 2_000]);
    assert.deepEqual(await readdir(cacheDir), []);
  });

  it('caps the backoff', async () => {
    for (let i = 0; i < 4; i++) host.next('/file.bin', { status: 500, retryAfter: '600' });
    await pinned(pin(), options({ maxBackoffMs: 5_000 }));
    assert.deepEqual(waits, [5_000, 5_000, 5_000, 5_000]);
  });

  it('refuses bytes that do not match the pin, downloading once more whole if it had resumed', async () => {
    const wrong = { ...pin(), sha256: sha256(Buffer.from('something else')) };
    await assert.rejects(pinned(wrong, options()), /sha256 [0-9a-f]{64}, the pin says/);
    assert.equal(host.requests.length, 1);
    host.requests.length = 0;
    host.next('/file.bin', { dropAfterBytes: 10_000 });
    await assert.rejects(pinned(wrong, options()), /sha256 [0-9a-f]{64}, the pin says/);
    assert.deepEqual(
      host.requests.map((r) => r.status),
      [200, 206, 200],
    );
    assert.deepEqual(await readdir(cacheDir), []);
  });

  it('stops a download that runs past the pinned size', async () => {
    const short = { ...pin(), size: 1_000 };
    await assert.rejects(pinned(short, options()), /more than the 1000 bytes the pin says/);
    assert.equal(host.requests.length, 1);
  });

  it('restarts when the file changed under a resume (If-Range no longer matches)', async () => {
    host.next('/moving.bin', { dropAfterBytes: 60_000 });
    const path = await pinned(pin('/moving.bin'), options());
    assert.equal(await fetched(path), sha256(body));
    assert.equal(host.requests[1].ifRange, '"v1"');
  });

  it('decodes a base64-encoded file and pins the decoded bytes', async () => {
    const text = Buffer.from('a licence text\n');
    const path = await pinned({ ...pin('/encoded.txt', text), encoding: 'base64' }, options());
    assert.equal(await readFile(path, 'utf8'), 'a licence text\n');
  });

  it('reads Retry-After as seconds or a date', () => {
    assert.equal(retryAfterMs('3'), 3_000);
    assert.equal(retryAfterMs(new Date(10_000).toUTCString(), 4_000), 6_000);
    assert.equal(retryAfterMs('soon'), undefined);
    assert.equal(retryAfterMs(null), undefined);
  });
});
