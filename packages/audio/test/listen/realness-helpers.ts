// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Shared by the EAR1-A1 realness and critique tests: upstream's realness fixtures as the port's inputs. */
import { blob, blobRows } from '../../../../tools/earshot-parity/fixtures.mjs';
import type { RealnessResult } from '../../src/listen/realness/realness';

/** fixtures/intermediates/realness.json, per clip. */
export interface UpstreamRealnessClip {
  readonly gain_db: number;
  readonly embeddings: string | null;
  readonly windows: readonly {
    readonly start: number;
    readonly end: number;
    readonly live: boolean;
    readonly features?: Readonly<Record<string, number>>;
    readonly logits?: { readonly clap: number; readonly signal: number };
    readonly p_real?: number;
    readonly tone?: boolean;
    readonly clapLogitCheck?: number;
  }[];
}

/** `earshot realness <clip>` (fixtures/cli/realness.json). */
export interface UpstreamRealness {
  readonly duration: number;
  readonly p_real: number | null;
  readonly verdict: 'real or pro-produced' | 'uncertain' | 'likely code-synthesized' | 'silent';
  readonly segments?: readonly {
    readonly start: number;
    readonly end: number;
    readonly p_real: number | null;
    readonly verdict: 'real or pro-produced' | 'uncertain' | 'likely code-synthesized' | 'silent';
  }[];
  readonly synth_windows?: number;
  readonly lean_synth_windows?: number;
  readonly p_real_min?: number;
  readonly evidence?: readonly string[];
}

/**
 * What the CLAP head reads per window: the stored embedding where the fixtures keep it, else upstream's own CLAP
 * logit for that window (the films and most music clips, left out of the fixtures for size); undefined when silent.
 */
export function upstreamWindows(
  up: UpstreamRealnessClip,
): ({ embedding: Float32Array } | { logit: number } | undefined)[] {
  const stored = up.embeddings ? blobRows(up.embeddings) : [];
  const live = up.embeddings ? ((blob(up.embeddings).info['windows'] as number[] | undefined) ?? [0]) : [];
  return up.windows.map((w, i) => {
    if (!w.live) return undefined;
    const j = live.indexOf(i);
    const embedding = j >= 0 ? stored[j] : undefined;
    return embedding ? { embedding } : { logit: w.clapLogitCheck ?? w.logits?.clap ?? 0 };
  });
}

/** Upstream's realness CLI result as the port's RealnessResult (what the critique reads of it). */
export function realnessFromCli(cli: UpstreamRealness): RealnessResult {
  return {
    duration: cli.duration,
    pReal: cli.p_real,
    verdict: cli.verdict,
    long: Boolean(cli.segments),
    gainDb: 0,
    toneWindows: 0,
    borderline: false,
    ...(cli.segments
      ? {
          segments: cli.segments.map((s) => ({
            start: s.start,
            end: s.end,
            pReal: s.p_real,
            verdict: s.verdict,
          })),
          ...(cli.synth_windows !== undefined ? { synthWindows: cli.synth_windows } : {}),
        }
      : {}),
  };
}
