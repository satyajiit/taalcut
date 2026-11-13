// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-TRIM: each cast clip's in-point chosen again with the person in its shot (SPEC, "FIX-TRIM: the person"), as
 * `timeline.assemble` makes a video. Casting can't: it weighs 50 candidates a slot, and the person's data is a
 * subject track, which takes time to make. So once the cast is known, each video pick's shot is tracked from
 * `searchSeconds` before the pick to as far after it (inside the shot), within a budget, and the pick's window is
 * chosen again by casting's in-point rule plus the person's terms (subject-terms.ts): under way for a moment that
 * is motion, no face for one that shows none. A pick the person locked, a photo, a shot not tracked in time and a
 * shot nobody is in keep their in-point. The search spans hold the picks' own windows and most of placement's
 * fallback windows, so the tracks assembly waits for anyway cover most of what this reads.
 */
import {
  RationalTime,
  type AsyncResult,
  type CastCandidate,
  type FrameRate,
  type ShotProfile,
  type ShotProfileRef,
  type SlotCast,
  type SubjectClipRange,
  type SubjectSource,
  type SubjectSpan,
  type Template,
} from '@taalcut/core';
import type { CastingConfig } from '../casting/config';
import type { CastResult } from '../casting/engine';
import { selectInPoint, windowFrames, type InPoint } from '../casting/in-points';
import { slotSpecs, type SlotSpec } from '../casting/slots';
import {
  personTerms,
  shotPerson,
  slotWants,
  type ShotPerson,
  type SlotWants,
} from '../casting/subject-terms';
import { candidateKey } from '../model/cast';
import { ensureSubjects, type EnsureReport } from './subjects';

export interface PersonInPointDeps {
  readonly subjects: SubjectSource;
  /** The shots' profiles (casting's catalogue). */
  profiles(refs: readonly ShotProfileRef[], signal?: AbortSignal): AsyncResult<ShotProfile[]>;
}

export interface PersonInPointReport {
  /** Video picks looked at, and how many of them were chosen again at another in-point. */
  readonly clips: number;
  readonly moved: number;
  readonly tracks: EnsureReport;
  readonly ms: number;
}

/** The asset time the person is read over for a pick: its window and `searchSeconds` either side, in its shot. */
export function searchRange(
  profile: ShotProfile,
  sourceStart: RationalTime,
  slot: SlotSpec,
  config: CastingConfig,
): SubjectClipRange {
  const rate = profile.range.start.rate;
  const length = profile.range.duration.value;
  const at = RationalTime.subtract(
    RationalTime.rescale(sourceStart, rate, 'round'),
    profile.range.start,
  ).value;
  const reach = RationalTime.fromSeconds(config.inPoint.subjects.searchSeconds, rate, 'ceil').value;
  const from = Math.max(0, Math.min(at, length) - reach);
  const to = Math.min(length, Math.max(0, at) + windowFrames(slot, rate) + reach);
  const frame = (offset: number) => RationalTime.add(profile.range.start, RationalTime.of(offset, rate));
  return { assetId: profile.assetId, start: frame(from), end: frame(to) };
}

/**
 * The window casting's rule gives a shot for a slot with the person in it (`person`, from `shotPerson`): their terms
 * on top of the rule's, inside the tracked span and `allowed`. With `current` (the in-point now, in media frames from
 * the shot's start), null unless the new window improves the person's terms by at least `minGain`: a shot that shows
 * a face everywhere, or a walk the clip is already on, keeps its in-point.
 */
export function chooseWithPerson(input: {
  readonly profile: ShotProfile;
  readonly slot: SlotSpec;
  readonly person: ShotPerson;
  readonly wants: SlotWants;
  readonly canvasRate: FrameRate;
  readonly config: CastingConfig;
  readonly current?: number;
  readonly allowed?: (start: number) => boolean;
}): InPoint | null {
  const { profile, slot, person, config } = input;
  const settings = config.inPoint.subjects;
  const terms = personTerms(person, input.wants, windowFrames(slot, profile.range.start.rate), settings);
  const allowed = (start: number) => terms.allowed!(start) && (input.allowed ? input.allowed(start) : true);
  const point = selectInPoint(profile, slot, input.canvasRate, config, slot.index === 0, {
    ...terms,
    allowed,
  });
  if (!point || input.current === undefined) return point;
  const at = RationalTime.subtract(point.sourceStart, profile.range.start).value;
  return terms.penalty!(input.current) - terms.penalty!(at) >= settings.minGain ? point : null;
}

/**
 * The in-point for a shot in a slot with the person in it, from a subject span over `range`; null when nobody is in
 * the span, no window fits in it, or (with `current`) none improves on it by `minGain`. Pure: a read-only check
 * against real tracks calls this with a profile, a slot spec, `SubjectSource.over(range)`'s span and the range.
 */
