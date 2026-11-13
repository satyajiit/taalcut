// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.setGrade and timeline.addMarker (EDT1-OPS). A grade change merges into the target's grade (the fields
 * given replace its own, the rest stay) and a neutral result is stored as none; null takes it off. Clips are V1's
 * pictures (videos and photos); an agent is refused on a clip the person locked. A marker is a note, beat, hook or
 * QA mark at a time inside the video, its colour the kind's unless given. Neither moves a cut.
 */
import {
  err,
  isNeutralGrade,
  NEUTRAL_GRADE,
  ok,
  RationalTime,
  type Grade,
  type GradePatch,
  type GradeTarget,
  type Marker,
  type Result,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import { InvalidMove } from '../errors';
import { marker as markerOf } from '../model/markers';
import { sequenceLength, videoItems, withVideoItems } from '../model/sequence';
import { clipPosition, type EditOptions, type EditResult } from './types';

/** The grade after a change: merged, none when neutral. */
function merged(current: Grade | undefined, patch: GradePatch | null): Grade | undefined {
  if (patch === null) return undefined;
  const next = { ...(current ?? NEUTRAL_GRADE), ...patch };
  return isNeutralGrade(next) ? undefined : next;
}

const same = (a: Grade | undefined, b: Grade | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function setGrade(
  timeline: Timeline,
  input: { readonly target: GradeTarget; readonly grade: GradePatch | null },
  options: EditOptions,
): Result<EditResult> {
  if (input.target.kind === 'timeline') {
    const next = merged(timeline.grade, input.grade);
    if (same(timeline.grade, next)) return ok({ timeline, changed: [] });
    const { grade: _old, ...rest } = timeline;
    return ok({ timeline: next ? { ...rest, grade: next } : rest, changed: ['grade'] });
  }
  const items = [...videoItems(timeline)];
  let changed = false;
  for (const clipId of new Set(input.target.clipIds)) {
    const found = clipPosition(timeline, clipId, options.source);
    if (!found.ok) return found;
    const clip = found.value.item;
    if (clip.media.kind === 'audio') return err(InvalidMove(undefined, { detail: 'Only a picture has a colour' }));
    const next = merged(clip.grade, input.grade);
    if (same(clip.grade, next)) continue;
    const { grade: _old, ...rest } = clip;
    items[found.value.itemIndex] = next ? { ...rest, grade: next } : rest;
    changed = true;
  }
  return ok(changed ? { timeline: withVideoItems(timeline, items), changed: ['tracks'] } : { timeline, changed: [] });
}

export interface MarkerInput {
  readonly at: RationalTime;
  readonly duration?: RationalTime | undefined;
  readonly kind: Marker['kind'];
  readonly label: string;
  readonly colour?: Marker['colour'] | undefined;
}

export function addMarker(
  timeline: Timeline,
  input: MarkerInput,
  ids: () => TimelineItemId,
): Result<EditResult & { readonly itemId: TimelineItemId }> {
  const rate = timeline.canvas.rate;
  const start = RationalTime.rescale(input.at, rate, 'round').value;
  const length = input.duration ? RationalTime.rescale(input.duration, rate, 'round').value : 0;
  const end = sequenceLength(videoItems(timeline));
  if (start < 0 || start > end) return err(InvalidMove(undefined, { detail: 'The marker is outside the video' }));
  const made = markerOf(ids(), input.kind, input.label, start, Math.min(length, end - start), rate);
  const placed: Marker = input.colour ? { ...made, colour: input.colour } : made;
  return ok({ timeline: { ...timeline, markers: [...timeline.markers, placed] }, changed: ['markers'], itemId: placed.id });
}
