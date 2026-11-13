// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Render's ports in a process: the library's stores registered once (kept
 * when the library's agent wiring got there first), and render.export's
 * snapshot as an `export` version with a label the versions table accepts.
 */
import { describe, expect, it } from 'vitest';
import {
  createContainer,
  FrameRates,
  newId,
  ok,
  RationalTime,
  RenderStoreToken,
  TimelineStoreToken,
  TimeRange,
  unwrap,
  type RenderStore,
  type TimelineStore,
} from '@taalcut/core';
import { createRepositories, openDatabase, type LibraryTimelineStore } from '@taalcut/library';
import {
  registerRenderPorts,
  renderAssetFiles,
  renderTranscripts,
  snapshotExport,
} from '../src/shared/render-ports';
import type { UtilityConfig } from '../src/shared/rpc-ipc';
import { LibraryDatabaseToken, UtilityConfigToken } from '../src/shared/tokens';

const store = (versions?: Partial<LibraryTimelineStore['versions']>) =>
  ({ ...(versions ? { versions } : {}) }) as unknown as TimelineStore;

describe('render ports', () => {
  it("keeps the stores a process registered before (the library agent's)", () => {
    const timelines = store();
    const renders = {} as RenderStore;
    const root = createContainer().value(TimelineStoreToken, timelines).value(RenderStoreToken, renders);
    registerRenderPorts(root);
    expect(root.resolve(TimelineStoreToken)).toBe(timelines);
    expect(root.resolve(RenderStoreToken)).toBe(renders);
  });

  it("keeps the exported revision as an export version, its label cut to the table's 100 characters", async () => {
    const calls: unknown[] = [];
    const snapshot = (input: unknown) => {
      calls.push(input);
      return ok(null);
    };
    const root = createContainer().value(TimelineStoreToken, store({ snapshot }));
    const timelineId = newId<'Timeline'>();
    const label = `  ${'é'.repeat(98)}😀😀 – YouTube Shorts`;
    expect((await snapshotExport(root)({ timelineId, revision: 4, label })).ok).toBe(true);
    expect(calls).toEqual([{ timelineId, kind: 'export', revision: 4, label: `${'é'.repeat(98)}😀` }]);
  });

  it('keeps nothing (and refuses nothing) when the store has no versions', async () => {
    const root = createContainer().value(TimelineStoreToken, store());
    const kept = await snapshotExport(root)({ timelineId: newId<'Timeline'>(), revision: 1, label: 'Trip' });
    expect(kept).toEqual(ok(null));
  });

  it('resolves proxy paths under media-cache and reads stored transcripts from the library', async () => {
    const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const userData = mkdtempSync(join(tmpdir(), 'taalcut-render-ports-'));
    const db = unwrap(openDatabase({ path: ':memory:' }));
    try {
      const repos = createRepositories(db);
      const hash = 'a'.repeat(64);
      const asset = unwrap(
        repos.assets.create({ kind: 'video', sizeBytes: 100, originalFilename: 'clip.mov', contentHash: hash }),
      );
      const key = `proxies/aa/${hash}.v1.mp4`;
      const proxyPath = join(userData, 'media-cache', key);
      mkdirSync(join(userData, 'media-cache', 'proxies', 'aa'), { recursive: true });
      writeFileSync(proxyPath, 'proxy');
      unwrap(
        repos.derivedFiles.put(asset.id, [
          { kind: 'proxy', key, bytes: 5, mimeType: 'video/mp4', recipe: 1, width: 540, height: 960 },
        ]),
      );
      const rate = FrameRates.fps30;
      const range = TimeRange.of(RationalTime.of(0, rate), RationalTime.of(30, rate));
      unwrap(
        repos.transcripts.put(
          asset.id,
          {
            version: 1,
            language: 'en',
            segments: [{ range, text: 'hello world', words: [{ text: 'hello', range }], language: 'en' }],
            engine: 'whisper',
            model: 'whisper-small-q8_0',
            local: true,
            wordTiming: 'native',
          },
          0,
        ),
      );
      const root = createContainer()
        .value(LibraryDatabaseToken, db)
        .value(UtilityConfigToken, { userData } as UtilityConfig);
      expect(unwrap(await renderAssetFiles(root).proxy(asset.id))).toBe(proxyPath);
      expect(unwrap(await renderTranscripts(root).transcript(asset.id))?.segments[0]?.text).toBe('hello world');
    } finally {
      db.close();
      rmSync(userData, { recursive: true, force: true });
    }
  });
});
