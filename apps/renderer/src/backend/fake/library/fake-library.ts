// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- sample volume names and paths: data, never translated */

/**
 * The library lane's namespaces as the renderer's fake serves them
 * (`library`, `indexing`) plus the two library commands the cards need
 * (`library.addSource`, `library.removeSource`) and the clip page's (clip-commands.ts). The real ones are
 * @taalcut/library's; this one is a seeded, in-memory library of 5,000 clips
 * by default, so the grid, search and the clip page run without a backend.
 */
import {
  defineCommand,
  libraryCommandPayloads,
  ok,
  type AnyCommand,
  type EventBus,
  type Id,
  type IndexingStatus,
  type LibraryFilters,
  type SearchHit,
  toRpcError,
} from '@taalcut/core';
import { createClipCommands, type ClipStore } from './clip-commands';
import { fakePlaceCommands, fakePlaceCounts, fakeTrips, placeDetail, withPlaces } from './fake-places';
import { fakeAssetDetail, fakeTranscript } from './detail';
import { edgeClips, edgeDetail, edgeFailures } from './edge-clips';
import { createLanguageCommand, languageClips, languageDetail } from './language-clips';
import { sampleClips, sampleDetail, sampleTranscript } from './sample-clips';
import { failedAt, markImportFailures, sourceFailures } from './import-failures';
import {
  DEFAULT_ASSET_COUNT,
  fakeLibrary,
  FIXTURE_NOW,
  INDEXING_TAIL,
  KIND,
  type FakeAsset,
  type FakeSource,
} from './assets';
import { createFakeAnalysis, rerunStages, withStageProgress } from './fake-analysis';
import { FAKE_STAGES, fakeMilestoneOf } from './stages';
import { fakeActionCounts } from './fake-actions';
import { createBrowser, matchesFilters, search, similar, type BrowseInput } from './query';
import { fakeUlid, ulidNumber } from './seed';

export interface FakeLibraryOptions {
  /** How many clips; 0 is an empty library. Default 5,000. */
  readonly count?: number;
  /** Milliseconds every read waits, to see skeletons. */
  readonly latencyMs?: number;
  /** Search answers keyword-only, as before the embedding model is installed. */
  readonly keywordOnly?: boolean;
  /** Indexing moves on by itself (one clip every `tickMs`). Off in unit tests. */
  readonly tickMs?: number;
  /** LIB1-FIND: false for a library with no places and so no trips (location off, or cameras that save none). */
  readonly places?: boolean;
  /** LIB1-FIND: false for a library the actions read has nothing for (clips described before actions were asked). */
  readonly actions?: boolean;
}

const wait = (ms: number) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

