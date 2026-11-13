// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Runs the study: every fusion candidate over every stored library, each probe of the library's set through the
 * app's own `createLibrarySearch` with the candidate's fusion and the cached query vectors (no model, no lock).
 * Also replays the bench's search checks (the indexing e2e's) on each ix-v1 library: every probe word a clip alone
 * says puts that clip first, and the looks query brings a visual match.
 */
import type { SearchHit } from '@taalcut/core';
import { createLibrarySearch, type SearchFusion } from '@taalcut/library';
import { IX_V1 } from '@taalcut/bench-footage';
import { EMBEDDING_SPACE } from '@taalcut/vision';
import type { LabelledProbe } from './labels';
import { cachedQueryEmbedder, readQueryVectors } from './query-vectors';
import { firstRelevantRank, scoreRanks, STUDY_LIMIT, type RankScore } from './score';
import { openStoredLibrary, type StoredLibrary, type StudyShot } from './stored-library';
import type { StudySet } from './schema';

export interface LibraryInput {
  readonly label: string;
  readonly path: string;
}

export interface StudyCandidate {
  readonly id: string;
  readonly about: string;
  readonly fusion: SearchFusion;
}

export interface StudyHit extends StudyShot {
  readonly score: number;
  readonly matchedBy: readonly string[];
}

export interface ProbeResult {
  readonly probe: string;
  readonly library: string;
  readonly candidate: string;
  readonly rank: number | null;
  readonly top: readonly StudyHit[];
}

export interface GroupScore extends RankScore {
  readonly library: string;
  readonly candidate: string;
  /** 'all', a language or a probe kind. */
  readonly group: string;
}

export interface BenchCheck {
  readonly library: string;
  readonly candidate: string;
  readonly check: string;
  readonly pass: boolean;
  readonly got: string;
}

export interface StudyReport {
  readonly vectors: { readonly device: string; readonly space: string };
  readonly libraries: readonly { readonly label: string; readonly set: StudySet; readonly path: string }[];
  readonly candidates: readonly { readonly id: string; readonly version: string; readonly about: string }[];
  readonly probes: readonly LabelledProbe[];
  readonly results: readonly ProbeResult[];
  readonly scores: readonly GroupScore[];
  readonly bench: readonly BenchCheck[];
}

export interface RunStudyOptions {
  readonly probes: readonly LabelledProbe[];
  readonly vectors: string;
  readonly libraries: readonly LibraryInput[];
  readonly candidates: readonly StudyCandidate[];
  readonly workDir: string;
}

type Search = (text: string) => Promise<StudyHit[]>;

function searcher(
  library: StoredLibrary,
  candidate: StudyCandidate,
  vectors: ReturnType<typeof readQueryVectors>,
): Search {
  const search = createLibrarySearch({
    db: library.db,
    vectors: library.vectors,
    embedder: cachedQueryEmbedder(vectors, EMBEDDING_SPACE),
    fusion: candidate.fusion,
  });
  return async (text) => {
    const found = await search.search(text, undefined, STUDY_LIMIT);
    if (!found.ok)
      throw new Error(`${library.label} "${text}": ${found.error.code} ${found.error.detail ?? ''}`);
    // A missing query vector makes search fall back to keywords; the study never scores that.
    if (found.value.degraded) throw new Error(`${library.label} "${text}": no cached query vector`);
    return found.value.hits.map((hit) => studyHit(library, hit));
  };
}

function studyHit(library: StoredLibrary, hit: SearchHit): StudyHit {
  const shot = library.shot(hit.shot.id);
  if (!shot) throw new Error(`${library.label}: a hit names shot ${hit.shot.id}, which it doesn't have`);
  return { ...shot, score: hit.score, matchedBy: hit.matchedBy };
}

function groupScores(
  library: string,
  candidate: string,
  probes: readonly LabelledProbe[],
  ranks: ReadonlyMap<string, number | null>,
): GroupScore[] {
  const groups = new Map<string, (number | null)[]>([['all', []]]);
  for (const probe of probes) {
    const rank = ranks.get(probe.id);
    if (rank === undefined) continue;
    for (const key of ['all', probe.language, probe.kind])
      groups.set(key, [...(groups.get(key) ?? []), rank]);
  }
  return [...groups].map(([group, list]) => ({ library, candidate, group, ...scoreRanks(list) }));
}

/** The indexing e2e's search checks on the bench footage (apps/desktop/e2e/indexing.e2e.ts). */
async function benchChecks(library: string, candidate: string, search: Search): Promise<BenchCheck[]> {
  const checks: BenchCheck[] = [];
  for (const clip of IX_V1.clips) {
    const probe = clip.speech?.probe;
    if (!probe) continue;
    const first = (await search(probe))[0];
    checks.push({
      library,
      candidate,
      check: `"${probe}" → ${clip.file} first`,
      pass: first?.asset === clip.file,
      got: first
        ? `${first.asset} ${first.from.toFixed(1)}–${first.to.toFixed(1)} s (${first.matchedBy.join(', ')})`
        : 'no hits',
    });
  }
  const looks = await search(IX_V1.looksProbe);
  const visual = looks.find((hit) => hit.matchedBy.includes('visual'));
  checks.push({
    library,
    candidate,
    check: `"${IX_V1.looksProbe}" → a visual match`,
    pass: visual !== undefined,
    got: visual ? `${visual.asset} ${visual.from.toFixed(1)}–${visual.to.toFixed(1)} s` : 'none',
  });
  return checks;
}

export async function runStudy(options: RunStudyOptions): Promise<StudyReport> {
  const vectors = readQueryVectors(options.vectors);
  const results: ProbeResult[] = [];
  const scores: GroupScore[] = [];
  const bench: BenchCheck[] = [];
  const libraries: StudyReport['libraries'][number][] = [];
  for (const input of options.libraries) {
    const library = openStoredLibrary(input.label, input.path, options.workDir);
    try {
      libraries.push({ label: input.label, set: library.set, path: input.path });
      const probes = options.probes.filter((probe) => probe.set === library.set);
      for (const candidate of options.candidates) {
        const search = searcher(library, candidate, vectors);
        const ranks = new Map<string, number | null>();
        for (const probe of probes) {
          const hits = await search(probe.text);
          const rank = firstRelevantRank(probe.relevant, hits);
          ranks.set(probe.id, rank);
          results.push({
            probe: probe.id,
            library: input.label,
            candidate: candidate.id,
            rank,
            top: hits.slice(0, 5),
          });
        }
        scores.push(...groupScores(input.label, candidate.id, probes, ranks));
        if (library.set === 'ix-v1') bench.push(...(await benchChecks(input.label, candidate.id, search)));
      }
    } finally {
      library.close();
    }
  }
  return {
    vectors: { device: vectors.device, space: vectors.space },
    libraries,
    candidates: options.candidates.map((c) => ({ id: c.id, version: c.fusion.version, about: c.about })),
    probes: options.probes,
    results,
    scores,
    bench,
  };
}
