// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { releaseIfUnchanged, sha512Of, snapshotOf } from '../src/main/update/snapshot';
import { serveToSquirrel } from '../src/main/update/squirrel-feed';

const sha512 = (bytes: Buffer) => createHash('sha512').update(bytes).digest('hex');

let root: string;
let download: string;
// Several stream chunks, so the last one is held back.
const BYTES = randomBytes(300 * 1024);
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'taalcut-snapshot-'));
  download = join(root, 'download.zip');
  writeFileSync(download, BYTES);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('snapshotOf', () => {
  it('copies the download into a private folder and hashes what it wrote', async () => {
    const snapshot = await snapshotOf(download, root);
    expect(readFileSync(snapshot.path).equals(BYTES)).toBe(true);
    expect(snapshot).toMatchObject({ size: BYTES.length, sha512: sha512(BYTES) });
    expect(await sha512Of(snapshot.path)).toBe(snapshot.sha512);
    expect(statSync(dirname(snapshot.path)).mode & 0o777).toBe(0o700);
    expect(statSync(snapshot.path).mode & 0o777).toBe(0o600);
    await snapshot.dispose();
    expect(() => statSync(dirname(snapshot.path))).toThrow();
  });
});

describe('releaseIfUnchanged', () => {
  async function pass(bytes: Buffer, expected: Buffer): Promise<{ out: Buffer; error?: unknown }> {
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        chunks.push(chunk);
        done();
      },
    });
    const source = Readable.from([bytes.subarray(0, 1000), bytes.subarray(1000, 5000), bytes.subarray(5000)]);
    const error = await pipeline(
      source,
      releaseIfUnchanged({ size: expected.length, sha512: sha512(expected) }),
      sink,
    ).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    return { out: Buffer.concat(chunks), error };
  }

  it('lets every byte through when they match', async () => {
    const bytes = randomBytes(8000);
    expect(await pass(bytes, bytes)).toEqual({ out: bytes, error: undefined });
  });

  it('withholds the last chunk and fails when they do not', async () => {
    const bytes = randomBytes(8000);
    const other = Buffer.from(bytes);
    other.writeUInt8(other.readUInt8(7999) ^ 1, 7999);
    const { out, error } = await pass(other, bytes);
    expect(String(error)).toContain('the update changed after it was verified');
    expect(out.length).toBeLessThan(bytes.length);
  });
});

describe('serveToSquirrel', () => {
  it("answers Squirrel's feed request with the zip's URL, and serves exactly the snapshot", async () => {
    const snapshot = await snapshotOf(download, root);
    const feed = await serveToSquirrel(snapshot);
    try {
      expect(feed.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{64}\/feed$/);
      const answer = (await (await fetch(feed.url)).json()) as { url: string };
      expect(answer.url).toBe(feed.url.replace(/feed$/, 'update.zip'));
      // The cache file changing no longer matters: the snapshot is served.
      writeFileSync(download, 'an older Taalcut');
      const zip = await fetch(answer.url);
      expect(zip.headers.get('content-length')).toBe(String(BYTES.length));
      expect(Buffer.from(await zip.arrayBuffer()).equals(BYTES)).toBe(true);
      expect((await fetch(new URL('/feed', feed.url))).status).toBe(404);
      expect((await fetch(answer.url, { method: 'POST' })).status).toBe(405);
      const head = await fetch(answer.url, { method: 'HEAD' });
      expect([head.status, head.headers.get('content-length')]).toEqual([200, String(BYTES.length)]);
    } finally {
      feed.close();
      await snapshot.dispose();
    }
  });

  it('cuts the download short if the snapshot changed after verification', async () => {
    const snapshot = await snapshotOf(download, root);
    const feed = await serveToSquirrel(snapshot);
    try {
      const tampered = Buffer.from(BYTES);
      tampered.writeUInt8(tampered.readUInt8(0) ^ 1, 0);
      writeFileSync(snapshot.path, tampered);
      const answer = (await (await fetch(feed.url)).json()) as { url: string };
      const zip = await fetch(answer.url);
      await expect(zip.arrayBuffer()).rejects.toThrow();
    } finally {
      feed.close();
      await snapshot.dispose();
    }
  });
});
