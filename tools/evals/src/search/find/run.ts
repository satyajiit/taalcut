// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One find eval run: a copy of the indexed library, with a recording's descriptions replayed onto it through
 * vision's describe stage (or none), then every query through the app's own `createLibrarySearch` with each
 * fusion candidate. Query vectors come from the same EmbeddingGemma 2 as the descriptions', embedded once per
 * text for all candidates.
 *
 * Two sets of scores. Commons scores count Commons clips only (owner clips taken out of the hits and the answers),
 * so they read the same with or without a local owner set and anyone can reproduce them. Owner-set scores, when
 * one is present, count every clip, for the queries its clips answer.
 */
import type { Embedder, SearchHit } from '@taalcut/core';
import { createLibrarySearch, type SearchFusion } from '@taalcut/library';
import type { DecodeService, MediaContext } from '@taalcut/media';
import type { Tier, VisionEmbedder } from '@taalcut/vision';
import type { FindManifest } from './fetch';
import { replayingModels, type ReplayCounts } from './models';
import { FIND_LIMIT, groupScore, scoreQuery, type GroupScore, type QueryScore } from './score';
import { isOwnerClip, type FindQuery, type RecordingFile } from './schema';
import { describeLibrary, openFindLibrary, type FindLibrary } from './stored';

export interface FindCandidate {
  readonly id: string;
  readonly about: string;
  readonly fusion: SearchFusion;
}

export interface FindRunOptions {
  readonly libraryDb: string;
  readonly manifest: FindManifest;
  /** Each query with its committed (Commons) answers; `query.relevant` adds the owner set's (schema `mergeQueries`). */
  readonly queries: readonly { readonly query: FindQuery; readonly commons: readonly string[] }[];
  /** The descriptions to replay, by a label for the report; null: the library as indexed, undescribed. */
  readonly descriptions: { readonly label: string; readonly file: RecordingFile } | null;
  readonly candidates: readonly FindCandidate[];
  readonly workDir: string;
  readonly embedder: VisionEmbedder;
  readonly media: MediaContext;
  readonly tier: Tier;
  readonly tempDir: string;
  readonly decodeService?: DecodeService;
  readonly log: (line: string) => void;
}

export interface FindHit {
  readonly clip: string;
  readonly score: number;
  readonly matchedBy: SearchHit['matchedBy'];
}

export interface QueryResult {
  readonly query: string;
  readonly candidate: string;
  /** The query's Commons clips this library has, and their score; null when it has none. */
  readonly relevant: readonly string[];
  readonly score: QueryScore | null;
  /** With the owner set: all the query's clips this library has, scored over every hit. */
  readonly owner?: { readonly relevant: readonly string[]; readonly score: QueryScore };
  readonly top: readonly FindHit[];
}

export interface FindGroupScore extends GroupScore {
  readonly candidate: string;
  /** Commons: 'all', `kind:<kind>` or `language:<language>`; the owner set: 'owner:all'. */
  readonly group: string;
}

export interface FindReport {
  readonly descriptions: {
    readonly label: string;
    readonly prompt?: string;
    readonly model?: string;
    readonly replay?: ReplayCounts;
    /** Shots with a description once the replay ran. */
    readonly described: number;
    readonly shots: number;
    /** Clips the describer failed on (`<clip>: <code>`), left undescribed as the app would. */
    readonly failed: readonly string[];
  };
  readonly library: { readonly clips: number; readonly owner: boolean; readonly places: boolean };
  readonly candidates: readonly { readonly id: string; readonly version: string; readonly about: string }[];
  readonly queries: readonly FindQuery[];
  readonly results: readonly QueryResult[];
  readonly groups: readonly FindGroupScore[];
  readonly skipped: readonly { readonly query: string; readonly why: string }[];
}

/** core's Embedder over the eval's, each query text embedded once for every candidate. */
function memoQueries(embedder: VisionEmbedder): Embedder {
  const memo = new Map<string, Float32Array>();
  return {
    space: embedder.space,
    async embedTexts(texts, options) {
      const key = texts.length === 1 && options.purpose === 'query' ? texts[0]! : undefined;
      const hit = key === undefined ? undefined : memo.get(key);
      if (hit) return { ok: true, value: [hit] };
      const embedded = await embedder.embedTexts(texts, options);
      if (embedded.ok && key !== undefined && embedded.value[0]) memo.set(key, embedded.value[0]);
      return embedded;
    },
  };
}

function count(library: FindLibrary, sql: string): number {
  return Number(library.db.driver.prepare(sql).get()?.n ?? 0);
}

