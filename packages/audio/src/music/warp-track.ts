// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One generated track onto one beat map (SPEC P3.5 steps 3–5): decode, track, plan the warp, stretch, write the
 * FLAC, track it again and check the grid. A plan outside the ratio guard or a failed check comes back as `retry`
 * with the measured ratio, so the generator can ask for a corrected tempo once.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ok, type AsyncResult, type Timeline } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { decodeAudioFile } from '../pcm/decode';
import { writePcmFile } from '../pcm/encode';
import type { Pcm } from '../pcm/pcm';
import type { TimeStretcher } from '../stretch/stretcher';
import { downbeatTimes, type BeatGrid } from './beat-grid';
import { MUSIC_CONFIG } from './config';
import { checkGrid, type GridCheck } from './grid-check';
import { warpedKey } from './music-files';
import { frameMs, timelineMs } from '../timeline/span';
import { planWarp } from './warp-plan';

/** Beats of an audio file (Phase 2's tracker, run as the `audio.trackBeats` job in the app). */
export interface MusicBeatTracker {
  track(path: string, signal?: AbortSignal): AsyncResult<BeatGrid>;
}

/** Where the warped file goes: the media cache, under a key matching core's DERIVED_KEY_PATTERN. */
export interface DerivedFileWriter {
  put(key: string, bytes: Uint8Array, signal?: AbortSignal): AsyncResult<void>;
}

export interface WarpDeps {
  readonly tracker: MusicBeatTracker;
  readonly stretcher: TimeStretcher;
  readonly derived: DerivedFileWriter;
  readonly media: MediaContext;
}

export interface WarpRequest {
  /** The generated original, as a local file. */
  readonly original: string;
  readonly contentHash: string;
  readonly target: BeatGrid;
  readonly timeline: Timeline;
  /** Scratch folder for the warped file before it goes to the cache. */
  readonly dir: string;
  readonly attempt: number;
  readonly signal?: AbortSignal;
}

export type WarpOutcome =
  | { readonly kind: 'placed'; readonly key: string; readonly grid: GridCheck }
  | {
      readonly kind: 'retry';
      readonly medianRatio: number;
      readonly p95ErrorMs: number;
      readonly reason: string;
    };

export async function warpTrackOnto(deps: WarpDeps, request: WarpRequest): AsyncResult<WarpOutcome> {
  const { signal, target } = request;
  const decoded = await decodeAudioFile(request.original, deps.media, {
    sampleRate: MUSIC_CONFIG.sampleRate,
    channels: 2,
    ...(signal ? { signal } : {}),
  });
  if (!decoded.ok) return decoded;
  const tracked = await deps.tracker.track(request.original, signal);
  if (!tracked.ok) return tracked;
  const plan = planWarp({
    target,
    generated: tracked.value,
    sampleRate: MUSIC_CONFIG.sampleRate,
    sourceFrames: decoded.value.channels[0]?.length ?? 0,
    endMs: timelineMs(request.timeline) + MUSIC_CONFIG.tailMs,
  });
  if (!plan.ok)
    return ok({
      kind: 'retry',
      medianRatio: measuredRatio(target, tracked.value),
      p95ErrorMs: 0,
      reason: plan.error.detail ?? plan.error.code,
    });
  const stretched = await deps.stretcher.stretch(decoded.value, plan.value.segments, signal);
  if (!stretched.ok) return stretched;
  const placed = withLead(stretched.value, plan.value.leadSamples);
  const warpedPath = join(request.dir, `warped-${request.attempt}.flac`);
  const written = await writePcmFile(placed, warpedPath, 'flac', deps.media, signal);
  if (!written.ok) return written;
  const again = await deps.tracker.track(warpedPath, signal);
  if (!again.ok) return again;
  const musicMs = ((placed.channels[0]?.length ?? 0) * 1000) / MUSIC_CONFIG.sampleRate;
  const grid = checkGrid({ target, tracked: again.value, frameMs: frameMs(request.timeline), musicMs });
  if (!grid.passed)
    return ok({
      kind: 'retry',
      medianRatio: plan.value.medianRatio,
      p95ErrorMs: grid.p95ErrorMs,
      reason: 'grid check failed',
    });
  const bytes = await readFile(warpedPath);
  const key = warpedKey(request.contentHash, bytes, target);
  const put = await deps.derived.put(key, bytes, signal);
  if (!put.ok) return put;
  return ok({ kind: 'placed', key, grid });
}

/** Target bar over generated bar on average, for when no warp could be planned at all. */
function measuredRatio(target: BeatGrid, generated: BeatGrid): number {
  const t = downbeatTimes(target);
  const g = downbeatTimes(generated);
  if (t.length < 2 || g.length < 2) return 1;
  const tBar = ((t.at(-1) ?? 0) - (t[0] ?? 0)) / (t.length - 1);
  const gBar = ((g.at(-1) ?? 0) - (g[0] ?? 0)) / (g.length - 1);
  return tBar > 0 && gBar > 0 ? tBar / gBar : 1;
}

/** Silence before the music, so its first paired downbeat lands on the target's. */
function withLead(pcm: Pcm, lead: number): Pcm {
  if (lead <= 0) return pcm;
  return {
    sampleRate: pcm.sampleRate,
    channels: pcm.channels.map((channel) => {
      const out = new Float32Array(channel.length + lead);
      out.set(channel, lead);
      return out;
    }),
  };
}
