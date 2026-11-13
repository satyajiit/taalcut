// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** One asset in full, sources, storage and the library namespace over a port (P2-L1). */
import { MessageChannel } from 'node:worker_threads';
import {
  assetDetailSchema,
  connectRpc,
  libraryContract,
  err,
  NotFoundError,
  ok,
  serveRpc,
  sourceViewSchema,
  unwrap,
  type AssetId,
  type SearchResult,
} from '@taalcut/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assetDetail,
  createLibraryService,
  libraryRouter,
  libraryStorage,
  sourceViews,
  StockUnavailable,
} from '../../src/index';
import { openTestDb, tempDir } from '../helpers';
import { analysisFor, factsFor, profileSetup, range24, transcriptOf } from '../repositories/profile-helpers';

const ports: MessageChannel[] = [];
afterEach(() => ports.splice(0).forEach((c) => (c.port1.close(), c.port2.close())));

function detailed() {
  const setup = profileSetup();
  const { repos, db } = setup;
  const id = setup.asset({ name: 'Goa sunset.mov' });
  unwrap(repos.assets.setFacts(id, factsFor()));
  unwrap(repos.assets.setLanguage(id, 'hi'));
  const [a, b] = unwrap(repos.shots.replaceForAsset(id, 0, [range24(0, 48), range24(48, 48)]));
  const signals = { version: 2, motionCurve: [0.5], sharpnessCurve: [0.9], motionPeakFrames: [3] };
  unwrap(repos.shots.putAnalyses([{ shotId: a!, analysis: { ...analysisFor(range24(0, 48)), signals } }]));
  unwrap(repos.transcripts.put(id, transcriptOf('hi', [['समुद्र तट पर सूर्यास्त', 0, 1500]]), 0));
  db.driver
    .prepare(
      `INSERT INTO asset_index_stages (asset_id, stage, state, error, reason_key, updated_at) VALUES
        (?, 'library.hash', 'done', NULL, NULL, 1), (?, 'vision.analyse', 'failed', ?, NULL, 1),
        (?, 'audio.transcript', 'skipped', NULL, 'indexing.skip.silent', 1),
        (?, 'vision.embed', 'waiting', NULL, 'library.stage.modelMissing', 1)`,
    )
    .run(
      id,
      id,
      JSON.stringify({
        code: 'vision.model_failed',
        messageKey: 'errors.vision.model_failed',
        retryable: true,
      }),
      id,
      id,
    );
  db.driver
    .prepare(`UPDATE assets SET reencode = 'likely', reencode_reasons = ? WHERE id = ?`)
    .run(JSON.stringify(['ios-browser', 'h264-aac', 'not-a-signal']), id);
  return { ...setup, id, shots: [a!, b!] };
}

