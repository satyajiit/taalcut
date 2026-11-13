// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * listen-parity's realness (EAR1-A1): @taalcut/audio's `realnessOf` against upstream earshot's `realness` runs.
 *
 * - From upstream's embeddings (no model): the clips whose CLAP window embeddings the fixtures keep (every clip but
 *   the films and 9 music clips, kept out for size) answer the CLAP head through a stand-in embedder.
 * - End to end (one dtype): our CLAP audio on every clip. A verdict that differs should sit within
 *   REALNESS_BORDERLINE of a threshold; the ones that don't are listed.
 */
import { isRealnessBorderline, realnessOf, type RealnessEmbedder, type RealnessResult } from '@taalcut/audio';
import { ok } from '@taalcut/core';
import {
  blobRows,
  cliRun,
  ffmpegMono,
  intermediate,
  loadClip,
  manifest,
} from '../../../earshot-parity/fixtures.mjs';
import type { ListenDtype } from '../listening/environment';
import type { MeasuredMetric } from '../listening/outcome';
import { maxOf, share } from './stats';

/** `earshot realness <clip>` (fixtures/cli/realness.json). */
export interface UpstreamRealness {
  readonly duration: number;
  readonly p_real: number | null;
  readonly verdict: RealnessResult['verdict'];
  readonly segments?: readonly {
    readonly start: number;
    readonly end: number;
    readonly p_real: number | null;
    readonly verdict: RealnessResult['verdict'];
  }[];
  readonly synth_windows?: number;
}

interface Tally {
  readonly deltas: number[];
  compared: number;
  same: number;
  readonly differ: string[];
}

function tally(
  t: Tally,
  id: string,
  ours: RealnessResult,
  up: UpstreamRealness,
  flagBorderline: boolean,
): void {
  t.compared += 1;
  if (ours.verdict === up.verdict) t.same += 1;
  else {
    const borderline = flagBorderline && isRealnessBorderline(ours) ? ', borderline' : '';
    t.differ.push(
      `- ${id}: ${ours.verdict} (p ${ours.pReal}) where upstream says ${up.verdict} (p ${up.p_real})${borderline}`,
    );
  }
  // A p on one side only (silent on the other) shows as a differing verdict.
  if (up.p_real !== null && ours.pReal !== null) t.deltas.push(Math.abs(ours.pReal - up.p_real));
}

function metrics(t: Tally, prefix: string, part: string, over: string): MeasuredMetric[] {
  return [
    {
      name: `${prefix}MaxDelta`,
      value: maxOf(t.deltas),
      better: 'lower',
      part,
      over: `${t.deltas.length} p_real`,
    },
    {
      name: `${prefix}VerdictAgreement`,
      value: share(t.same, t.compared),
      better: 'higher',
      part,
      over,
    },
  ];
}

/** From the embeddings upstream stored: no model runs. */
export async function realnessFromUpstream(notes: string[]): Promise<MeasuredMetric[]> {
  const prompts = blobRows('realness/prompts');
  const stored = intermediate<{ clips: Record<string, { embeddings: string | null }> }>('realness').clips;
  const t: Tally = { deltas: [], compared: 0, same: 0, differ: [] };
  let unstored = 0;
  for (const clip of manifest().clips) {
    const key = stored[clip.id]?.embeddings;
    if (!key) {
      unstored += 1;
      continue;
    }
    const rows = blobRows(key);
    const embedder: RealnessEmbedder = {
      embedSegments: async (segments) => {
        if (segments.length !== rows.length)
          throw new Error(`${clip.id}: ${segments.length} realness windows, upstream stored ${rows.length}`);
        return ok(rows);
      },
    };
    const r = await realnessOf(ffmpegMono(loadClip(clip.id)), embedder, { prompts });
    if (!r.ok) throw new Error(`listen-parity: realness on ${clip.id}: ${r.error.code}`);
    tally(t, clip.id, r.value, cliRun<UpstreamRealness>('realness', clip.id), false);
  }
  notes.push(...t.differ);
  return metrics(t, 'realness', 'realness', `${t.compared} clips (${unstored} without stored embeddings)`);
}

/** End to end in one dtype: our CLAP audio on every clip. The results are kept for the critique. */
export async function realnessEndToEnd(
  embedder: RealnessEmbedder,
  dtype: ListenDtype,
  notes: string[],
): Promise<{ metrics: MeasuredMetric[]; results: Map<string, RealnessResult> }> {
  const t: Tally = { deltas: [], compared: 0, same: 0, differ: [] };
  const results = new Map<string, RealnessResult>();
  for (const clip of manifest().clips) {
    const r = await realnessOf(ffmpegMono(loadClip(clip.id)), embedder);
    if (!r.ok) throw new Error(`listen-parity: ${dtype} realness on ${clip.id}: ${r.error.code}`);
    results.set(clip.id, r.value);
    tally(t, clip.id, r.value, cliRun<UpstreamRealness>('realness', clip.id), true);
  }
  notes.push(...t.differ);
  return { metrics: metrics(t, `${dtype}Realness`, dtype, `${t.compared} clips`), results };
}
