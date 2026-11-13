// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-G2 with the real models: `sfx.searchSounds`'s job (`searchSounds` on the jobs process's listen service) over
 * the built SFX bank, first with an empty derived cache (the bank's titles are embedded: a machine's first search),
 * then on a fresh service over the same cache (an app restart: the titles are read back, only the query is
 * embedded), and after the `bankTitles` warm-up. The hits are the same each time. Needs `TAALCUT_EAR1_MODELS` and a
 * built bank (`TAALCUT_SFX_BANK`, default `.cache/packs/sfx-bank`); dtype `TAALCUT_LISTEN_DTYPE` (default fp16).
 * Run this file alone for the numbers to record.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { err, NotFoundError, ok } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { afterAll, describe, expect, it } from 'vitest';
import type { DerivedJson } from '../../src/cleanup/speech-files';
import { createListenService, type ListenService } from '../../src/listen/analysis/service';
import { directoryListenFiles } from '../../src/listen/models/files';
import type { SearchSoundsResult } from '../../src/listen/search/queries';
import { HAS_BANK, INSTALLED_BANK } from '../sfx-bank-helpers';
import { MODELS } from './models-helpers';

const dtype = process.env.TAALCUT_LISTEN_DTYPE === 'int8' ? 'int8' : 'fp16';
const QUERIES = ['a deep cinematic boom', 'a soft rounded pop', 'a fast whoosh', 'a single key click'];

/** Derived JSON in a folder, as the desktop's cacheJson keeps it in media's cache. */
function folderJson(root: string): DerivedJson {
  return {
    async read(key) {
      try {
        return ok(JSON.parse(await readFile(join(root, key), 'utf8')) as unknown);
      } catch {
        return err(NotFoundError({ entity: 'derived file', id: key }));
      }
    },
    async write(key, json) {
      await mkdir(dirname(join(root, key)), { recursive: true });
      await writeFile(join(root, key), JSON.stringify(json));
      return ok(undefined);
    },
  };
}

const start = (json: DerivedJson): ListenService =>
  createListenService({
    // No sources to decode: the search reads the bank's shipped rows.
    media: async () => ok({} as MediaContext),
    files: directoryListenFiles(MODELS ?? '', dtype),
    json,
  });

async function timed(service: ListenService, query: string) {
  const t0 = performance.now();
  const found = await service.query('searchSounds', [], { query, bankDir: INSTALLED_BANK, top: 8 });
  const ms = performance.now() - t0;
  if (!found.ok) throw new Error(`${found.error.code}: ${found.error.detail ?? ''}`);
  return { ms, ids: (found.value as SearchSoundsResult).hits.map((h) => h.id) };
}

const root = await mkdtemp(join(tmpdir(), 'taalcut-titles-e2e-'));
afterAll(() => rm(root, { recursive: true, force: true }));

describe.skipIf(!MODELS || !HAS_BANK)(`the bank titles cache with the real models (${dtype})`, () => {
  it('only the first search on a machine embeds the titles', { timeout: 600_000 }, async () => {
    const json = folderJson(join(root, 'cache'));
    const first = start(json);
    const cold = await timed(first, QUERIES[0] ?? '');
    const inProcess = [];
    for (const query of QUERIES.slice(1)) inProcess.push(await timed(first, query));
    await first.release();

    // An app restart: a new service (new sessions, nothing in memory) over the same cache.
    const restarted = start(json);
    const warm = await timed(restarted, QUERIES[0] ?? '');
    const again = await timed(restarted, QUERIES[1] ?? '');
    await restarted.release();

    // A fresh machine whose jobs process warmed the titles after the installs.
    const fresh = start(folderJson(join(root, 'warmed')));
    const t0 = performance.now();
    const warmed = await fresh.query('bankTitles', [], { bankDir: INSTALLED_BANK });
    const warmUp = performance.now() - t0;
    const afterWarmUp = await timed(fresh, QUERIES[0] ?? '');
    await fresh.release();

    const f = (ms: number) => `${ms.toFixed(0)} ms`;
    console.warn(
      `bank titles (${dtype}): first search cold ${f(cold.ms)}; same process ${inProcess.map((r) => f(r.ms)).join(', ')}; ` +
        `after a restart first ${f(warm.ms)}, next ${f(again.ms)}; ` +
        `warm-up ${f(warmUp)} (${warmed.ok ? JSON.stringify(warmed.value) : warmed.error.code}), then first search ${f(afterWarmUp.ms)}`,
    );
    expect(warm.ids).toEqual(cold.ids);
    expect(afterWarmUp.ids).toEqual(cold.ids);
    // The titles are most of a cold search: a restart's first search skips them.
    expect(warm.ms).toBeLessThan(cold.ms / 2);
  });
});