describe('assetDetail', () => {
  it('reads the profile together: facts, shots, transcript, locations, stages, re-encode reasons', () => {
    const { db, id, shots } = detailed();
    const detail = unwrap(assetDetail(db, id));
    expect(assetDetailSchema.safeParse({ ...detail, waveform: null }).success).toBe(true);
    expect(detail.asset).toMatchObject({
      name: 'Goa sunset.mov',
      orientation: 'portrait',
      language: 'hi',
      shotCount: 2,
      description: 'Golden sunset over the beach',
      quality: 0.75,
      reencode: 'likely',
      index: { state: 'failed', done: 2, total: 4 },
    });
    expect(detail.facts?.captureTime).toBe('2025-10-20T19:30:00+05:30');
    expect(detail.shots.map((s) => s.id)).toEqual(shots);
    expect(detail.shots[0]).toMatchObject({
      shotType: 'wide',
      motion: 'pan',
      transcriptText: 'समुद्र तट पर सूर्यास्त',
    });
    // Casting's curves stay in the library: the page and the agent's getAsset never show them.
    expect(detail.shots[0]?.analysis).not.toHaveProperty('signals');
    expect(detail.shots[1]?.analysis).toBeNull();
    expect(detail.transcript).toMatchObject({
      language: 'hi',
      truncated: false,
      lines: [{ text: 'समुद्र तट पर सूर्यास्त' }],
    });
    expect(detail.locations).toMatchObject([
      { sourceName: 'Goa trip', storage: 'referenced', state: 'present' },
    ]);
    expect(detail.reencodeReasons).toEqual(['ios-browser', 'h264-aac']);
    // In pipeline order (UX2: the clip page lists them so), not by name.
    expect(detail.stages).toEqual([
      { stage: 'library.hash', state: 'done' },
      {
        stage: 'vision.analyse',
        state: 'failed',
        error: { code: 'vision.model_failed', messageKey: 'errors.vision.model_failed', retryable: true },
      },
      { stage: 'vision.embed', state: 'waiting', reasonKey: 'library.stage.modelMissing' },
      { stage: 'audio.transcript', state: 'skipped', reasonKey: 'indexing.skip.silent' },
    ]);
    const missing = assetDetail(db, 'nope' as AssetId);
    expect(!missing.ok && NotFoundError.is(missing.error)).toBe(true);
  });

  it('lists sources with counts and scan state, and the storage', async () => {
    const { db, repos, sourceId, asset } = detailed();
    asset({ state: 'missing' });
    unwrap(
      repos.sources.update(sourceId, {
        scanState: 'error',
        scanError: {
          code: 'library.folder_permission_denied',
          messageKey: 'errors.library.folder_permission_denied',
          retryable: false,
        },
      }),
    );
    const [view] = sourceViews(db);
    expect(sourceViewSchema.safeParse(view).success).toBe(true);
    expect(view).toMatchObject({
      name: 'Goa trip',
      path: '/Users/me/Goa',
      watch: true,
      assets: 2,
      missing: 1,
      scan: { state: 'error', error: { code: 'library.folder_permission_denied' } },
    });
    const root = tempDir();
    const storage = unwrap(
      await libraryStorage(openTestDb(), { originalsRoot: root, volumeName: 'Macintosh HD' }),
    );
    expect(storage.originalsRoot).toMatchObject({
      path: root,
      online: true,
      volumeName: 'Macintosh HD',
      usedBytes: 0,
    });
    expect(storage.originalsRoot.freeBytes).toBeGreaterThan(0);
    expect(storage.catalogBytes).toBeGreaterThan(0);
    const gone = unwrap(await libraryStorage(db, { originalsRoot: `${root}/unplugged` }));
    expect(gone.originalsRoot).toMatchObject({ online: false, freeBytes: null });
  });

  it('serves the library namespace over a port', async () => {
    const { db, id, shots } = detailed();
    const result: SearchResult = { hits: [], tookMs: 1 };
    const calls: unknown[] = [];
    const service = createLibraryService({
      db,
      waveform: async () => null,
      originalsRoot: () => ({ path: tempDir() }),
      search: {
        search: async (...args) => (calls.push(['search', ...args]), ok(result)),
        findSimilar: async (...args) => (calls.push(['similar', ...args]), ok(result)),
      },
      http: {
        get: async () => err(StockUnavailable({ provider: 'pexels' })),
        stream: async () => err(StockUnavailable({ provider: 'pexels' })),
      },
      credentials: { get: async () => ok(null) },
      localOnly: () => false,
    });
    const channel = new MessageChannel();
    ports.push(channel);
    serveRpc(libraryRouter(service), channel.port1, { context: {} });
    const client = connectRpc(libraryContract, channel.port2, { peer: 'agent' }).client;
    const page = await client.browse({});
    expect(page.items.map((i) => i.id)).toEqual([id]);
    expect((await client.asset({ assetId: id })).shots).toHaveLength(2);
    expect(await client.transcript({ assetId: id })).toMatchObject({ language: 'hi', segments: [{}] });
    expect(await client.sources()).toHaveLength(1);
    expect((await client.storage()).originalsRoot.online).toBe(true);
    expect(await client.search({ query: 'sunset' })).toEqual(result);
    await client.findSimilar({ shotId: shots[0]! });
    expect(calls).toEqual([
      ['search', 'sunset', undefined, 30],
      ['similar', shots[0], undefined, 30, true],
    ]);
    await expect(client.asset({ assetId: '01JAAAAAAAAAAAAAAAAAAAAAAA' as AssetId })).rejects.toMatchObject({
      data: { code: 'core.not_found' },
    });
  });
});
