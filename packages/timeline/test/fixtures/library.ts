// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Synthetic libraries for casting tests: deterministic unit embeddings,
 * profiles with 100 ms motion and sharpness curves and full-rate peaks, and a
 * fake Embedder that maps known texts to known vectors.
 */
import {
  FrameRate,
  FrameRates,
  newId,
  ok,
  RationalTime,
  TimeRange,
  type CameraMotion,
  type Embedder,
  type Orientation,
  type ShotProfile,
} from '@taalcut/core';

export const DIMS = 16;

/** mulberry32: a small deterministic generator, so fixtures are the same on every run. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalise(vector: Float32Array): Float32Array {
  const norm = Math.hypot(...vector);
  return norm === 0 ? vector : vector.map((value) => value / norm);
}

export function unitVector(seed: number): Float32Array {
  const next = random(seed);
  return normalise(Float32Array.from({ length: DIMS }, () => next() * 2 - 1));
}

/** `base` nudged by `noise` toward a random direction, renormalised. */
export function near(base: Float32Array, seed: number, noise: number): Float32Array {
  const jitter = unitVector(seed);
  return normalise(base.map((value, index) => value + noise * (jitter[index] as number)));
}

export interface ProfileDef {
  readonly embedding: Float32Array;
  readonly frames?: number;
  readonly rate?: FrameRate;
  readonly motionClass?: CameraMotion | null;
  readonly energy?: number | null;
  readonly quality?: number;
  readonly sharpness?: number;
  readonly faceCount?: number;
  readonly place?: string | null;
  readonly tags?: readonly string[];
  /** FIX-CAST: vision's one line about the shot. */
  readonly description?: string;
  readonly capturedAt?: number | null;
  readonly orientation?: Orientation;
  /** Peak frames from the shot's start; default every 40 frames from 20. */
  readonly peaks?: readonly number[];
  readonly duplicateGroup?: string | null;
  readonly bestTake?: boolean;
  readonly kind?: 'video' | 'image';
  readonly assetId?: string;
  /** The shot's start inside its asset. */
  readonly offset?: number;
}

export function makeProfile(def: ProfileDef): ShotProfile {
  const rate = def.rate ?? FrameRates.fps30;
  const frames = def.frames ?? 300;
  const offset = def.offset ?? 0;
  const peaks = def.peaks ?? Array.from({ length: Math.floor((frames - 20) / 40) + 1 }, (_, index) => 20 + index * 40);
  const samples = Math.floor((frames / FrameRate.toNumber(rate)) * 10);
  const sampleFrame = (index: number) => Math.round((index * 100 * rate.num) / (1000 * rate.den));
  const motionCurve = Array.from({ length: samples }, (_, index) => {
    const frame = sampleFrame(index);
    return peaks.some((peak) => Math.abs(peak - frame) <= 3) ? 0.9 : 0.3;
  });
  const sharpnessCurve = Array.from({ length: samples }, (_, index) => 0.5 + 0.4 * Math.sin(index / 7));
  const assetId = (def.assetId ?? newId<'Asset'>()) as ShotProfile['assetId'];
  const range = TimeRange.of(RationalTime.of(offset, rate), RationalTime.of(frames, rate));
  const image = def.kind === 'image';
  return {
    assetId,
    shotId: image ? null : newId<'Shot'>(),
    kind: image ? 'image' : 'video',
    range: image ? TimeRange.of(RationalTime.zero(rate), RationalTime.zero(rate)) : range,
    available: image ? null : TimeRange.of(RationalTime.zero(rate), RationalTime.of(offset + frames + 30, rate)),
    orientation: def.orientation ?? 'portrait',
    quality: def.quality ?? 0.8,
    sharpness: def.sharpness ?? 0.8,
    motionClass: image ? 'static' : def.motionClass === undefined ? 'handheld' : def.motionClass,
    energy: def.energy ?? null,
    faceCount: def.faceCount ?? 0,
    placeClusterId: def.place ?? null,
    objectTags: def.tags ?? [],
    ...(def.description !== undefined ? { description: def.description } : {}),
    capturedAt: def.capturedAt === undefined ? 1_700_000_000_000 : def.capturedAt,
    fileDate: 1_700_000_000_000,
    duplicateGroup: def.duplicateGroup ?? null,
    bestTake: def.bestTake ?? true,
    sourceId: null,
    embedding: def.embedding,
    motionCurve: image ? null : motionCurve,
    sharpnessCurve: image ? null : sharpnessCurve,
    motionPeakFrames: image ? [] : peaks,
  };
}

/** An Embedder over a table of known texts; unknown texts get a vector from their characters. */
export function fakeEmbedder(table: ReadonlyMap<string, Float32Array>): Embedder & { calls: number } {
  const embedder = {
    calls: 0,
    space: { model: 'fake', revision: 'test', dimensions: DIMS, indexName: 'fake_test' },
    async embedTexts(texts: readonly string[]) {
      embedder.calls++;
      return ok(
        texts.map((text) => table.get(text) ?? unitVector([...text].reduce((sum, char) => sum * 31 + char.charCodeAt(0), 7))),
      );
    },
  };
  return embedder;
}
