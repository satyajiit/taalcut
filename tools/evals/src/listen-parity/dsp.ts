// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * listen-parity's signal processing (EAR1-F6), no model: @taalcut/audio's events, cut sync, beat grid and key on the
 * parity clips, against upstream earshot's `timeline` and `measure --music` runs and its beat intermediates.
 *
 * - Onsets: each upstream event matched to the nearest unused one of ours of the same shape within ±5 ms, over every
 *   timeline run; ours past upstream's duration are left out.
 * - Cut sync: the fixture films, with upstream's detected cut list (it equals the planted truth) and frame rate.
 * - BPM within ±1 on the music clips; the key's tonic and mode identical.
 */
import {
  analyseEvents,
  estimateKey,
  monoOf,
  musicGrid,
  stereoOf,
  syncToCuts,
  type EventAnalysis,
  type ListenEvent,
  type SpectrogramRunner,
} from '@taalcut/audio';
import { cli, clips, intermediate, loadClip } from '../../../earshot-parity/fixtures.mjs';
import type { MeasuredMetric } from '../listening/outcome';
import { share } from './stats';

const STATUS: Readonly<Record<string, string>> = {
  OK: 'ok',
  near: 'near',
  swell: 'swell',
  peak: 'peak',
  off: 'off',
  'no sound': 'none',
};

export interface UpstreamEvent {
  readonly t: number;
  readonly shape: 'hit' | 'swell';
}

interface UpstreamSyncItem {
  readonly status: string;
  readonly offset_ms: number | null;
}

interface TimelineRun {
  readonly duration: number;
  readonly events: readonly UpstreamEvent[];
  readonly cuts?: readonly number[];
  readonly fps?: number;
  readonly sync?: { readonly cuts?: { readonly items: readonly UpstreamSyncItem[] } };
}

/** Upstream's events matched one to one, nearest first, to ours of the same shape within `tolS`. */
export function matchEvents(
  ours: readonly Pick<ListenEvent, 't' | 'shape'>[],
  theirs: readonly UpstreamEvent[],
  tolS: number,
): { found: number; extra: number } {
  const used = new Set<number>();
  for (const u of theirs) {
    let best = -1;
    for (let i = 0; i < ours.length; i++) {
      const o = ours[i]!;
      if (used.has(i) || o.shape !== u.shape) continue;
      const d = Math.abs(o.t - u.t);
      if (d <= tolS + 1e-9 && (best < 0 || d < Math.abs(ours[best]!.t - u.t))) best = i;
    }
    if (best >= 0) used.add(best);
  }
  return { found: used.size, extra: ours.length - used.size };
}

/** Offsets agree when both are null, or both are numbers within 1 ms. */
export function offsetsAgree(ours: number | null, theirs: number | null): boolean {
  return ours === null ? theirs === null : theirs !== null && Math.abs(ours - theirs) <= 1;
}

const audioOf = (id: string) => {
  const clip = loadClip(id);
  return { sampleRate: clip.sampleRate, channels: clip.channels };
};

export async function dspParity(runner: SpectrogramRunner, notes: string[]): Promise<MeasuredMetric[]> {
  const runs = cli<TimelineRun>('timeline');
  const analysed = new Map<string, EventAnalysis>();
  let upstreamEvents = 0;
  let found = 0;
  let extra = 0;
  let ourEvents = 0;
  for (const [id, run] of Object.entries(runs)) {
    const analysis = await analyseEvents(audioOf(id), runner);
    if (run.result.sync?.cuts) analysed.set(id, analysis);
    const mine = analysis.events.filter((e) => e.t < run.result.duration);
    const m = matchEvents(mine, run.result.events, 0.005);
    upstreamEvents += run.result.events.length;
    found += m.found;
    extra += m.extra;
    ourEvents += mine.length;
  }

  let cuts = 0;
  let sameStatus = 0;
  let sameOffset = 0;
  for (const row of clips('film')) {
    const up = runs[row.id]?.result;
    const items = up?.sync?.cuts?.items;
    const analysis = analysed.get(row.id);
    if (!up?.cuts || !items || !analysis) continue;
    const audio = audioOf(row.id);
    const grid = await musicGrid(monoOf(stereoOf(audio)), runner);
    const beats = grid.confidence === 'clear' || grid.confidence === 'weak' ? grid.beats : undefined;
    const result = syncToCuts([...up.cuts], analysis.events, {
      frameRate: { num: up.fps ?? 30, den: 1 },
      levels: analysis.levels,
      ...(beats ? { beats } : {}),
      durationS: up.duration,
    });
    items.forEach((theirs, i) => {
      const mine = result.items[i];
      cuts += 1;
      if (mine?.status === STATUS[theirs.status]) sameStatus += 1;
      else
        notes.push(`- ${row.id} cut ${i}: ${mine?.status ?? 'missing'} where upstream says ${theirs.status}`);
      if (mine && offsetsAgree(mine.offsetMs, theirs.offset_ms)) sameOffset += 1;
    });
  }

  const grids = intermediate<Record<string, { grid: { tempo: number | null } }>>('beats');
  let musicClips = 0;
  let tempoWithin = 0;
  for (const [id, { grid }] of Object.entries(grids)) {
    if (!id.startsWith('music-')) continue;
    const mine = await musicGrid(monoOf(stereoOf(audioOf(id))), runner);
    musicClips += 1;
    const ok = grid.tempo === null ? mine.tempo === null : Math.abs((mine.tempo ?? -99) - grid.tempo) <= 1;
    if (ok) tempoWithin += 1;
    else notes.push(`- ${id}: ${mine.tempo ?? 'no'} BPM where upstream says ${grid.tempo ?? 'none'}`);
  }

  const measures = cli<{ key?: readonly { key: string }[] }>('measure');
  let keyed = 0;
  let sameKey = 0;
  for (const row of clips('music')) {
    const want = measures[row.id]?.result.key?.[0]?.key;
    const keys = await estimateKey(monoOf(stereoOf(audioOf(row.id))), runner);
    const got = keys[0] ? `${keys[0].tonic} ${keys[0].mode}` : undefined;
    keyed += 1;
    if (got === want) sameKey += 1;
    else notes.push(`- ${row.id}: key ${got ?? 'none'} where upstream says ${want ?? 'none'}`);
  }

  const part = 'dsp';
  return [
    {
      name: 'onsetMatchRate',
      value: share(found, upstreamEvents),
      better: 'higher',
      part,
      over: `${upstreamEvents} upstream events in ${Object.keys(runs).length} timeline runs, ±5 ms`,
    },
    {
      name: 'onsetExtraRate',
      value: share(extra, ourEvents),
      better: 'lower',
      part,
      over: `${ourEvents} of ours`,
    },
    {
      name: 'syncStatusAgreement',
      value: share(sameStatus, cuts),
      better: 'higher',
      part,
      over: `${cuts} cuts in ${clips('film').length} films`,
    },
    { name: 'syncOffsetAgreement', value: share(sameOffset, cuts), better: 'higher', part, over: '±1 ms' },
    {
      name: 'bpmWithin1Rate',
      value: share(tempoWithin, musicClips),
      better: 'higher',
      part,
      over: `${musicClips} music clips`,
    },
    {
      name: 'keyAgreement',
      value: share(sameKey, keyed),
      better: 'higher',
      part,
      over: `${keyed} music clips`,
    },
  ];
}
