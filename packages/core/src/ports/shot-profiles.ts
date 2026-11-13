// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What casting knows about each shot (P2-M2), served by the library from
 * what vision stored (P2-L1, P2-L8), so @taalcut/timeline reads the library
 * without importing it. Casting searches the active embedding space itself
 * (EmbeddingIndexToken) and asks this port for the profiles behind the hits,
 * the story order's pool and the newest shots' vectors (the hook's novelty).
 */
import type { AssetId, ShotId, SourceId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import type { RationalTime } from '../time/rational-time';
import type { TimeRange } from '../time/time-range';
import type { Orientation } from '../analysis/media-facts';
import type { CameraMotion, ShotType } from '../analysis/shot-analysis';

/** One shot, or one photo. */
export interface ShotProfile {
  readonly assetId: AssetId;
  /** Null for a photo. */
  readonly shotId: ShotId | null;
  readonly kind: 'video' | 'image';
  /** The shot inside its asset at the asset's rate; a photo's is empty. */
  readonly range: TimeRange;
  /** The asset's full range at its rate (handles may reach past the shot); null for a photo. */
  readonly available: TimeRange | null;
  readonly orientation: Orientation;
  /** 0..1, 1 best (`ShotAnalysis.quality.overall`). */
  readonly quality: number;
  /** 0..1, shot level. */
  readonly sharpness: number;
  readonly motionClass: CameraMotion | null;
  /** Measured 0..1; null falls back to the motion class's energy. */
  readonly energy: number | null;
  readonly faceCount: number;
  /** Null never matches another null. */
  readonly placeClusterId: string | null;
  readonly objectTags: readonly string[];
  /**
   * FIX-CAST: vision's one-line description of the shot and its shot size, which casting reads for the attributes
   * a person would pick by (night or day, facing away, shot size). Absent or null when the shot isn't described.
   */
  readonly description?: string | null;
  readonly shotType?: ShotType | null;
  /** Epoch ms; null when the file has no capture time. */
  readonly capturedAt: number | null;
  /** Epoch ms of the file: the story order's fallback. */
  readonly fileDate: number;
  /** Near-duplicate group (G25); null when the shot has no near duplicates. */
  readonly duplicateGroup: string | null;
  readonly bestTake: boolean;
  readonly sourceId: SourceId | null;
  /** Unit vector in the active embedding space; empty until the shot is embedded. */
  readonly embedding: Float32Array;
  /** 100 ms samples from the shot's start, 0..1; null until analysed. */
  readonly motionCurve: readonly number[] | null;
  readonly sharpnessCurve: readonly number[] | null;
  /** Frames from the shot's start, at the asset's rate, where motion peaks (full rate). */
  readonly motionPeakFrames: readonly number[];
  /**
   * FIX-TRIM: vision's best frame (`ShotAnalysis.bestFrame`, its sharpest sampled frame), in frames from the shot's
   * start at the asset's rate, inside the shot. Casting's in-point step pulls its window toward it. Absent or null for
   * a photo, or a shot whose analysis has none.
   */
  readonly bestFrame?: number | null;
}

export interface ShotProfileFilter {
  readonly orientations?: readonly Orientation[];
  /** The shot lasts at least this (the media a slot consumes). Photos always pass. */
  readonly minDuration?: RationalTime;
  readonly minQuality?: number;
  /** Epoch ms, inclusive, on the capture time (the file's date when there is none). */
  readonly capturedFrom?: number;
  readonly capturedTo?: number;
  readonly sourceIds?: readonly SourceId[];
  /** Only these assets' shots (a photo is its asset). LRN1-TPL: a footage pool. */
  readonly assetIds?: readonly AssetId[];
  /** Shot ids, or `asset:<id>` for photos, to leave out. */
  readonly exclude?: ReadonlySet<string>;
}

/** A shot by its id, or a photo by its asset id with `shotId` null. */
export interface ShotProfileRef {
  /** May be '' when only the vector id (and so the shot id) is known. */
  readonly assetId: string;
  readonly shotId: string | null;
}

export interface ShotProfileSource {
  /** Profiles of these shots and photos; unknown ones are left out. */
  profiles(refs: readonly ShotProfileRef[], signal?: AbortSignal): AsyncResult<ShotProfile[]>;
  /** Shots that pass the filter, oldest capture first. */
  list(filter: ShotProfileFilter, limit: number, signal?: AbortSignal): AsyncResult<ShotProfile[]>;
  /** The newest shots' vectors by capture time. */
  recent(limit: number, signal?: AbortSignal): AsyncResult<Float32Array[]>;
}

/** The library's profiles over the active embedding space; casting's catalogue reads them. */
export const ShotProfileSourceToken = createToken<ShotProfileSource>('core.shotProfileSource');
