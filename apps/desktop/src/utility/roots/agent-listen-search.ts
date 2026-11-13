// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1 lane B's agent tools (B1: `audio.findMoment`; B2: `sfx.searchSounds`), joined to the agent's tools by
 * agent-audio.ts's `withAudioTools`, so lane B never edits that file's module list. Modules whose `id` is an existing
 * module's (`audio`, `sfx`) join their namesake after the tools it already has (recorded sessions keep their order).
 * The listening runs in the jobs process: `runListenQuery` (@taalcut/audio) over this process's JobRunnerToken.
 * `listenMusicDescribe` gives `music.findLibraryTrack` its `describe` (B3).
 *
 * The user's sounds are the library's online audio assets: up to 10 s long for sound effects, 20 s or more for
 * music, at most 200 of each, in the library's id order. Their CLAP
 * embeddings are made once in the jobs process and kept in media's derived cache, opened here on first use.
 */
import { join } from 'node:path';
import {
  createToken,
  defineToolModule,
  err,
  JobRunnerToken,
  MEDIA_CACHE_CAP_SETTING,
  ok,
  RationalTime,
  type AsyncResult,
  type Container,
  type ToolModule,
} from '@taalcut/core';
import {
  createSoundEmbeddings,
  createSoundSearcher,
  listenSearchTools,
  loadSfxPack,
  searchSoundsTool,
  SfxPackMissing,
  type LibraryMusic,
  type LibrarySound,
  type MusicDescribeDeps,
  type SoundSearcher,
} from '@taalcut/audio';
import { createAssetLocationRepository, createAssetRepository } from '@taalcut/library';
import { createDerivedCache, type DerivedCache } from '@taalcut/media';
import { mediaCacheRoot } from '../../shared/media-cache';
import { renderAssetFiles } from '../../shared/render-ports';
import { LibraryDatabaseToken, UtilityConfigToken } from '../../shared/tokens';
import { SFX_BANK_COMPONENT, SFX_PACK_COMPONENT } from './agent-audio-services';
import { cacheJson, installedComponentFile } from './audio-library';

const SearcherToken = createToken<SoundSearcher>('agent.listenSearcher');
const SearchCacheToken = createToken<DerivedCache>('agent.listenSearchCache');
const MAX_SOUNDS = 200;
const PAGE = 500;
const SFX_MAX_S = 10;
const MUSIC_MIN_S = 20;

interface AudioAsset {
  readonly assetId: LibrarySound['assetId'];
  readonly title: string;
  readonly path: string;
  readonly contentHash: string;
  readonly seconds: number;
}

/** Present, hashed audio assets whose length passes `keep`, at most MAX_SOUNDS. */
function audioAssets(container: Container, keep: (seconds: number) => boolean): AudioAsset[] {
  if (!container.has(LibraryDatabaseToken)) return [];
  const db = container.resolve(LibraryDatabaseToken);
  const assets = createAssetRepository(db);
  const locations = createAssetLocationRepository(db);
  const out: AudioAsset[] = [];
  let afterId: AudioAsset['assetId'] | undefined;
  for (;;) {
    const page = assets.list({ availability: 'online', limit: PAGE, ...(afterId ? { afterId } : {}) });
    for (const asset of page) {
      if (asset.kind !== 'audio' || !asset.contentHash || asset.durationValue === null) continue;
      const seconds = RationalTime.toSeconds(
        RationalTime.of(asset.durationValue, {
          num: asset.durationRateNum ?? 1,
          den: asset.durationRateDen ?? 1,
        }),
      );
      if (!keep(seconds)) continue;
      const path = locations
        .listByAsset(asset.id)
        .find((l) => l.state === 'present' && l.absolutePathCached)?.absolutePathCached;
      if (!path) continue;
      out.push({
        assetId: asset.id,
        title: asset.originalFilename,
        path,
        contentHash: asset.contentHash,
        seconds,
      });
      if (out.length >= MAX_SOUNDS) return out;
    }
    if (page.length < PAGE) return out;
    afterId = page.at(-1)?.id;
  }
}

function searcherOf(container: Container): SoundSearcher {
  if (!container.has(SearchCacheToken)) {
    const userData = container.resolve(UtilityConfigToken).userData;
    container.factory(SearchCacheToken, () =>
      createDerivedCache({ root: mediaCacheRoot(userData), capBytes: MEDIA_CACHE_CAP_SETTING.defaultValue }),
    );
  }
  if (!container.has(SearcherToken)) {
    const jobs = container.resolve(JobRunnerToken);
    container.factory(SearcherToken, () =>
      createSoundSearcher({
        jobs,
        embeddings: createSoundEmbeddings({
          jobs,
          cache: cacheJson(() => container.resolve(SearchCacheToken)),
        }),
      }),
    );
  }
  return container.resolve(SearcherToken);
}

const okAsync = <T>(value: T): AsyncResult<T> => Promise.resolve(ok(value));

export function listenSearchToolModules(container: Container): ToolModule[] {
  if (!container.has(JobRunnerToken) || !container.has(UtilityConfigToken)) return [];
  const config = container.resolve(UtilityConfigToken);
  const jobs = container.resolve(JobRunnerToken);
  const searcher = searcherOf(container);
  return [
    defineToolModule({
      id: 'audio',
      tools: listenSearchTools({
        jobs,
        assets: renderAssetFiles(container),
        scratch: join(config.userData, 'scratch', 'listen'),
      }),
    }),
    defineToolModule({
      id: 'sfx',
      tools: [
        searchSoundsTool({
          searcher,
          bankDir: () => installedComponentFile(config.userData, SFX_BANK_COMPONENT),
          // A missing pack is `audio.sfx_pack_missing`; the search goes on without it.
          pack: async () => {
            const dir = installedComponentFile(config.userData, SFX_PACK_COMPONENT);
            return dir
              ? loadSfxPack(dir)
              : err(SfxPackMissing(undefined, { detail: 'sfx-pack is not installed' }));
          },
          library: () => okAsync(audioAssets(container, (s) => s <= SFX_MAX_S)),
        }),
      ],
    }),
  ];
}

/** EAR1-B3: `music.findLibraryTrack`'s `describe` over the pack and the library's music, to spread into its deps. */
export function listenMusicDescribe(container: Container): { readonly describe?: MusicDescribeDeps } {
  if (!container.has(JobRunnerToken) || !container.has(UtilityConfigToken)) return {};
  return {
    describe: {
      searcher: searcherOf(container),
      library: () =>
        okAsync<LibraryMusic[]>(
          audioAssets(container, (s) => s >= MUSIC_MIN_S).map((a) => ({
            assetId: a.assetId,
            title: a.title,
            path: a.path,
            contentHash: a.contentHash,
            seconds: Math.round(a.seconds * 100) / 100,
          })),
        ),
    },
  };
}
