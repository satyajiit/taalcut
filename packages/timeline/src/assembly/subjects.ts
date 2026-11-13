// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: subject tracks for every clip of a made video, before its first draft. `timeline.assemble` asks core's
 * SubjectSource to make (or join) the tracks of every pick's range as soon as the cast is known, and waits for them
 * within a budget before it assembles, so placement, preview, QA and reframing all read tracks that exist. A range
 * not tracked in time is still being tracked by the jobs queue; the export joins it. Then, with what is left of the
 * budget, the ranges placement's fallbacks read (`fallbackRanges`): each pick widened by retime's reach, and each
 * slot's first alternates, so retime and recast have people to place by. Also: the clips' frame sizes, so assembly
 * can reframe a clip whose aspect isn't the canvas's.
 */
import {
  RationalTime,
  TimeRange,
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
import { RETIME } from './placement/fallbacks';

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

/** How far placement's retime moves a clip's in-point either way (its RETIME steps), in seconds. */
export const RETIME_REACH_SECONDS = RETIME.stepSeconds * RETIME.steps;
/** The alternates per slot tracked ahead of placement's recast, in casting's order (it keeps three). */
export const ALTERNATES_TRACKED = 2;
/**
 * Fallback ranges are tracked this much wider than placement reads them, so a range it works out a frame
 * differently (its own rounding of a clip's span) still lies inside a stored track.
 */
const SLACK_SECONDS = 0.25;

/** A range widened by `seconds` each way, inside the media's usable range. */
export function widened(range: SubjectClipRange, seconds: number, available: TimeRange): SubjectClipRange {
  const rate = range.start.rate;
  const by = RationalTime.fromSeconds(seconds, rate, 'ceil');
  const first = RationalTime.rescale(available.start, rate, 'ceil');
  const last = RationalTime.rescale(TimeRange.end(available), rate, 'floor');
  const start = RationalTime.max(first, RationalTime.subtract(range.start, by));
  const end = RationalTime.min(last, RationalTime.add(range.end, by));
  return RationalTime.isBefore(start, end) ? { assetId: range.assetId, start, end } : range;
}

const keyOf = (range: SubjectClipRange) => `${range.assetId}:${range.start.value}:${range.end.value}`;

/** Each video pick across the cast's variants, with its slot, media and the variant's media by candidate. */
function eachPick(template: Template, cast: CastResult) {
  const slots = new Map(template.slots.map((slot) => [slot.id as string, slot]));
  return cast.variants.flatMap((variant) => {
    const media = new Map(
      variant.media.map((ref) => [
        candidateKey({ assetId: ref.assetId, shotId: ref.kind === 'video' ? ref.shotId : null }),
        ref,
      ]),
    );
    return variant.slots.flatMap((slotCast) => {
      const pick = slotCast.pick;
      const slot = slots.get(slotCast.slotId);
      const ref = pick ? media.get(candidateKey(pick)) : undefined;
      if (!pick || !slot || ref?.kind !== 'video') return [];
      const clip = { duration: slot.duration, speed: slot.speedRamp };
      /** The span this slot plays of a clip from `sourceStart`. */
      const rangeAt = (assetId: AssetId, sourceStart: RationalTime, rate: FrameRate) =>
        rangeOf(assetId, sourceStart, clip, rate, template.canvas.rate);
      const range = rangeAt(ref.assetId, pick.sourceStart, ref.available.start.rate);
      return [{ slotCast, ref, media, range, rangeAt }];
    });
  });
}

/** Every video pick's range across the cast's variants, once each. */
export function castRanges(template: Template, cast: CastResult): SubjectClipRange[] {
  const ranges = new Map<string, SubjectClipRange>();
  for (const { range } of eachPick(template, cast)) ranges.set(keyOf(range), range);
  return [...ranges.values()];
}

/**
 * What placement's fallbacks read for the cast (FRM1-OVL's request): each pick widened by retime's reach, and the
 * first alternates of each slot over the span the slot plays; once each, the picks' windows first.
 */
export function fallbackRanges(template: Template, cast: CastResult): SubjectClipRange[] {
  const windows = new Map<string, SubjectClipRange>();
  const alternates = new Map<string, SubjectClipRange>();
  for (const { slotCast, ref, media, range, rangeAt } of eachPick(template, cast)) {
    const window = widened(range, RETIME_REACH_SECONDS + SLACK_SECONDS, ref.available);
    windows.set(keyOf(window), window);
    for (const alternate of slotCast.alternates.slice(0, ALTERNATES_TRACKED)) {
      const other = media.get(candidateKey(alternate));
      if (other?.kind !== 'video') continue;
      const span = widened(
        rangeAt(other.assetId, alternate.sourceStart, other.available.start.rate),
        SLACK_SECONDS,
        other.available,
      );
      alternates.set(keyOf(span), span);
    }
  }
  return [...windows.values(), ...[...alternates.values()].filter((span) => !windows.has(keyOf(span)))];
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

/** What the assembly waits for: the picks' tracks (the first draft's), then the fallbacks' in what is left. */
export interface AssemblyTracks {
  readonly picks: EnsureReport;
  readonly fallbacks: EnsureReport;
  /** The cast the video is made from: `refine`'s when one ran, else the one given. */
  readonly cast: CastResult;
}

/** FIX-TRIM: a step between the picks' tracks and the fallbacks': the cast changed in what is left of the budget. */
export type CastRefiner = (cast: CastResult, budgetMs: number) => Promise<CastResult>;

/**
 * The picks' tracks within `budgetMs`, then `refine` (FIX-TRIM: the in-points with the person, person-in-points.ts),
 * then the fallbacks' (`fallbackRanges`, of the refined cast) in what is left of it. Fallback ranges not made in time
 * are still queued, behind the picks', for an edit's placement to read.
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
  const fallbacks = await ensureSubjects(
    source,
    fallbackRanges(template, refined),
    Math.max(0, budgetMs - (now() - started)),
    now,
  );
  return { picks, fallbacks, cast: refined };
}
