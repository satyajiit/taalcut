// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The placement solver on a made timeline, with its people (FRM1-OVL): the tracks of every clip range are made or
 * joined (`SubjectSource.ensure`), read (`over`), and the overlays placed (place-timeline.ts). An item with no room
 * then tries, in order, its clip at another in-point within retime's reach (fallbacks.ts) and the slot's
 * next clip with room (casting/recast-for-room.ts); one that still has none stays `noRoom`, which render QA's
 * `graphicCoversFace` fails with a plain reason. Without a subject source, or when tracking fails, the overlays
 * keep the reel's relation with nobody known on screen, and the warning says why.
 */
import {
  RationalTime,
  type CastCandidate,
  type MediaRef,
  type SubjectClipRange,
  type SubjectSource,
  type SubjectSpan,
  type Template,
  type Timeline,
} from '@taalcut/core';
import { CASTING_CONFIG } from '../../casting/config';
import { RETIME_REACH_SECONDS, widened } from '../subjects';
import { alternateKey, recastCandidates, recastForRoom } from '../../casting/recast-for-room';
import { clipUnder, needsFallback, retimeForRoom, sideLost } from './fallbacks';
import { placeOverlays, type PlaceResult } from './place-timeline';
import { clipSourceRange, placedClips } from './subjects';

export interface PlacementDeps {
  readonly subjects?: SubjectSource;
  /** Media for a slot's alternates (assembly: the variant's; an edit: the catalog's); absent, nothing is recast. */
  readonly media?: (candidates: readonly CastCandidate[]) => Promise<ReadonlyMap<string, MediaRef>>;
  /** casting's `confidence.tau`, for a recast's confidence. */
  readonly tau?: number;
  readonly signal?: AbortSignal;
  /**
   * How long placement waits for missing tracks (SubjectSource.ensure), ms; a track still being made then finishes
   * in the jobs queue and the clip is placed with what is stored. Default PLACEMENT_ENSURE_MS.
   */
  readonly ensureBudgetMs?: number;
}

const SIDE_WORDS = { left: 'left of', right: 'right of', above: 'above', below: 'below' } as const;

/** Assembly's wait for tracks (as FRM1-SUB's assembly budget); an edit waits less (EDIT_ENSURE_MS). */
export const PLACEMENT_ENSURE_MS = 90_000;
export const EDIT_ENSURE_MS = 8_000;

/** The promise, or 'late' after `ms`. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | 'late'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), ms);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface PlacementRun extends PlaceResult {
  readonly warnings: readonly string[];
}

export async function spansFor(
  source: SubjectSource,
  ranges: readonly { readonly key: string; readonly range: SubjectClipRange }[],
  warnings: string[],
  deps: PlacementDeps,
): Promise<Map<string, SubjectSpan | undefined>> {
  const out = new Map<string, SubjectSpan | undefined>();
  if (ranges.length === 0) return out;
  // No signal: a track the wait gives up on still finishes in the queue, for the export to read.
  const made = await within(
    source.ensure(ranges.map((entry) => entry.range)),
    deps.ensureBudgetMs ?? PLACEMENT_ENSURE_MS,
  );
  if (made === 'late') warnings.push('placement: some subject tracks are still being made');
  else if (!made.ok) warnings.push(`placement: some subject tracks weren't made (${made.error.code})`);
  for (const { key, range } of ranges) {
    const read = await source.over(range, deps.signal);
    if (!read.ok) warnings.push(`placement: subjects of ${range.assetId} unread (${read.error.code})`);
    out.set(key, read.ok ? read.value : undefined);
  }
  return out;
}

/** Places the overlays of `timeline` (only `only`, when given) with the people in its clips. */
export async function runPlacement(
  timeline: Timeline,
  template: Template,
  deps: PlacementDeps,
  only?: ReadonlySet<string>,
): Promise<PlacementRun> {
  const warnings: string[] = [];
  const base = { template, ...(only ? { only } : {}) };
  const source = deps.subjects;
  if (!source) return { ...placeOverlays({ ...base, timeline, subjects: new Map() }), warnings };
  const rate = timeline.canvas.rate;
  const clips = placedClips(timeline).filter((placed) => placed.clip.media.kind === 'video');
  const subjects = await spansFor(
    source,
    clips.map((placed) => ({
      key: placed.clip.id,
      range: { assetId: placed.clip.media.assetId, ...clipSourceRange(placed.clip, rate) },
    })),
    warnings,
    deps,
  );
  let result = placeOverlays({ ...base, timeline, subjects });
  const stuck = () => result.report.filter(needsFallback);
  const done = () => {
    for (const entry of result.report.filter(sideLost))
      warnings.push(
        `placement: ${entry.id} sits ${SIDE_WORDS[entry.side!]} the head, not ${SIDE_WORDS[entry.relation.side!]} it as in the reel`,
      );
    return { ...result, warnings };
  };
  if (stuck().length === 0) return done();

  // Retime: each stuck item's clip over as far as retime moves it (FRM1-SUB tracks that window at assembly).
  const under = [...new Set(stuck().flatMap((entry) => clipUnder(result.timeline, entry.span) ?? []))];
  const wider = await spansFor(
    source,
    under.flatMap((placed) =>
      placed.clip.media.kind === 'video'
        ? [
            {
              key: placed.clip.id,
              range: widened(
                { assetId: placed.clip.media.assetId, ...clipSourceRange(placed.clip, rate) },
                RETIME_REACH_SECONDS,
                placed.clip.media.available,
              ),
            },
          ]
        : [],
    ),
    warnings,
    deps,
  );
  const before = new Map(clips.map((placed) => [placed.clip.id, placed.clip.sourceStart]));
  result = retimeForRoom({ ...base, timeline: result.timeline, subjects, result, wider });
  // A retimed clip's people are the wider span's from now on.
  for (const placed of placedClips(result.timeline)) {
    const was = before.get(placed.clip.id);
    if (was && !RationalTime.equals(was, placed.clip.sourceStart))
      subjects.set(placed.clip.id, wider.get(placed.clip.id));
  }
  if (stuck().length === 0 || !deps.media) return done();

  // Recast: the stuck slots' alternates, in casting's order, with their people.
  const slots = recastCandidates({ result });
  const candidates = slots.flatMap((slot) => slot.alternates);
  const media = await deps.media(candidates);
  const placedByClip = new Map(
    placedClips(result.timeline).map((placed) => [placed.clip.slotId as string, placed]),
  );
  const alternates = await spansFor(
    source,
    slots.flatMap((slot) => {
      const placed = placedByClip.get(slot.slotId);
      if (!placed) return [];
      return slot.alternates.flatMap((alternate) => {
        const ref = media.get(alternate.shotId ?? `asset:${alternate.assetId}`);
        if (ref?.kind !== 'video') return [];
        const range = clipSourceRange(
          { ...placed.clip, media: ref, sourceStart: alternate.sourceStart },
          rate,
        );
        return [{ key: alternateKey(alternate), range: { assetId: alternate.assetId, ...range } }];
      });
    }),
    warnings,
    deps,
  );
  result = recastForRoom({
    ...base,
    timeline: result.timeline,
    subjects,
    result,
    alternates,
    media,
    tau: deps.tau ?? CASTING_CONFIG.confidence.tau,
  });
  return done();
}
