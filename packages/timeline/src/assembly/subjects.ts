// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: subject tracks for every clip of a made video, before its first draft. `timeline.assemble` asks core's
 * SubjectSource to make (or join) the tracks of every pick's range as soon as the cast is known, and waits for them
 * within a budget before it assembles, so placement, preview, QA and reframing all read tracks that exist. A range
 * not tracked in time is still being tracked by the jobs queue; the export joins it. Also: the clips' frame sizes,
 * so assembly can reframe a clip whose aspect isn't the canvas's. (Until TXT1 it also tracked what placement's retime
 * and recast read; they are gone, and so are those tracks.)
 */
import {
  RationalTime,
  type AssetId,
  type AsyncResult,
  type Clip,
  type FrameRate,
  type SubjectClipRange,
  type SubjectSource,
  type Template,
  type Timeline,
} from '@taalcut/core';
import type { CastResult } from '../casting/engine';
import { candidateKey } from '../model/cast';
import { consumedMedia } from '../model/speed';

/** The upright frame sizes of assets, by id; an asset the library doesn't know is left out. */
export type FrameSizes = (
  assetIds: readonly AssetId[],
) => AsyncResult<ReadonlyMap<AssetId, { readonly width: number; readonly height: number }>>;

export interface SubjectDeps {
  readonly subjects?: SubjectSource;
  readonly frameSizes?: FrameSizes;
  /** How long assembly waits for the tracks. Default 90 s (the tool's own limit is 120 s). */
  readonly subjectBudgetMs?: number;
}

export const SUBJECT_BUDGET_MS = 90_000;

/** A video clip's source range: from its in-point, the media its slot plays at its ramp. */
function rangeOf(
  assetId: AssetId,
  sourceStart: RationalTime,
  clip: Pick<Clip, 'duration' | 'speed'>,
  mediaRate: FrameRate,
  canvasRate: FrameRate,
): SubjectClipRange {
  const used = consumedMedia(clip, mediaRate, canvasRate);
  const start = RationalTime.rescale(sourceStart, mediaRate, 'floor');
  return { assetId, start, end: RationalTime.add(start, RationalTime.rescale(used, mediaRate, 'ceil')) };
}

const keyOf = (range: SubjectClipRange) => `${range.assetId}:${range.start.value}:${range.end.value}`;

/** Every video pick's range across the cast's variants, once each. */
export function castRanges(template: Template, cast: CastResult): SubjectClipRange[] {
  const slots = new Map(template.slots.map((slot) => [slot.id as string, slot]));
  const ranges = new Map<string, SubjectClipRange>();
  for (const variant of cast.variants) {
    const media = new Map(
      variant.media.map((ref) => [
        candidateKey({ assetId: ref.assetId, shotId: ref.kind === 'video' ? ref.shotId : null }),
        ref,
      ]),
    );
    for (const slotCast of variant.slots) {
      const pick = slotCast.pick;
      const slot = slots.get(slotCast.slotId);
      const ref = pick ? media.get(candidateKey(pick)) : undefined;
      if (!pick || !slot || ref?.kind !== 'video') continue;
      const range = rangeOf(
        ref.assetId,
        pick.sourceStart,
        { duration: slot.duration, speed: slot.speedRamp },
        ref.available.start.rate,
        template.canvas.rate,
      );
      ranges.set(keyOf(range), range);
    }
  }
  return [...ranges.values()];
}

/** Every enabled video clip's range in a timeline (after an edit, a swap or a gap's fix). */
export function timelineRanges(timeline: Timeline): SubjectClipRange[] {
  const ranges: SubjectClipRange[] = [];
  for (const track of timeline.tracks) {
    if (track.kind !== 'video') continue;
    for (const item of track.items) {
      if (item.type !== 'clip' || !item.enabled || item.media.kind !== 'video') continue;
      ranges.push(
        rangeOf(
          item.media.assetId,
          item.sourceStart,
          item,
          item.media.available.start.rate,
          timeline.canvas.rate,
        ),
      );
    }
  }
  return ranges;
}

export interface EnsureReport {
  readonly ranges: number;
  readonly ms: number;
  /** Every range has a track. */
  readonly done: boolean;
  readonly reason?: string;
}

/**
 * Makes the tracks and waits, at most `budgetMs`. Never fails the caller: tracks are what placement reads first,
 * and a range left untracked is reported, not fatal (the queue keeps tracking it).
 */
export async function ensureSubjects(
  source: SubjectSource,
  ranges: readonly SubjectClipRange[],
  budgetMs: number = SUBJECT_BUDGET_MS,
  now: () => number = Date.now,
): Promise<EnsureReport> {
  const started = now();
  if (ranges.length === 0) return { ranges: 0, ms: 0, done: true };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), budgetMs);
  });
  // No signal: a track still running when the budget ends finishes in the queue for the export to read.
  const made = await Promise.race([source.ensure(ranges), late]);
  if (timer) clearTimeout(timer);
  const ms = now() - started;
  if (made === 'late') return { ranges: ranges.length, ms, done: false, reason: 'budget' };
  return made.ok
    ? { ranges: ranges.length, ms, done: true }
    : { ranges: ranges.length, ms, done: false, reason: made.error.code };
}

/** Width over height of each picked video's frame, for assembly's reframe; empty when sizes can't be read. */
export async function castAspects(
  sizes: FrameSizes | undefined,
  cast: CastResult,
): Promise<Map<string, number>> {
  const aspects = new Map<string, number>();
  if (!sizes) return aspects;
  const ids = new Set<AssetId>();
  for (const variant of cast.variants)
    for (const ref of variant.media) if (ref.kind === 'video') ids.add(ref.assetId);
  const read = await sizes([...ids]);
  if (!read.ok) return aspects;
  for (const [id, size] of read.value)
    if (size.width > 0 && size.height > 0) aspects.set(id, size.width / size.height);
  return aspects;
}

/** What the assembly waits for: the picks' tracks (the first draft's). */
export interface AssemblyTracks {
  readonly picks: EnsureReport;
  /** The cast the video is made from: `refine`'s when one ran, else the one given. */
  readonly cast: CastResult;
}

/** FIX-TRIM: a step after the picks' tracks: the cast changed in what is left of the budget. */
export type CastRefiner = (cast: CastResult, budgetMs: number) => Promise<CastResult>;

/**
 * The picks' tracks within `budgetMs`, then `refine` (FIX-TRIM: the in-points with the person, person-in-points.ts)
 * in what is left of it. A clip `refine` moved has its track asked for when the timeline is laid out
 * (placement/run-placement.ts).
 */
export async function ensureForAssembly(
  source: SubjectSource,
  template: Template,
  cast: CastResult,
  budgetMs: number = SUBJECT_BUDGET_MS,
  now: () => number = Date.now,
  refine?: CastRefiner,
): Promise<AssemblyTracks> {
  const started = now();
  const picks = await ensureSubjects(source, castRanges(template, cast), budgetMs, now);
  const refined = refine ? await refine(cast, Math.max(0, budgetMs - (now() - started))) : cast;
  return { picks, cast: refined };
}
