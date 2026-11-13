// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The library commands the clip page offers, as the fake serves them: analyse a clip again
 * (`library.reindexAssets`: back to the first step, then one step per indexing tick), remove it and put it back
 * (`library.trashAssets` / `library.restoreAssets`, each the other's undo) and look through a folder again
 * (`library.rescanSource`: a moment later the folder's missing clips are found where they were). Each says what
 * changed with `library.changed`, as the real library's commit announcer does, so open pages read again.
 */
import {
  defineCommand,
  err,
  LIBRARY_COMMANDS,
  libraryCommandPayloads,
  NotFoundError,
  ok,
  type AnyCommand,
  type AssetSummary,
  type EventBus,
  type Id,
} from '@taalcut/core';
import type { FakeAsset, FakeSource } from './assets';
import { FAKE_STAGES, SEARCHABLE_STAGES } from './stages';

export interface ClipStore {
  readonly find: (id: string) => FakeAsset | undefined;
  /** Puts a changed clip back where it was. */
  readonly put: (asset: FakeAsset) => void;
  /** Every clip, for a folder's look-through. */
  readonly all: () => readonly FakeAsset[];
  readonly updateSource: (id: Id<'Source'>, change: (source: FakeSource) => FakeSource) => void;
  /** Milliseconds between indexing steps; 0 or none holds a re-analysed clip on its first step. */
  readonly tickMs?: number;
  /** Says the indexing status may have moved (a removed clip leaves the import's failed count). */
  readonly indexingChanged?: () => void;
  /** LIB1-PROG: a clip is analysed again, and moved on a step (fake-analysis.ts follows its steps). */
  readonly reanalysed?: (id: Id<'Asset'>) => void;
  readonly stepped?: (id: Id<'Asset'>) => void;
}

/** How long a folder's look-through takes. */
const SCAN_MS = 1200;

export function createClipCommands(events: EventBus, store: ClipStore): AnyCommand[] {
  const changed = (ids: readonly Id<'Asset'>[]) =>
    events.emit('library.changed', { projectId: null, entity: 'asset', change: 'updated', ids: [...ids] });
  const patch = (asset: FakeAsset, summary: Partial<AssetSummary>) =>
    store.put({ ...asset, summary: { ...asset.summary, ...summary } });

  /** One more step done for a clip being analysed again; searchable past the searchable steps. */
  function step(id: Id<'Asset'>) {
    const asset = store.find(id);
    if (!asset || asset.summary.index.state !== 'indexing') return;
    const done = asset.summary.index.done + 1;
    const total = FAKE_STAGES.length;
    patch(asset, {
      index: {
        state: done >= total ? 'done' : 'indexing',
        done: Math.min(done, total),
        total,
        searchableAt: done > SEARCHABLE_STAGES ? (asset.summary.index.searchableAt ?? Date.now()) : null,
      },
    });
    store.stepped?.(id);
    changed([id]);
    if (done < total && store.tickMs) setTimeout(() => step(id), store.tickMs);
  }

  const unknown = (ids: readonly Id<'Asset'>[]) => ids.find((id) => !store.find(id));

  function setTrashed(ids: readonly Id<'Asset'>[], trashed: boolean) {
    const changing = ids.filter((id) => store.find(id)?.summary.trashed === !trashed);
    for (const id of changing) {
      const asset = store.find(id);
      if (asset) patch(asset, { trashed });
    }
    if (changing.length > 0) {
      changed(changing);
      store.indexingChanged?.();
    }
    return ok({
      result: { assetIds: changing },
      inverse: {
        name: trashed ? LIBRARY_COMMANDS.restoreAssets : LIBRARY_COMMANDS.trashAssets,
        payload: { assetIds: changing },
      },
    });
  }

  return [
    defineCommand({
      name: LIBRARY_COMMANDS.reindexAssets,
      payload: libraryCommandPayloads[LIBRARY_COMMANDS.reindexAssets],
      sideEffect: 'write',
      project: () => null,
      handle: async ({ assetIds, stages }) => {
        const ids = [...new Set(assetIds)];
        const missing = unknown(ids);
        if (missing) return err(NotFoundError({ entity: 'asset', id: missing }));
        for (const id of ids) {
          const asset = store.find(id);
          if (!asset) continue;
          // Every step after library.hash, which identifies the bytes and never needs redoing.
          patch(asset, {
            index: { state: 'indexing', done: 1, total: FAKE_STAGES.length, searchableAt: null },
          });
          store.reanalysed?.(id);
          if (store.tickMs) setTimeout(() => step(id), store.tickMs);
        }
        changed(ids);
        return ok({ result: { assetIds: ids, stages: stages ?? null } });
      },
    }),
    defineCommand({
      name: LIBRARY_COMMANDS.trashAssets,
      payload: libraryCommandPayloads[LIBRARY_COMMANDS.trashAssets],
      sideEffect: 'write',
      project: () => null,
      handle: async ({ assetIds }) => {
        const missing = unknown(assetIds);
        return missing ? err(NotFoundError({ entity: 'asset', id: missing })) : setTrashed(assetIds, true);
      },
    }),
    defineCommand({
      name: LIBRARY_COMMANDS.restoreAssets,
      payload: libraryCommandPayloads[LIBRARY_COMMANDS.restoreAssets],
      sideEffect: 'write',
      project: () => null,
      handle: async ({ assetIds }) => {
        const missing = unknown(assetIds);
        return missing ? err(NotFoundError({ entity: 'asset', id: missing })) : setTrashed(assetIds, false);
      },
    }),
    defineCommand({
      name: LIBRARY_COMMANDS.rescanSource,
      payload: libraryCommandPayloads[LIBRARY_COMMANDS.rescanSource],
      // As the real one: it starts a scan and changes nothing itself.
      sideEffect: 'read',
      project: () => null,
      handle: async ({ sourceId }) => {
        const scanning = (state: 'scanning' | 'idle') => (source: FakeSource) => ({
          ...source,
          scan: { state, lastScanAt: state === 'idle' ? Date.now() : source.scan.lastScanAt },
          ...(state === 'idle' ? { missing: 0 } : {}),
        });
        store.updateSource(sourceId, scanning('scanning'));
        events.emit('library.changed', {
          projectId: null,
          entity: 'source',
          change: 'updated',
          ids: [sourceId],
        });
        setTimeout(() => {
          const found = store
            .all()
            .filter((a) => a.summary.availability === 'missing' && a.summary.sourceIds[0] === sourceId);
          for (const asset of found) patch(asset, { availability: 'online' });
          store.updateSource(sourceId, scanning('idle'));
          events.emit('library.changed', {
            projectId: null,
            entity: 'source',
            change: 'updated',
            ids: [sourceId],
          });
          if (found.length > 0) changed(found.map((a) => a.summary.id));
        }, SCAN_MS);
        return ok({ result: { jobId: `fake-scan-${sourceId}` } });
      },
    }),
  ];
}
