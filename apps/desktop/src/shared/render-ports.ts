// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Render's ports in the processes that touch renders (agent, jobs, render):
 * the library's RenderStore and TimelineStore (registered here where the
 * library's agent wiring hasn't already), timelines with their saved
 * versions, the `export` version render.export keeps, and asset files from
 * the library's locations.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ok,
  RenderStoreToken,
  TimelineStoreToken,
  type AsyncResult,
  type Container,
  type TimelineId,
  type TimelineStore,
} from '@taalcut/core';
import {
  createAssetLocationRepository,
  createDerivedFileRepository,
  createRenderStore,
  createTimelineStore,
  createTranscriptRepository,
  type AssetLocationRepository,
  type DerivedFileRepository,
  type LibraryTimelineStore,
  type TranscriptRepository,
} from '@taalcut/library';
import {
  timelineAccessOverStore,
  timelinesUnavailable,
  type AssetFiles,
  type TimelineAccess,
  type TranscriptSource,
} from '@taalcut/render';
import { mediaCacheRoot } from './media-cache';
import { LibraryDatabaseToken, LibraryPortsToken, UtilityConfigToken } from './tokens';

/** RenderStoreToken and TimelineStoreToken from the library, unless this process registered them already. */
export function registerRenderPorts(container: Container): Container {
  if (!container.has(RenderStoreToken))
    container.factory(RenderStoreToken, ({ db }) => createRenderStore(db), {
      deps: { db: LibraryDatabaseToken },
    });
  if (!container.has(TimelineStoreToken))
    container.factory(
      TimelineStoreToken,
      ({ db, ports }) => createTimelineStore(db, { commands: ports.commands }),
      { deps: { db: LibraryDatabaseToken, ports: LibraryPortsToken } },
    );
  return container;
}

const versionsOf = (store: TimelineStore) =>
  'versions' in store ? (store as LibraryTimelineStore).versions : undefined;

/** Timelines through the library's store, with its saved versions for a render's exact revision. */
export function renderTimelines(container: Container): TimelineAccess {
  if (!container.has(TimelineStoreToken)) return timelinesUnavailable;
  const store = container.resolve(TimelineStoreToken);
  const versions = versionsOf(store);
  return timelineAccessOverStore(store, versions ? { versions } : {});
}

/** A version label is at most 100 characters; a render's name can be 200. Cut on a code point. */
const VERSION_LABEL_MAX = 100;
function versionLabel(name: string): string {
  let label = '';
  for (const char of name.normalize('NFC').trim()) {
    if (label.length + char.length > VERSION_LABEL_MAX) break;
    label += char;
  }
  return label.trimEnd();
}

/** render.export's snapshot: the exported revision kept as an `export` version. */
export function snapshotExport(container: Container) {
  return async (input: {
    readonly timelineId: TimelineId;
    readonly revision: number;
    readonly label: string;
  }): AsyncResult<unknown> => {
    const versions = versionsOf(container.resolve(TimelineStoreToken));
    if (!versions) return ok(null);
    return versions.snapshot({
      timelineId: input.timelineId,
      kind: 'export',
      revision: input.revision,
      label: versionLabel(input.label),
    });
  };
}

/** Originals from the library's present locations; proxies from media's derived-file cache. */
export function renderAssetFiles(container: Container): AssetFiles {
  let locations: AssetLocationRepository | undefined;
  let derived: DerivedFileRepository | undefined;
  return {
    async original(assetId) {
      locations ??= createAssetLocationRepository(container.resolve(LibraryDatabaseToken));
      const found = locations
        .listByAsset(assetId)
        .find((location) => location.state === 'present' && location.absolutePathCached);
      return ok(
        found?.absolutePathCached
          ? { path: found.absolutePathCached, size: found.sizeBytes, mtimeMs: found.mtimeMs ?? 0 }
          : null,
      );
    },
    async proxy(assetId) {
      if (!container.has(LibraryDatabaseToken) || !container.has(UtilityConfigToken)) return ok(null);
      derived ??= createDerivedFileRepository(container.resolve(LibraryDatabaseToken));
      const ref = derived.find(assetId, 'proxy');
      if (!ref) return ok(null);
      const path = join(mediaCacheRoot(container.resolve(UtilityConfigToken).userData), ref.key);
      return ok(existsSync(path) ? path : null);
    },
  };
}

/** Stored transcripts from the library (P2-L8), for caption rebuilds. */
export function renderTranscripts(container: Container): TranscriptSource {
  let transcripts: TranscriptRepository | undefined;
  return {
    async transcript(assetId) {
      if (!container.has(LibraryDatabaseToken)) return ok(null);
      transcripts ??= createTranscriptRepository(container.resolve(LibraryDatabaseToken));
      return ok(transcripts.get(assetId));
    },
  };
}
