// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The on-disk ArtifactStore: content-addressed files, redaction, size caps, retention, recovery. */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId, unwrap, ValidationError, type ArtifactId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  ArtifactsUnavailable,
  ArtifactTooLarge,
  createArtifactStore,
  createLibraryPorts,
  findSecrets,
  scanForSecrets,
  type ArtifactStoreOptions,
} from '../../src/index';
import { fakeClock, openTestDb, tempDir } from '../helpers';

const DAY = 24 * 60 * 60 * 1000;
const SECRET = `sk-proj-${'A1b2C3d4'.repeat(5)}`;

function setup(options: ArtifactStoreOptions = {}) {
  const clock = fakeClock();
  const db = openTestDb({ clock: clock.now });
  const dir = join(tempDir(), 'artifacts');
  const store = createArtifactStore(db, { dir, ...options });
  /** Every content file on disk, by hash. */
  const files = () =>
    existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .flatMap((e) => readdirSync(join(dir, e.name)))
          .sort()
      : [];
  return { db, clock, dir, store, files };
}

const text = (size: number, fill = 'x') => fill.repeat(size);

describe('artifact store (library)', () => {
  it('stores bytes once by content and returns them by id', async () => {
    const { store, files } = setup();
    const a = unwrap(
      await store.put({ mediaType: 'application/json', data: '{"shots":[1,2]}', summary: '2 shots' }),
    );
    const b = unwrap(
      await store.put({ mediaType: 'application/json', data: '{"shots":[1,2]}', summary: 'again' }),
    );
    expect(a).toMatchObject({ mediaType: 'application/json', bytes: 15, summary: '2 shots' });
    expect(a.id).not.toBe(b.id);
    expect(files()).toHaveLength(1);
    const got = unwrap(await store.get(a.id));
    expect(got.ref).toEqual(a);
    expect(new TextDecoder().decode(got.data)).toBe('{"shots":[1,2]}');
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01]);
    const image = unwrap(await store.put({ mediaType: 'image/jpeg', data: jpeg, summary: 'contact sheet' }));
    expect(unwrap(await store.get(image.id)).data).toEqual(jpeg);
    expect(store.usage()).toEqual({ bytes: 20, artifacts: 3 });
  });

  it('redacts the summary and text content, never binary', async () => {
    const { store, db } = setup();
    const json = unwrap(
      await store.put({
        mediaType: 'application/json; charset=utf-8',
        data: new TextEncoder().encode(`{"headers":{"authorization":"Bearer ${SECRET}"}}`),
        summary: `Fetched with ${SECRET}`,
      }),
    );
    expect(json.summary).toBe('Fetched with [redacted:api_key]');
    const stored = new TextDecoder().decode(unwrap(await store.get(json.id)).data);
    expect(findSecrets(stored)).toEqual([]);
    expect(stored).toContain('[redacted');
    const bytes = new TextEncoder().encode(SECRET);
    const binary = unwrap(
      await store.put({ mediaType: 'application/octet-stream', data: bytes, summary: 'raw' }),
    );
    expect(unwrap(await store.get(binary.id)).data).toEqual(bytes);
    // Nothing secret in the database; the only secret file is the binary one.
    db.close();
    const report = scanForSecrets({ databasePath: db.path, logFiles: [] });
    expect(report.findings).toEqual([]);
  });

  it('refuses an artifact over the per-artifact cap and a bad media type', async () => {
    const { store, files } = setup({ maxArtifactBytes: 10 });
    const big = await store.put({ mediaType: 'text/plain', data: text(11), summary: 'big' });
    expect(!big.ok && ArtifactTooLarge.is(big.error)).toBe(true);
    const bad = await store.put({ mediaType: 'not a type', data: 'x', summary: 's' });
    expect(!bad.ok && ValidationError.is(bad.error)).toBe(true);
    expect(files()).toEqual([]);
  });

  it('evicts the least recently used artifacts to keep files under the total cap', async () => {
    const { store, clock, files } = setup({ maxArtifactBytes: 100, maxTotalBytes: 250 });
    const put = async (fill: string) => {
      clock.advance(1000);
      return unwrap(await store.put({ mediaType: 'text/plain', data: text(100, fill), summary: fill }));
    };
    const a = await put('a');
    const b = await put('b');
    clock.advance(1000);
    unwrap(await store.get(a.id)); // a is now newer than b
    const c = await put('c');
    expect((await store.get(b.id)).ok).toBe(false);
    expect((await store.get(a.id)).ok).toBe(true);
    expect((await store.get(c.id)).ok).toBe(true);
    expect(files()).toHaveLength(2);
    expect(store.usage().bytes).toBeLessThanOrEqual(250);
  });

  it('removes artifacts unused past retention, and stray files on prune', async () => {
    const { store, clock, dir, files } = setup({ maxAgeMs: 7 * DAY });
    const old = unwrap(await store.put({ mediaType: 'text/plain', data: 'old', summary: 'old' }));
    clock.advance(8 * DAY);
    const fresh = unwrap(await store.put({ mediaType: 'text/plain', data: 'fresh', summary: 'fresh' }));
    expect((await store.get(old.id)).ok).toBe(false);
    expect((await store.get(fresh.id)).ok).toBe(true);
    // A crash mid-put leaves a temp file and maybe an unreferenced content file.
    writeFileSync(join(dir, '.tmp-crashed'), 'partial');
    mkdirSync(join(dir, 'ff'), { recursive: true });
    writeFileSync(join(dir, 'ff', 'f'.repeat(64)), 'x');
    expect(files()).toHaveLength(2);
    unwrap(store.prune());
    expect(files()).toHaveLength(1);
    expect(existsSync(join(dir, '.tmp-crashed'))).toBe(false);
    expect(unwrap(store.remove(fresh.id))).toBe(true);
    expect(files()).toEqual([]);
    expect(unwrap(store.remove(fresh.id))).toBe(false);
  });

  it('reports a missing or tampered file as not found, and unknown ids without echoing them', async () => {
    const { store, dir } = setup();
    const ref = unwrap(await store.put({ mediaType: 'text/plain', data: 'hello', summary: 'hi' }));
    const [sub] = readdirSync(dir).filter((d) => /^[0-9a-f]{2}$/.test(d));
    const [file] = readdirSync(join(dir, sub!));
    writeFileSync(join(dir, sub!, file!), 'tampered');
    const tampered = await store.get(ref.id);
    expect(!tampered.ok && tampered.error.code).toBe('core.not_found');
    const unknown = await store.get(SECRET as ArtifactId);
    expect(JSON.stringify(unknown)).not.toContain(SECRET);
    expect((await store.get(newId<'Artifact'>())).ok).toBe(false);
    expect(readFileSync(join(dir, sub!, file!), 'utf8')).toBe('tampered');
  });

  it('comes with createLibraryPorts, next to the database, and needs a folder for an in-memory one', async () => {
    const db = openTestDb();
    const ports = createLibraryPorts(db);
    const ref = unwrap(await ports.artifacts.put({ mediaType: 'text/plain', data: 'x', summary: 's' }));
    expect(unwrap(await ports.artifacts.get(ref.id)).ref).toEqual(ref);
    expect(existsSync(join(db.path, '..', 'artifacts'))).toBe(true);
    const memory = createLibraryPorts(openTestDb({ file: false }));
    const refused = await memory.artifacts.put({ mediaType: 'text/plain', data: 'x', summary: 's' });
    expect(!refused.ok && ArtifactsUnavailable.is(refused.error)).toBe(true);
  });
});
