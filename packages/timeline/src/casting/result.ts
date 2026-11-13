// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Turns searched sequences into what casting returns: per slot the pick, alternates and confidence. */
import {
  RationalTime,
  type CastCandidate,
  type FrameRate,
  type MediaRef,
  type ShotProfile,
  type SlotCast,
} from '@taalcut/core';
import { sourceFrames } from '../model/speed';
import { slotChoice, toCastCandidate, type Adjacency } from './alternates';
import type { Candidate, SlotPool } from './candidates';
import type { CastingConfig } from './config';
import type { SlotSpec } from './slots';
import { swapOptions, type SwapOption } from './swaps';
import type { Variant } from './variants';

export interface CastVariant {
  readonly slots: SlotCast[];
  /** Unary scores minus neighbour penalties. */
  readonly score: number;
  readonly sequenceConfidence: number;
  /** Media of every pick and alternate, for assembly and swaps. */
  readonly media: MediaRef[];
  /**
   * FIX-STORY: for each unsure slot with no alternate, the other slots' picks that could change places with
   * its pick (swaps.ts), best first: what a rerank in a library with no spare shot can order. Absent with none.
   */
  readonly swaps?: { readonly slotId: SlotCast['slotId']; readonly options: readonly SwapOption[] }[];
}

export function mediaRef(profile: ShotProfile): MediaRef {
  if (profile.kind === 'image') return { kind: 'image', assetId: profile.assetId };
  return {
    kind: 'video',
    assetId: profile.assetId,
    shotId: profile.shotId,
    available: profile.available ?? profile.range,
  };
}

/** The sync point of a fixed in-point: a peak within the beat tolerance of the anchor, else null. */
export function syncPointAt(
  profile: ShotProfile,
  slot: SlotSpec,
  sourceStart: RationalTime,
  canvasRate: FrameRate,
  config: CastingConfig,
): RationalTime | null {
  const anchor = slot.anchorRel;
  if (anchor === null || profile.kind === 'image') return null;
  const rate = profile.range.start.rate;
  const offset = RationalTime.subtract(
    RationalTime.rescale(sourceStart, rate, 'round'),
    profile.range.start,
  ).value;
  // The media the slot plays before the anchor (its ramp's integral), within the beat tolerance either side.
  const perCanvas = (rate.num * canvasRate.den) / (rate.den * canvasRate.num);
  const tolerance = config.inPoint.beatToleranceFrames;
  const low = sourceFrames(slot.speed, anchor - tolerance) * perCanvas - 1e-9;
  const high = sourceFrames(slot.speed, anchor + tolerance) * perCanvas + 1e-9;
  const peak = profile.motionPeakFrames.find((frame) => frame - offset >= low && frame - offset <= high);
  return peak === undefined ? null : RationalTime.add(profile.range.start, RationalTime.of(peak, rate));
}

export interface LockedPick {
  readonly sourceStart: RationalTime;
}

function noteOf(pool: SlotPool, pick: Candidate | null): SlotCast['note'] {
  if (pool.locked) return 'userPick';
  if (!pick) return 'noCandidates';
  if (pool.relaxed && pick.profile.orientation !== pool.slot.orientation) return 'orientationRelaxed';
  return pool.reranked ? 'reranked' : null;
}

export function buildVariant(
  variant: Variant,
  pools: readonly SlotPool[],
  locked: ReadonlyMap<number, LockedPick>,
  context: { readonly adjacency: Adjacency; readonly config: CastingConfig; readonly canvasRate: FrameRate },
): CastVariant {
  const { adjacency, config, canvasRate } = context;
  const media = new Map<string, MediaRef>();
  const slots = pools.map((pool, index): SlotCast => {
    const choice = slotChoice(pools, variant.sequence, index, adjacency, config);
    const fixed = locked.get(index);
    let pick: CastCandidate | null = null;
    if (choice.pick) {
      const profile = choice.pick.candidate.profile;
      const point = fixed
        ? {
            sourceStart: fixed.sourceStart,
            syncPoint: syncPointAt(profile, pool.slot, fixed.sourceStart, canvasRate, config),
          }
        : undefined;
      pick = toCastCandidate(choice.pick, pool, canvasRate, config, point);
      if (pick) media.set(choice.pick.candidate.key, mediaRef(profile));
    }
    const alternates = choice.alternates.flatMap((entry) => {
      const candidate = toCastCandidate(entry, pool, canvasRate, config);
      if (candidate) media.set(entry.candidate.key, mediaRef(entry.candidate.profile));
      return candidate ? [candidate] : [];
    });
    const confidence = pick ? choice.confidence : null;
    return {
      slotId: pool.slot.slotId,
      clipId: null,
      pick,
      alternates,
      confidence,
      needsRerank: confidence !== null && !pool.locked && confidence < config.confidence.rerankBelow,
      note: noteOf(pool, pick ? (choice.pick?.candidate ?? null) : null),
    };
  });
  const tau = config.confidence.tau * Math.max(1, pools.length);
  const margin = variant.runnerUp;
  const swaps = slots.flatMap((slot, index) => {
    if (!slot.needsRerank || slot.alternates.length > 0) return [];
    const options = swapOptions(pools, variant.sequence, index, context, config.rerank.count - 1);
    return options.length > 0 ? [{ slotId: slot.slotId, options }] : [];
  });
  return {
    slots,
    score: variant.sequence.score,
    sequenceConfidence: margin === null ? 1 : margin / (margin + tau),
    media: [...media.values()],
    ...(swaps.length > 0 ? { swaps } : {}),
  };
}