export function inPointWithPerson(input: {
  readonly profile: ShotProfile;
  readonly slot: SlotSpec;
  readonly template: Template;
  readonly span: SubjectSpan;
  readonly range: SubjectClipRange;
  readonly config: CastingConfig;
  /** Overrides what the slot's moment asks for (a read-only check's own). */
  readonly wants?: Partial<SlotWants>;
  /** The in-point now, in media frames from the shot's start. */
  readonly current?: number;
}): InPoint | null {
  const { profile, slot, config } = input;
  const settings = config.inPoint.subjects;
  const person = shotPerson(profile, input.span, input.range, settings);
  if (!person) return null;
  const wants = { ...slotWants(slot, input.template, settings), ...input.wants };
  return chooseWithPerson({
    profile,
    slot,
    person,
    wants,
    canvasRate: input.template.canvas.rate,
    config,
    ...(input.current !== undefined ? { current: input.current } : {}),
  });
}

interface Pick {
  readonly variant: number;
  readonly slot: number;
  readonly cast: SlotCast & { readonly pick: CastCandidate };
  readonly spec: SlotSpec;
  readonly profile: ShotProfile;
  readonly range: SubjectClipRange;
}

/** The cast with its video picks' in-points chosen again with the person in each shot, and what that did. */
export async function personInPoints(
  deps: PersonInPointDeps,
  template: Template,
  cast: CastResult,
  config: CastingConfig,
  budgetMs: number,
  now: () => number = Date.now,
  signal?: AbortSignal,
): Promise<{ cast: CastResult; report: PersonInPointReport }> {
  const started = now();
  const specs = slotSpecs(template, config, cast.canvas);
  const bySlot = new Map(specs.map((spec) => [spec.slotId as string, spec]));
  const wanted = cast.variants.flatMap((variant) =>
    variant.slots.flatMap((slot) =>
      slot.pick && slot.pick.shotId && slot.note !== 'userPick' ? [slot.pick] : [],
    ),
  );
  const none = (tracks: EnsureReport) => ({
    cast,
    report: { clips: 0, moved: 0, tracks, ms: now() - started },
  });
  if (wanted.length === 0) return none({ ranges: 0, ms: 0, done: true });
  const read = await deps.profiles(
    [...new Map(wanted.map((pick) => [candidateKey(pick), pick])).values()].map((pick) => ({
      assetId: pick.assetId,
      shotId: pick.shotId,
    })),
    signal,
  );
  if (!read.ok) return none({ ranges: 0, ms: 0, done: false, reason: read.error.code });
  const profiles = new Map(read.value.map((profile) => [candidateKey(profile), profile]));
  const picks: Pick[] = [];
  cast.variants.forEach((variant, v) =>
    variant.slots.forEach((slot, s) => {
      const spec = bySlot.get(slot.slotId);
      const profile = slot.pick ? profiles.get(candidateKey(slot.pick)) : undefined;
      if (!slot.pick || !spec || !profile || profile.kind !== 'video' || slot.note === 'userPick') return;
      const range = searchRange(profile, slot.pick.sourceStart, spec, config);
      picks.push({ variant: v, slot: s, cast: slot as Pick['cast'], spec, profile, range });
    }),
  );
  const tracks = await ensureSubjects(
    deps.subjects,
    picks.map((pick) => pick.range),
    budgetMs,
    now,
  );
  const moved = new Map<string, CastCandidate>();
  for (const pick of picks) {
    const span = await deps.subjects.over(pick.range, signal);
    if (!span.ok || !span.value) continue;
    const was = pick.cast.pick.sourceStart;
    const current = RationalTime.subtract(
      RationalTime.rescale(was, pick.profile.range.start.rate, 'round'),
      pick.profile.range.start,
    ).value;
    const point = inPointWithPerson({
      ...pick,
      slot: pick.spec,
      template,
      span: span.value,
      config,
      current,
    });
    if (!point || RationalTime.compare(RationalTime.rescale(point.sourceStart, was.rate, 'round'), was) === 0)
      continue;
    moved.set(`${pick.variant}:${pick.slot}`, {
      ...pick.cast.pick,
      sourceStart: point.sourceStart,
      syncPoint: point.syncPoint,
    });
  }
  const variants = cast.variants.map((variant, v) => ({
    ...variant,
    slots: variant.slots.map((slot, s) => {
      const pick = moved.get(`${v}:${s}`);
      return pick ? { ...slot, pick } : slot;
    }),
  }));
  return {
    cast: moved.size > 0 ? { ...cast, variants } : cast,
    report: { clips: picks.length, moved: moved.size, tracks, ms: now() - started },
  };
}
