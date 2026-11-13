// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { configFrom, loadR2Config, parseEnv } from './credentials.mjs';
import { cacheControl, contentType, noticeFile, objectKey } from './objects.mjs';
import { pinned } from './pinned.mjs';
import { lastJson, paddleCharset } from './recipes.mjs';

const dirs = [];
after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'taalcut-hosting-test-'));
  dirs.push(dir);
  return dir;
};

describe('objects', () => {
  it('keys are <id>/<version>/<file> with safe segments', () => {
    assert.equal(
      objectKey('local-llm-qwen3-5-4b', 'q4_k_m-a9d0a3e1', 'qwen3.5-4b-q4_k_m.gguf'),
      'local-llm-qwen3-5-4b/q4_k_m-a9d0a3e1/qwen3.5-4b-q4_k_m.gguf',
    );
    assert.equal(
      objectKey('reference-fetcher', '2026.08.19', 'source/yt-dlp.tar.gz'),
      'reference-fetcher/2026.08.19/source/yt-dlp.tar.gz',
    );
    for (const bad of ['../x', 'a b', '', '.hidden'])
      assert.throws(() => objectKey('id', '1', bad), /not a key segment/);
  });

  it('serves archives and binaries as types nobody compresses, notices as text, all of them immutable', () => {
    assert.equal(contentType('a/1/x.tar.zst'), 'application/zstd');
    assert.equal(contentType('a/1/x.tgz'), 'application/gzip');
    assert.equal(contentType('a/1/source/crates/smartstring-1.0.1.crate'), 'application/gzip');
    assert.equal(contentType('a/1/source/chromium-1.tar.xz'), 'application/x-xz');
    assert.equal(contentType('a/1/source/eigen-1d8b82b.zip'), 'application/zip');
    assert.equal(contentType('a/1/whisper-cli'), 'application/octet-stream');
    assert.equal(contentType('a/1/NOTICE-0123456789abcdef.txt'), 'text/plain; charset=utf-8');
    assert.equal(cacheControl('a/1/x.gguf'), 'public, max-age=31536000, immutable');
    assert.equal(cacheControl('a/1/NOTICE-0123456789abcdef.txt'), 'public, max-age=31536000, immutable');
  });

  it('names a notice by its content, so a corrected one gets a new key and the same version', () => {
    const sha = createHash('sha256').update('a notice').digest('hex');
    assert.equal(noticeFile(sha), `NOTICE-${sha.slice(0, 16)}.txt`);
    assert.equal(objectKey('deno', '2.9.6', noticeFile(sha)), `deno/2.9.6/NOTICE-${sha.slice(0, 16)}.txt`);
    assert.throws(() => noticeFile('NOTICE'), /not a sha256/);
  });
});

describe('credentials', () => {
  const text = [
    '# R2 upload key',
    'R2_ACCOUNT_ID=acct',
    'export R2_BUCKET="taalcut-components"',
    "R2_PUBLIC_BASE='https://components.taalcut.app'",
    'R2_ACCESS_KEY_ID=AKID',
    'R2_SECRET_ACCESS_KEY=s3cr3t=with=equals',
  ].join('\n');

  it('reads the env file and keeps the secret out of logs and JSON', () => {
    const config = configFrom(parseEnv(text));
    assert.equal(config.bucket, 'taalcut-components');
    assert.equal(config.publicBase, 'https://components.taalcut.app');
    assert.equal(config.secretAccessKey, 's3cr3t=with=equals');
    assert.doesNotMatch(JSON.stringify(config), /s3cr3t/);
    assert.equal(Object.keys(config).includes('secretAccessKey'), false);
  });

  it('names the empty fields, never a value', () => {
    assert.throws(
      () => configFrom(parseEnv('R2_ACCOUNT_ID=acct\nR2_ACCESS_KEY_ID=\nR2_SECRET_ACCESS_KEY=')),
      (error) => {
        assert.match(error.message, /R2_BUCKET, R2_PUBLIC_BASE, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY/);
        assert.doesNotMatch(error.message, /acct/);
        return true;
      },
    );
  });

  it('refuses a file others can read', async () => {
    const path = join(await temp(), 'r2.env');
    await writeFile(path, text);
    await chmod(path, 0o644);
    await assert.rejects(loadR2Config(path), /readable by others/);
    await chmod(path, 0o600);
    assert.equal((await loadR2Config(path)).accessKeyId, 'AKID');
  });
});

describe('pinned', () => {
  const bytes = Buffer.from('pinned bytes');
  const pin = {
    url: 'https://example.invalid/f',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };

  it('downloads once into the sha256 cache', async () => {
    const cacheDir = await temp();
    let calls = 0;
    const fetch = async () => (calls++, new Response(bytes));
    const path = await pinned(pin, { cacheDir, fetch });
    assert.equal(path, join(cacheDir, pin.sha256));
    assert.equal(await pinned(pin, { cacheDir, fetch }), path);
    assert.equal(calls, 1);
  });

  it('keeps nothing that does not match the pin', async () => {
    const cacheDir = await temp();
    const fetch = async () => new Response(Buffer.from('other bytes!'));
    await assert.rejects(pinned(pin, { cacheDir, fetch }), /sha256 [0-9a-f]{64}, the pin says/);
    assert.deepEqual(await readdir(cacheDir), []);
    await assert.rejects(
      pinned(pin, { cacheDir, fetch: async () => new Response('x', { status: 404 }) }),
      /HTTP 404/,
    );
  });
});

describe('recipe helpers', () => {
  it("writes PaddleOCR's character list as vision reads it", () => {
    const yml = [
      'PostProcess:',
      '  character_dict:',
      "  - '!'",
      "  - ''''",
      '  - $',
      '  - \\',
      '  - "\\t"',
      '  - ॿ',
      'Other: 1',
    ].join('\n');
    assert.equal(paddleCharset(yml), '["!", "\'", "$", "\\\\", "\\t", "ॿ"]');
    assert.throws(() => paddleCharset('PostProcess:\n'), /no character_dict/);
    assert.throws(() => paddleCharset('character_dict:\nnext: 1'), /empty/);
  });

  it('finds the summary a pack script prints last', () => {
    assert.deepEqual(lastJson('building…\n{"archive":"/a.tar.zst","sha256":"x"}\n'), {
      archive: '/a.tar.zst',
      sha256: 'x',
    });
    assert.deepEqual(lastJson('log\n{\n  "version": "1.0.0",\n  "archive": "/s.tar.zst"\n}\n'), {
      version: '1.0.0',
      archive: '/s.tar.zst',
    });
    assert.throws(() => lastJson('no json here\n'), /no JSON summary/);
  });
});
