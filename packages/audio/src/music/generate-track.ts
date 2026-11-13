// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Generated music on the timeline's beat map (SPEC P3.5, path c): plan → MusicProvider.compose → the original
 * stored byte for byte → warped onto the beat map and checked (warp-track.ts). A bar outside 0.85–1.15 or a failed
 * check generates once more with the tempo corrected by the measured ratio; a second failure is
 * `audio.music_off_grid`, whose fix keeps the track and re-times the cuts to it (path b). A timeline with no beat
 * map skips the warp: the music's own beats become the grid (path b).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  err,
  FrameRate,
  MUSIC_COMMANDS,
  ok,
  type AssetId,
  type AsyncResult,
  type GeneratedAssetSink,
  type GenerationTrace,
  type MusicChoice,
  type MusicProvider,
  type Timeline,
} from '@taalcut/core';
import { GenerationFailed, GenerationUnavailable } from '../errors';
import { gridBpm, gridFromBeatMap, type BeatGrid } from './beat-grid';
import { composeAttempt } from './compose-attempt';
import type { PlanSection } from './composition-plan';
import { MusicOffGrid } from './errors';
import type { GridCheck } from './grid-check';
import { warpTrackOnto, type WarpDeps } from './warp-track';

export interface MusicGeneratorDeps extends WarpDeps {
  readonly provider: MusicProvider;
  readonly sink: GeneratedAssetSink;
  readonly clock: { now(): number };
  readonly scratchDir?: string;
  /** Ask the provider to sign the track (open question P3.15-1). */
  readonly signWithC2pa?: boolean;
}

export interface GenerateTrackRequest {
  readonly timeline: Timeline;
  readonly mood?: readonly string[];
  readonly prompt?: string;
  readonly vocals?: boolean;
  readonly sections?: readonly PlanSection[];
  readonly gainDb?: number;
  readonly signal?: AbortSignal;
  readonly trace?: GenerationTrace;
}

export interface GeneratedTrack {
  readonly choice: MusicChoice;
  readonly assetId: AssetId;
  readonly bpm: number;
  readonly grid: GridCheck | null;
  readonly warped: boolean;
  readonly attempts: number;
  readonly costUsd: number;
}

const DEFAULT_BPM = 100;
/** Music sits under the voice; the ducking planner takes it lower while someone speaks. */
const DEFAULT_GAIN_DB = -12;
const MS = FrameRate.of(1000, 1);

export function createMusicGenerator(deps: MusicGeneratorDeps) {
  const attempt = (
    request: GenerateTrackRequest,
    bpm: number,
    target: BeatGrid | null,
    dir: string,
    n: number,
  ) => composeAttempt(deps, { request, bpm, target, dir, n });

  return {
    async generate(request: GenerateTrackRequest): AsyncResult<GeneratedTrack> {
      const available = deps.provider.available();
      if (!available.ok) return err(GenerationUnavailable({ reason: available.reason }));
      const target = request.timeline.beatMap ? gridFromBeatMap(request.timeline.beatMap) : null;
      const askedBpm = (target ? gridBpm(target) : null) ?? request.timeline.beatMap?.bpm ?? DEFAULT_BPM;
      const gainDb = request.gainDb ?? DEFAULT_GAIN_DB;
      const dir = await mkdtemp(join(deps.scratchDir ?? tmpdir(), 'taalcut-music-'));
      try {
        let bpm = askedBpm;
        let costUsd = 0;
        for (let n = 1; n <= 2; n++) {
          const made = await attempt(request, bpm, target, dir, n);
          if (!made.ok) return made;
          costUsd += made.value.costUsd;
          const assetId = made.value.stored.assetId;
          const ownTrack: MusicChoice = { path: 'ownTrack', assetId, offset: { value: 0, rate: MS }, gainDb };
          if (!target)
            return ok({ choice: ownTrack, assetId, bpm, grid: null, warped: false, attempts: n, costUsd });
          const warped = await warpTrackOnto(deps, {
            original: made.value.original,
            contentHash: made.value.stored.contentHash,
            target,
            timeline: request.timeline,
            dir,
            attempt: n,
            ...(request.signal ? { signal: request.signal } : {}),
          });
          if (!warped.ok) return warped;
          if (warped.value.kind === 'placed') {
            const { grid, key } = warped.value;
            const choice: MusicChoice = {
              path: 'generated',
              assetId,
              warpedKey: key,
              bpm: askedBpm,
              grid: { maxErrorMs: grid.maxErrorMs, p95ErrorMs: grid.p95ErrorMs, missed: grid.missed },
              gainDb,
            };
            return ok({ choice, assetId, bpm: askedBpm, grid, warped: true, attempts: n, costUsd });
          }
          if (n === 2)
            return err(
              MusicOffGrid(
                { p95ErrorMs: warped.value.p95ErrorMs },
                {
                  detail: warped.value.reason,
                  fix: {
                    command: MUSIC_COMMANDS.choosePath,
                    labelKey: 'fix.music.keepAndRetime',
                    payload: {
                      projectId: request.timeline.projectId,
                      timelineId: request.timeline.id,
                      choice: ownTrack,
                    },
                  },
                },
              ),
            );
          // The generated tempo is about bpm × ratio: ask for bpm / ratio the second time.
          bpm = Math.max(40, Math.min(240, Math.round(askedBpm / warped.value.medianRatio)));
        }
        return err(GenerationFailed(undefined, { detail: 'no attempt finished' }));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