/** Whether the library has places (LIB1-PLACE's table, with rows). */
function hasPlaces(library: FindLibrary): boolean {
  const table = count(
    library,
    "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'asset_places'",
  );
  return table > 0 && count(library, 'SELECT count(*) AS n FROM asset_places') > 0;
}

function groups(candidate: string, queries: readonly FindQuery[], results: readonly QueryResult[]) {
  const byGroup = new Map<string, QueryScore[]>([['all', []]]);
  const add = (group: string, score: QueryScore) =>
    byGroup.set(group, [...(byGroup.get(group) ?? []), score]);
  for (const query of queries) {
    const result = results.find((r) => r.query === query.id && r.candidate === candidate);
    if (result?.score)
      for (const group of ['all', `kind:${query.kind}`, `language:${query.language}`])
        add(group, result.score);
    if (result?.owner) add('owner:all', result.owner.score);
  }
  return [...byGroup].map(([group, list]): FindGroupScore => ({ candidate, group, ...groupScore(list) }));
}

export async function runFindEval(options: FindRunOptions): Promise<FindReport> {
  const label = options.descriptions?.label ?? 'undescribed';
  const library = openFindLibrary(options.libraryDb, options.manifest, options.workDir, label);
  try {
    let replay: ReplayCounts | undefined;
    // A clip the describer fails on stays undescribed, as in the app (its stage fails; search still has its frames).
    let failed: string[] = [];
    if (options.descriptions) {
      const models = replayingModels(options.descriptions.file);
      failed = await describeLibrary(library, { ...options, models });
      for (const failure of failed) options.log(`describing failed: ${failure}`);
      replay = models.counts();
    }
    const present = new Set(library.clipOf.values());
    const places = hasPlaces(library);
    const embedder = memoQueries(options.embedder);
    const results: QueryResult[] = [];
    const allGroups: FindGroupScore[] = [];
    const skipped: { query: string; why: string }[] = [];
    for (const [n, candidate] of options.candidates.entries()) {
      const search = createLibrarySearch({
        db: library.db,
        vectors: library.vectors,
        embedder,
        fusion: candidate.fusion,
      });
      for (const { query, commons } of options.queries) {
        const relevant = commons.filter((clip) => present.has(clip));
        const all = query.relevant.filter((clip) => present.has(clip));
        const withOwner = all.some(isOwnerClip);
        const why =
          relevant.length === 0 && !withOwner
            ? 'none of its clips is in this library'
            : query.needs === 'places' && !places
              ? 'the library has no places yet'
              : undefined;
        if (why) {
          if (n === 0) skipped.push({ query: query.id, why });
          continue;
        }
        const found = await search.search(query.text, query.filters, FIND_LIMIT);
        if (!found.ok) throw new Error(`${query.id}: ${found.error.code} ${found.error.detail ?? ''}`);
        if (found.value.degraded) throw new Error(`${query.id}: search fell back to keywords only`);
        const top = found.value.hits.map((hit) => ({
          clip: library.clipOf.get(hit.shot.assetId) ?? '?',
          score: hit.score,
          matchedBy: hit.matchedBy,
        }));
        const clips = top.map((hit) => hit.clip);
        results.push({
          query: query.id,
          candidate: candidate.id,
          relevant,
          score:
            relevant.length > 0
              ? scoreQuery(
                  relevant,
                  clips.filter((clip) => !isOwnerClip(clip)),
                )
              : null,
          ...(withOwner ? { owner: { relevant: all, score: scoreQuery(all, clips) } } : {}),
          top,
        });
      }
      allGroups.push(
        ...groups(
          candidate.id,
          options.queries.map((q) => q.query),
          results,
        ),
      );
    }
    return {
      descriptions: {
        label,
        ...(options.descriptions
          ? { prompt: options.descriptions.file.prompt, model: options.descriptions.file.model.model }
          : {}),
        ...(replay ? { replay } : {}),
        described: count(library, 'SELECT count(*) AS n FROM shots WHERE description IS NOT NULL'),
        shots: count(library, 'SELECT count(*) AS n FROM shots'),
        failed,
      },
      library: {
        clips: library.clipOf.size,
        owner: [...present].some(isOwnerClip),
        places,
      },
      candidates: options.candidates.map((c) => ({ id: c.id, version: c.fusion.version, about: c.about })),
      queries: options.queries.map((q) => q.query),
      results,
      groups: allGroups,
      skipped,
    };
  } finally {
    library.close();
  }
}