export function createFakeLibrary(events: EventBus, options: FakeLibraryOptions = {}) {
  const count = options.count ?? DEFAULT_ASSET_COUNT;
  const built = fakeLibrary(count);
  const assets: FakeAsset[] = options.places === false ? built.assets : withPlaces(built.assets);
  let sources: FakeSource[] = count === 0 ? [] : built.sources;
  // The clip page's edge cases, by id only: not in the grid, search or the counts.
  const edges: FakeAsset[] =
    count === 0
      ? []
      : withPlaces(
          [...edgeClips(built.sources), ...sampleClips(built.sources), ...languageClips(built.sources)],
          { trips: false },
        );
  const failure = edgeFailures();
  const browser = createBrowser(() => assets);
  const latency = options.latencyMs ?? 0;

  // The phone's newest clips are still being looked through: the import strip and the card follow this. Two of them
  // couldn't be read: real clips, so the strip's count, the failed filter and their pages agree.
  let importing = sources[0];
  if (count > 0) markImportFailures(assets, importing?.id);
  let progress = { done: Math.floor(INDEXING_TAIL * 0.3), paused: false };
  let timer: ReturnType<typeof setTimeout> | null = null;

  function status(): IndexingStatus {
    const done = assets.filter((a) => a.summary.index.state === 'done').length;
    const failed = assets.filter((a) => a.summary.index.state === 'failed').length;
    const failures = sourceFailures(assets, importing?.id);
    const left = INDEXING_TAIL - progress.done;
    const running = importing && left > 0;
    const perStage = (i: number) =>
      Math.max(0, Math.min(INDEXING_TAIL, progress.done + (FAKE_STAGES.length - i) * 6));
    // Search finds a clip once its last searchable stage (speech embeddings) is done, before descriptions (IX).
    const searchable = perStage(FAKE_STAGES.indexOf('vision.embedText'));
    // Outside the import, what each clip's summary says.
    const searchableBefore = assets.filter(
      (a) => a.summary.index.state !== 'indexing' && (a.summary.index.searchableAt ?? null) !== null,
    ).length;
    return {
      paused: progress.paused,
      overall: {
        assets: assets.length,
        done: done + progress.done,
        active: running && !progress.paused ? 2 : 0,
        waiting: running ? Math.max(0, left - 2) : 0,
        failed,
        searchable: searchableBefore + (running ? searchable : 0),
      },
      sources:
        running && importing
          ? [
              {
                sourceId: importing.id,
                state: progress.paused ? 'paused' : 'indexing',
                counts: {
                  assets: INDEXING_TAIL,
                  done: progress.done,
                  active: progress.paused ? 0 : 2,
                  waiting: Math.max(0, left - 2),
                  failed: failures.length,
                  searchable,
                },
                stages: FAKE_STAGES.slice(1).map((stage, i) => ({
                  stage,
                  done: perStage(i + 1),
                  left: INDEXING_TAIL - perStage(i + 1),
                  failed: failedAt(failures, stage),
                  milestone: fakeMilestoneOf(stage),
                })),
                etaMs: progress.paused ? null : left * 1400,
                jobIds: [],
                updatedAt: Date.now(),
              },
            ]
          : [],
      etaMs: running && !progress.paused ? left * 1400 : null,
      updatedAt: Date.now(),
    };
  }

  function tick() {
    timer = null;
    if (progress.paused || progress.done >= INDEXING_TAIL || !options.tickMs) return;
    progress = { ...progress, done: progress.done + 1 };
    events.emit('library.indexing', status());
    timer = setTimeout(tick, options.tickMs);
  }
  const startTicking = () => {
    if (!timer && options.tickMs && importing) timer = setTimeout(tick, options.tickMs);
  };

  const find = (id: string) => {
    const n = ulidNumber(id, KIND.asset);
    return n === null ? undefined : (assets[n] ?? edges.find((edge) => edge.extras.n === n));
  };
  const sourceOf = (asset: FakeAsset) =>
    sources.find((s) => s.id === asset.summary.sourceIds[0]) ?? built.sources[0]!;
  // LIB1-PROG: how far each stage has got, and Analyse again keeping what the clip had (fake-analysis.ts).
  const analysis = createFakeAnalysis(events);
  function detailOf(asset: FakeAsset) {
    const { summary } = asset;
    const again = analysis.again(summary.id) && summary.index.state === 'indexing';
    // Analysed again: the clip as it was before, with its steps started over.
    const base: FakeAsset = again
      ? {
          ...asset,
          summary: { ...summary, index: { ...summary.index, state: 'done', done: summary.index.total } },
        }
      : asset;
    // A sample clip (UX2) is its files: its detail comes from them, not from the generator.
    const detail = placeDetail(
      base,
      sampleDetail(base, sourceOf(base)) ?? languageDetail(edgeDetail(fakeAssetDetail(base, sourceOf(base)))),
    );
    const stages = again
      ? rerunStages(detail.stages, summary.index.done, summary.index.total)
      : detail.stages;
    return {
      ...detail,
      asset: again ? { ...detail.asset, index: summary.index } : detail.asset,
      stages: withStageProgress(summary.id, stages, (_stage, typical) =>
        analysis.startedAt(summary.id, typical),
      ),
    };
  }
  const firstShot = (asset: FakeAsset): SearchHit['shot'] | null =>
    fakeAssetDetail(asset, sourceOf(asset)).shots[0] ?? null;

  const clips: ClipStore = {
    find,
    put(asset) {
      const n = asset.extras.n;
      if (assets[n]?.summary.id === asset.summary.id) assets[n] = asset;
      else {
        const at = edges.findIndex((edge) => edge.extras.n === n);
        if (at >= 0) edges[at] = asset;
      }
      browser.invalidate();
    },
    all: () => assets,
    // A removed or restored file of the import changes its failed count (requests-import-to-clip.md 2).
    indexingChanged: () => events.emit('library.indexing', status()),
    updateSource(id, change) {
      sources = sources.map((source) => (source.id === id ? change(source) : source));
    },
    ...(options.tickMs ? { tickMs: options.tickMs } : {}),
    reanalysed: (id) => analysis.start(id),
    stepped: (id) => analysis.stepped(id),
  };
  const commands: AnyCommand[] = [
    defineCommand({
      name: 'library.addSource',
      payload: libraryCommandPayloads['library.addSource'],
      sideEffect: 'write',
      project: () => null,
      handle: async ({ path, name, sourceId }) => {
        const id = sourceId ?? fakeUlid<'Source'>(KIND.source, 100 + sources.length);
        const added: FakeSource = {
          id,
          kind: 'watched_folder',
          name: name ?? path.split('/').filter(Boolean).pop() ?? path,
          status: 'online',
          path,
          watch: true,
          scan: { state: 'scanning', lastScanAt: null },
          assets: 0,
          missing: 0,
          createdAt: Date.now(),
          volume: 'Macintosh HD',
        };
        sources = [...sources, added];
        events.emit('library.changed', { projectId: null, entity: 'source', change: 'created', ids: [id] });
        // A first folder on an empty library starts its import (first run's import step follows it).
        if (!importing) {
          importing = added;
          progress = { done: 0, paused: false };
          events.emit('library.indexing', status());
          startTicking();
        }
        return ok({
          result: { sourceId: id },
          inverse: { name: 'library.removeSource', payload: { sourceId: id } },
        });
      },
    }),
    defineCommand({
      name: 'library.removeSource',
      payload: libraryCommandPayloads['library.removeSource'],
      sideEffect: 'write',
      project: () => null,
      handle: async ({ sourceId }) => {
        const removed = sources.find((s) => s.id === sourceId);
        sources = sources.filter((s) => s.id !== sourceId);
        events.emit('library.changed', {
          projectId: null,
          entity: 'source',
          change: 'deleted',
          ids: [sourceId],
        });
        return ok({
          result: null,
          ...(removed?.path
            ? {
                inverse: {
                  name: 'library.addSource',
                  payload: { path: removed.path, name: removed.name, sourceId, watch: removed.watch },
                },
              }
            : {}),
        });
      },
    }),
    ...createClipCommands(events, clips),
    // LIB1-LANG: a clip's spoken language, corrected (language-clips.ts).
    createLanguageCommand(events, clips),
    ...fakePlaceCommands(events, {
      all: () => assets,
      put(asset) {
        assets[asset.extras.n] = asset;
        browser.invalidate();
      },
    }),
  ];

  return {
    commands,
    status,
    library: {
      async browse(input: BrowseInput) {
        await wait(latency);
        return browser.browse(input);
      },
      async search(input: { query: string; filters?: LibraryFilters; limit: number }) {
        await wait(latency);
        const result = search(assets, input.query, input.filters, input.limit, firstShot);
        return options.keywordOnly ? { ...result, degraded: 'keyword-only' as const } : result;
      },
      /** The action filter's choices (LIB1-FIND). */
      async actions() {
        await wait(latency);
        if (options.actions === false) return { actions: [] };
        return { actions: fakeActionCounts(assets, (summary) => matchesFilters(summary)) };
      },
      async findSimilar(input: { shotId: string; filters?: LibraryFilters; limit: number }) {
        await wait(latency);
        const n = ulidNumber(input.shotId, KIND.shot);
        const asset = n === null ? undefined : assets[Math.floor(n / 16)];
        return asset
          ? similar(assets, asset, input.filters, input.limit, firstShot)
          : { hits: [], tookMs: 0 };
      },
      async asset(id: Id<'Asset'>) {
        await wait(latency);
        const failed = failure(id);
        if (failed) throw toRpcError(failed);
        const asset = find(id);
        if (!asset) return null;
        return detailOf(asset);
      },
      async transcript(id: Id<'Asset'>, fromSegment: number, limit: number) {
        await wait(latency);
        const asset = find(id);
        const transcript = asset ? (sampleTranscript(asset.extras.n) ?? fakeTranscript(asset)) : null;
        if (!transcript) return null;
        const segments = transcript.segments.slice(fromSegment, fromSegment + limit);
        const next = fromSegment + segments.length;
        return {
          language: transcript.language,
          segments,
          ...(next < transcript.segments.length ? { nextSegment: next } : {}),
        };
      },
      sources: () => sources.map(({ volume: _volume, ...view }) => view),
      storage: () => ({
        originalsRoot: {
          path: '/Users/me/Movies/Taalcut',
          volumeName: 'Macintosh HD',
          online: true,
          freeBytes: 212_000_000_000,
          usedBytes: 61_400_000_000,
        },
        catalogBytes: 840_000_000,
      }),
    },
    indexing: {
      status() {
        startTicking();
        return status();
      },
      prioritise: (ids: readonly string[]) => ({ boosted: ids.length }),
      pause() {
        progress = { ...progress, paused: true };
        const now = status();
        events.emit('library.indexing', now);
        return now;
      },
      resume() {
        progress = { ...progress, paused: false };
        const now = status();
        events.emit('library.indexing', now);
        startTicking();
        return now;
      },
      retryFailed() {
        // The import's failed clips go back in the queue, each at the step that stopped it.
        const again = sourceFailures(assets, importing?.id).map((asset) => asset.extras.n);
        for (const n of again) {
          const asset = assets[n];
          if (asset)
            assets[n] = {
              ...asset,
              summary: { ...asset.summary, index: { ...asset.summary.index, state: 'indexing' } },
            };
        }
        browser.invalidate();
        events.emit('library.indexing', status());
        if (again.length > 0)
          events.emit('library.changed', {
            projectId: null,
            entity: 'asset',
            change: 'updated',
            ids: again.flatMap((n) => (assets[n] ? [assets[n].summary.id] : [])),
          });
        return { requeued: again.length };
      },
    },
    /** LIB1-PLACE: the trips and the places clips were named at. */
    places: { trips: () => fakeTrips(assets), places: () => fakePlaceCounts(assets) },
    /** For tests and the e2e driver: where "now" is in the fixture. */
    now: FIXTURE_NOW,
    /** For tests: a clip's running stage reports how far it is, as its job would (LIB1-PROG). */
    analysis: { report: analysis.report },
  };
}

export type FakeLibrary = ReturnType<typeof createFakeLibrary>;
