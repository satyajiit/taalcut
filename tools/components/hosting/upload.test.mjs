// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { r2Client } from './r2.mjs';
import { fakeS3 } from './test-servers.mjs';
import { selectObjects, upload } from './upload.mjs';
import { uploadObject } from './upload-object.mjs';

const credentials = { accessKeyId: 'AKIDTEST', secretAccessKey: 'not-a-real-secret' };
const bucket = 'taalcut-components';
let s3;
let dir;
const noSleep = () => Promise.resolve();

before(async () => {
  s3 = await fakeS3({ bucket, credentials });
  dir = await mkdtemp(join(tmpdir(), 'taalcut-upload-test-'));
});
after(async () => {
  await s3.close();
  await rm(dir, { recursive: true, force: true });
});

const client = () => r2Client({ ...credentials, bucket, endpoint: s3.url }, { sleep: noSleep });

async function object(key, bytes, extra = {}) {
  const path = join(dir, key.replaceAll('/', '_'));
  await writeFile(path, bytes);
  return {
    key,
    path,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    contentType: 'application/octet-stream',
    cacheControl: 'public, max-age=31536000, immutable',
    ...extra,
  };
}

describe('uploadObject', () => {
  it('uploads with the headers and sha256 metadata, then skips the same bytes', async () => {
    const o = await object('silero-vad/6.2.3/silero_vad.onnx', Buffer.from('weights'));
    assert.equal(await uploadObject(client(), o), 'uploaded');
    const stored = s3.objects.get(o.key);
    assert.equal(stored.body.toString(), 'weights');
    assert.equal(stored.meta['x-amz-meta-sha256'], o.sha256);
    assert.equal(stored.meta['cache-control'], o.cacheControl);
    assert.equal(await uploadObject(client(), o), 'present');
  });

  it('never replaces a hosted file with other bytes', async () => {
    const o = await object('beat-this/1/beat.tar.zst', Buffer.from('one'));
    await uploadObject(client(), o);
    const changed = await object('beat-this/1/beat.tar.zst', Buffer.from('two'));
    await assert.rejects(uploadObject(client(), changed), /never changes; give the component a new version/);
    assert.equal(s3.objects.get(o.key).body.toString(), 'one');
  });

  it('never replaces a NOTICE.txt either: the manifest pins its size and sha256', async () => {
    const first = await object('deno/2.9.6/NOTICE.txt', Buffer.from('old'), {
      contentType: 'text/plain; charset=utf-8',
    });
    await uploadObject(client(), first);
    const fixed = {
      ...(await object('deno/2.9.6/NOTICE.txt', Buffer.from('new'))),
      contentType: first.contentType,
    };
    await assert.rejects(uploadObject(client(), fixed), /never changes; give the component a new version/);
    assert.equal(s3.objects.get(fixed.key).body.toString(), 'old');
    assert.equal(await uploadObject(client(), first), 'present');
  });

  it('uploads a large file in parts, in order, and survives a transient 500', async () => {
    const bytes = randomBytes(5000);
    const o = await object('local-llm-qwen3-5-4b/v/qwen.gguf', bytes);
    s3.faults.push(500);
    const parts = [];
    assert.equal(
      await uploadObject(client(), o, { partSize: 1024, concurrency: 3, log: (line) => parts.push(line) }),
      'uploaded',
    );
    assert.deepEqual(s3.objects.get(o.key).body, bytes);
    assert.equal(parts.length, 5);
    assert.equal(s3.uploads.size, 0);
  });

  it('aborts the multipart upload when a part fails for good', async () => {
    const o = await object('whisper-medium-q5-0/v/ggml.bin', randomBytes(3000));
    const failing = r2Client(
      { ...credentials, bucket, endpoint: s3.url },
      {
        sleep: noSleep,
        fetch: (url, init) =>
          init.method === 'PUT' && url.includes('partNumber=2')
            ? Promise.reject(new Error('socket hang up'))
            : fetch(url, init),
      },
    );
    await assert.rejects(uploadObject(failing, o, { partSize: 1024, concurrency: 1 }), /socket hang up/);
    assert.equal(s3.uploads.size, 0, 'the upload was aborted');
    assert.equal(s3.objects.has(o.key), false);
  });

  it('refuses a signature R2 would refuse', async () => {
    const wrong = r2Client(
      { ...credentials, secretAccessKey: 'wrong', bucket, endpoint: s3.url },
      { sleep: noSleep },
    );
    const o = await object('x/1/y.bin', Buffer.from('z'));
    await assert.rejects(uploadObject(wrong, o), /HEAD .*: HTTP 403/);
  });
});

describe('upload', () => {
  it('uploads only the named components and checks the bucket serves the release base', async () => {
    const a = await object('transnetv2/v/transnetv2.onnx', Buffer.from('a'));
    const b = await object('sfx-pack/1.0.0/sfx-pack.tar.zst', Buffer.from('b'));
    const release = {
      base: 'https://components.taalcut.app',
      components: [{ id: 'transnetv2' }, { id: 'sfx-pack' }],
      objects: [a, b],
    };
    assert.deepEqual(selectObjects(release, new Set(['sfx-pack'])), [b]);
    assert.throws(() => selectObjects(release, new Set(['nope'])), /not in release.json: nope/);
    const log = [];
    const results = await upload({
      release,
      only: new Set(['sfx-pack']),
      client: client(),
      publicBase: 'https://components.taalcut.app/',
      log: (l) => log.push(l),
    });
    assert.deepEqual(
      results.map((r) => r.result),
      ['uploaded'],
    );
    await assert.rejects(
      upload({ release, only: new Set(), client: client(), publicBase: 'https://elsewhere.example' }),
      /release.json is for https:\/\/components.taalcut.app/,
    );
    const signed = {
      ...release,
      components: [
        ...release.components,
        { id: 'c2pa-sidecar', version: '1.0.0', machO: 1, sha256: b.sha256 },
      ],
    };
    await assert.rejects(
      upload({ release: signed, only: new Set(), client: client(), publicBase: release.base }),
      /c2pa-sidecar 1.0.0 is not notarised/,
    );
    const dry = await upload({
      release: signed,
      only: new Set(),
      dryRun: true,
      client: client(),
      publicBase: release.base,
      log: () => {},
    });
    assert.deepEqual(
      dry.map((r) => r.result.split(' ')[0]),
      ['to', 'present'],
    );
  });
});
