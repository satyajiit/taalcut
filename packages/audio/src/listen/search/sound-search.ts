// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A description over the SFX bank and the caller's own sounds, from any process with a JobRunner (EAR1-B2, B3): the
 * sounds' embeddings from the cache (embedding-cache.ts, made in the jobs process on a miss), then one `searchSounds`
 * job. When the jobs process runs a build of another dtype than the cached embeddings, it names them `stale`; they
 * are embedded again in that dtype and the search runs once more. The dtype last seen is kept for the next search.
 * A sound that can't be decoded is left out and counted (`unreadable`, EAR1-R1), not a failed search.
 */
import { ok, type AsyncResult, type JobRunner, type SfxCategory, type SoundTagCategory } from '@taalcut/core';
import type { ListenDtype } from '../config';
import { runListenQuery } from '../jobs';
import type { EmbeddableSound, SoundEmbeddings } from './embedding-cache';
import { searchSoundsQuery, type SearchEntry, type SearchSoundsResult } from './queries';

export interface SoundSearchRequest {
  readonly query: string;
  readonly top?: number;
  /** The installed `sfx-bank` folder; absent: only `sounds`. */
  readonly bankDir?: string;
  readonly bankFamily?: SfxCategory;
  readonly sounds?: readonly EmbeddableSound[];
  readonly hints?: readonly SoundTagCategory[];
  readonly signal?: AbortSignal;
}

export interface SoundSearcher {
  search(request: SoundSearchRequest): AsyncResult<SearchSoundsResult>;
}

export function createSoundSearcher(deps: {
  readonly jobs: Pick<JobRunner, 'run'>;
  readonly embeddings: SoundEmbeddings;
}): SoundSearcher {
  let dtype: ListenDtype | undefined;

  async function once(request: SoundSearchRequest, entries: readonly SearchEntry[]) {
    return runListenQuery(
      deps.jobs,
      searchSoundsQuery,
      [],
      {
        query: request.query,
        ...(request.top !== undefined ? { top: request.top } : {}),
        ...(request.bankDir ? { bankDir: request.bankDir } : {}),
        ...(request.bankFamily ? { bankFamily: request.bankFamily } : {}),
        entries: [...entries],
        ...(request.hints?.length ? { hints: [...request.hints] } : {}),
      },
      request.signal ? { signal: request.signal } : {},
    );
  }

  return {
    async search(request) {
      const sounds = request.sounds ?? [];
      const unread = new Set<string>();
      const signal = request.signal ? { signal: request.signal } : {};
      const onUnreadable = (sound: EmbeddableSound) => unread.add(sound.id);
      const counted = (result: SearchSoundsResult): SearchSoundsResult =>
        unread.size > 0 ? { ...result, unreadable: unread.size } : result;
      const first = await deps.embeddings.entries(sounds, {
        ...(dtype ? { dtype } : {}),
        ...signal,
        onUnreadable,
      });
      if (!first.ok) return first;
      const found = await once(request, first.value);
      if (!found.ok) return found;
      dtype = found.value.dtype;
      if (found.value.stale.length === 0) return ok(counted(found.value));
      const stale = new Set(found.value.stale);
      const again = await deps.embeddings.entries(
        sounds.filter((s) => stale.has(s.id)),
        { dtype: found.value.dtype, ...signal, onUnreadable },
      );
      if (!again.ok) return again;
      const entries = [...first.value.filter((e) => !stale.has(e.id)), ...again.value];
      const second = await once(request, entries);
      return second.ok ? ok(counted(second.value)) : second;
    },
  };
}
