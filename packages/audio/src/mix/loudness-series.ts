// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Momentary (400 ms) and short-term (3 s) loudness of a stem every 100 ms, from FFmpeg's `ebur128` with
 * `metadata=1` (keys `lavfi.r128.M`, `lavfi.r128.S`) written by `ametadata`. Both are ungated, K-weighted LUFS.
 * There is no GPU loudness API, so this is one of Phase 2's accepted CPU paths; the first run per meter logs
 * a `compute.fallback` (`no_accelerator`).
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeFallbackEvent,
  cpuFallback,
  err,
  ok,
  type AsyncResult,
  type ComputeFallbackEvent,
} from '@taalcut/core';
import { runFfmpeg, type MediaContext } from '@taalcut/media';
import { MIX_CONFIG } from './config';
import { LoudnessFailed } from './errors';

export interface LoudnessSeries {
  /** Frame i covers the audio up to (i + 1) × 100 ms. */
  readonly momentary: readonly number[];
  readonly shortTerm: readonly number[];
}

export const LOUDNESS_OPERATION = 'audio.loudnessSeries';

/** `lavfi.r128.M=-23.4` lines → numbers; `-inf` and anything unreadable is silence. */
export function parseLoudnessLog(text: string): LoudnessSeries {
  const momentary: number[] = [];
  const shortTerm: number[] = [];
  const value = (raw: string) => {
    const n = Number(raw);
    return Number.isFinite(n)
      ? Math.max(n, MIX_CONFIG.envelope.silenceLufs)
      : MIX_CONFIG.envelope.silenceLufs;
  };
  for (const line of text.split('\n')) {
    const m = /^lavfi\.r128\.M=(\S+)/.exec(line);
    if (m?.[1] !== undefined) momentary.push(value(m[1]));
    const s = /^lavfi\.r128\.S=(\S+)/.exec(line);
    if (s?.[1] !== undefined) shortTerm.push(value(s[1]));
  }
  return { momentary, shortTerm };
}

export interface LoudnessMeter {
  measure(path: string, signal?: AbortSignal): AsyncResult<LoudnessSeries>;
}

export function createLoudnessMeter(deps: {
  readonly media: MediaContext;
  readonly scratchDir?: string;
  readonly onComputeFallback?: (event: ComputeFallbackEvent) => void;
}): LoudnessMeter {
  let logged = false;
  return {
    async measure(path, signal) {
      if (!logged) {
        logged = true;
        const choice = cpuFallback('no_accelerator', 'ebur128 loudness series');
        if (choice.fallback)
          deps.onComputeFallback?.(computeFallbackEvent(LOUDNESS_OPERATION, ['cpu'], choice.fallback));
      }
      const dir = await mkdtemp(join(deps.scratchDir ?? tmpdir(), 'taalcut-r128-'));
      const log = join(dir, 'r128.txt');
      try {
        const run = await runFfmpeg(
          deps.media,
          [
            '-nostdin',
            '-i',
            path,
            '-vn',
            '-af',
            `ebur128=metadata=1,ametadata=mode=print:file=${log}`,
            '-f',
            'null',
            '-',
          ],
          // Audio only: a stop keeps SIGTERM then SIGKILL (IX3-K2).
          { holdsVideoSession: false, timeoutMs: 300_000, ...(signal ? { signal } : {}) },
        );
        if (!run.ok) return run;
        const series = parseLoudnessLog(await readFile(log, 'utf8'));
        if (series.momentary.length === 0)
          return err(LoudnessFailed(undefined, { detail: 'ebur128 wrote no frames' }));
        return ok(series);
      } catch (cause) {
        return err(
          LoudnessFailed(undefined, {
            detail: cause instanceof Error ? cause.message.slice(0, 300) : 'failed',
          }),
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
