// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The footage a bench run indexes, kept under the bench root and made once (IX-B1, IX-B3):
 *
 * - `smoke`: the indexing e2e's own generated library at its bench scale (three minutes in ten files, Phase
 *   3's bench), which the e2e makes on its first run into the cache folder named here;
 * - `ix-v1`: the IX synthetic set (tools/bench-footage), ten minutes in eighteen files, generated here before
 *   the first run unless a matching set is already there; the e2e reads the set's manifest.json for its files,
 *   its seconds and its search probes.
 *
 * `prepare` returns the environment that points the e2e at the set. The bench runs under the machine's
 * video-encoder lock, so the generation does too.
 */
import {
  bundledFfmpeg,
  ensureFootage,
  IX_V1,
  systemTools,
  type FootageSet as GeneratedSet,
  type Manifest,
} from '@taalcut/bench-footage';
import type { BenchLayout } from './layout';
import type { FootageSet } from './options';

/** The e2e reads a generated set from here (apps/desktop/e2e/indexing-footage.ts). */
export const BENCH_FOOTAGE_ENV = 'TAALCUT_BENCH_FOOTAGE';

export interface FootageProvider {
  /** `stallDir` receives a report for any FFmpeg call that stalls while the set is made (never killed). */
  prepare(set: FootageSet, layout: BenchLayout, stallDir: string): Promise<Readonly<Record<string, string>>>;
}

/** Makes `set` in `dir` unless a matching one is there. */
export type EnsureSet = (
  set: GeneratedSet,
  dir: string,
  stallDir: string,
) => Promise<{ readonly manifest: Manifest; readonly generated: boolean }>;

export interface FootageDeps {
  readonly ensure?: EnsureSet;
  readonly log?: (line: string) => void;
}

const ensureWithSystemTools =
  (log: (line: string) => void): EnsureSet =>
  (set, dir, stallDir) => {
    const ffmpeg = bundledFfmpeg();
    if (ffmpeg === undefined)
      return Promise.reject(
        new Error('No FFmpeg build: run tools/ffmpeg/build.sh (or set TAALCUT_FFMPEG_DIR).'),
      );
    return ensureFootage(set, dir, systemTools(ffmpeg, { reportDir: stallDir }), { log });
  };

export function benchFootage(deps: FootageDeps = {}): FootageProvider {
  const log = deps.log ?? ((line: string) => console.log(line));
  const ensure = deps.ensure ?? ensureWithSystemTools(log);
  return {
    async prepare(set, layout, stallDir): Promise<Readonly<Record<string, string>>> {
      if (set === 'smoke') return { TAALCUT_E2E_LIBRARY_CACHE: layout.footage('smoke') };
      const dir = layout.footage('ix-v1');
      const started = Date.now();
      const { manifest, generated } = await ensure(IX_V1, dir, stallDir);
      const how = generated ? `generated in ${Math.round((Date.now() - started) / 1000)} s` : 'already there';
      log(
        `[bench] footage ${manifest.set}: ${manifest.clips.length} files, ${manifest.totalSeconds} s, ${how}`,
      );
      return { [BENCH_FOOTAGE_ENV]: dir };
    },
  };
}
