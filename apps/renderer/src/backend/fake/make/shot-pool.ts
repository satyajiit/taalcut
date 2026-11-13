// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Shots the Make fakes cast from: real clips of the fake library (the same
 * ids, files and painted frames the Library page shows), each a candidate
 * as the casting engine would score it. Only upright, indexed, online video
 * whose shot is long enough to give a clip room to be trimmed and moved.
 */
import {
  RationalTime,
  type AssetId,
  type CastCandidate,
  type DerivedFileRef,
  type FrameRate,
  type ShotId,
  type TimeRange,
} from '@taalcut/core';
import { fakeAsset, fakeSources, DEFAULT_ASSET_COUNT } from '../library/assets';
import { fakeAssetDetail } from '../library/detail';
import { prng } from '../library/seed';

export interface PoolShot {
  readonly candidate: CastCandidate;
  /** The clip's whole media at its own rate (a timeline clip's `available`). */
  readonly available: TimeRange;
  /** The shot inside it. */
  readonly shot: TimeRange;
  readonly name: string;
  /** The shot's frame, for project posters. */
  readonly thumbnail: DerivedFileRef;
}

/** Seconds of shot a pick needs: the longest slot plus room for trims either side. */
const MIN_SHOT_SECONDS = 2.4;

/**
 * `want` shots in a fixed order for `seed`. Walks the library from a seeded
 * start with a stride, so different seeds give different footage.
 */
export function shotPool(want: number, seed: number, count = DEFAULT_ASSET_COUNT): PoolShot[] {
  const sources = fakeSources();
  const random = prng(seed * 6151 + 7);
  const pool: PoolShot[] = [];
  if (count === 0) return pool;
  const stride = 37 + seed * 2;
  let n = Math.floor(random() * count);
  for (let tries = 0; pool.length < want && tries < count; tries += 1) {
    n = (n + stride) % count;
    const asset = fakeAsset(n, count, sources);
    const { summary } = asset;
    if (
      summary.kind !== 'video' ||
      summary.orientation !== 'portrait' ||
      summary.availability !== 'online' ||
      summary.index.state !== 'done' ||
      !summary.duration
    )
      continue;
    const source = sources.find((s) => s.id === summary.sourceIds[0]) ?? sources[0]!;
    const detail = fakeAssetDetail(asset, source);
    const shot = detail.shots.find(
      (candidate) => RationalTime.toSeconds(candidate.range.duration) >= MIN_SHOT_SECONDS,
    );
    if (!shot?.thumbnail) continue;
    const quality = shot.quality ?? 0.6;
    const intent = 0.5 + random() * 0.45;
    pool.push({
      candidate: {
        assetId: summary.id as AssetId,
        shotId: shot.id as ShotId,
        sourceStart: shot.range.start,
        syncPoint: null,
        score: Math.round((intent * 0.5 + quality * 0.3 + random() * 0.2) * 1000) / 1000,
        parts: {
          intent: Math.round(intent * 100) / 100,
          motion: Math.round(random() * 100) / 100,
          quality: Math.round(quality * 100) / 100,
          subject: Math.round(random() * 100) / 100,
          energy: Math.round(random() * 100) / 100,
          hook: null,
          rerank: null,
          penalty: 0,
        },
      },
      available: { start: RationalTime.zero(summary.duration.rate), duration: summary.duration },
      shot: shot.range,
      name: summary.name,
      thumbnail: shot.thumbnail as DerivedFileRef,
    });
  }
  return pool;
}

/**
 * Where a clip of `frames` at `rate` starts in a shot: its middle, so trims
 * and moves have media on both sides. The result is at the media's rate.
 */
export function centredStart(shot: PoolShot, frames: number, rate: FrameRate): RationalTime {
  const mediaRate = shot.shot.start.rate;
  const needed = RationalTime.rescale(RationalTime.of(frames, rate), mediaRate, 'ceil').value;
  const spare = Math.max(0, shot.shot.duration.value - needed);
  return RationalTime.of(shot.shot.start.value + Math.floor(spare / 2), mediaRate);
}
