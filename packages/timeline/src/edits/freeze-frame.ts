// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, ok, RationalTime, ValidationError, type Timeline, type TimelineItemId } from '@taalcut/core';
import { ClipLocked } from '../errors';
import { videoItems, withVideoItems } from '../model/sequence';
import { fitTransitions } from '../resync/neighbours';
import { sourceFrames } from '../model/speed';
import { insertExtras } from './insert-extras';
import { rippleExtras } from './ripple';
import { splitHalves } from './split';
import { timeMap } from './time-map';
import { clipPosition, type EditOptions, type EditResult } from './types';

type Options = EditOptions & { ids(): TimelineItemId };
const invalid = (detail: string) => err(ValidationError({ field: 'at' }, { detail }));

/** Freeze the selected source frame, retaining editable grades and separate overlays. No pixels are baked. */
export function freezeFrame(
  timeline: Timeline,
  input: { clipId: TimelineItemId; at: RationalTime; duration: RationalTime },
  options: Options,
) {
  const found = clipPosition(timeline, input.clipId, options.source);
  if (!found.ok) return found;
  const { item: clip, start, end, itemIndex } = found.value;
  if (clip.locked) return err(ClipLocked({ clipId: clip.id }));
  if (clip.media.kind !== 'video') return invalid('Choose a frame of a video clip');
  const rate = timeline.canvas.rate;
  const at = RationalTime.rescale(input.at, rate, 'round').value;
  const duration = RationalTime.rescale(input.duration, rate, 'round');
  if (at < start || at >= end || duration.value < 1)
    return invalid('The moment and hold duration must be inside the video');
  const sourceRate = clip.media.available.start.rate;
  const sourceFrame =
    clip.holdFrame ??
    RationalTime.of(
      Math.floor(
        ((RationalTime.toSeconds(clip.sourceStart) +
          (sourceFrames(clip.speed, at - start) * rate.den) / rate.num) *
          sourceRate.num) /
          sourceRate.den +
          1e-9,
      ),
      sourceRate,
    );
  const hold = {
    ...clip,
    id: options.ids(),
    sourceStart: sourceFrame,
    holdFrame: sourceFrame,
    duration,
    slotId: null,
    syncPoint: null,
    beatAnchor: null,
    speed: null,
    audio: { gainDb: 0, muted: true },
  };
  const items = [...videoItems(timeline)];
  if (at === start) items.splice(itemIndex, 0, hold);
  else {
    // A one-frame edge is valid here: snapping would freeze a different moment than the selected one.
    const [before, after] = splitHalves(timeline, clip, start, at - start, options.ids());
    items.splice(itemIndex, 1, before, hold, after);
  }
  // Same insertion map as other inserts; the hold's exact duration and selected frame are never beat-snapped.
  const next = insertExtras(
    withVideoItems(timeline, fitTransitions(items, rate)),
    at,
    duration.value,
    options.ids,
  );
  return ok({ timeline: next, changed: ['tracks', 'markers', 'captions'] as const, itemId: hold.id });
}

export function setHoldDuration(
  timeline: Timeline,
  input: { clipId: TimelineItemId; duration: RationalTime },
  options: Options,
) {
  const found = clipPosition(timeline, input.clipId, options.source);
  if (!found.ok) return found;
  const { item: clip, start, end, itemIndex } = found.value;
  if (clip.locked) return err(ClipLocked({ clipId: clip.id }));
  if (!clip.holdFrame) return invalid('This clip is not a held frame');
  const duration = RationalTime.rescale(input.duration, timeline.canvas.rate, 'round');
  if (duration.value < 1) return invalid('A hold must last at least one frame');
  const delta = duration.value - clip.duration.value;
  const items = [...videoItems(timeline)];
  items[itemIndex] = { ...clip, duration };
  const next = withVideoItems(timeline, fitTransitions(items, timeline.canvas.rate));
  return ok<EditResult>({
    timeline:
      delta >= 0
        ? insertExtras(next, end, delta, options.ids)
        : rippleExtras(next, timeMap([{ start: start + duration.value, end }]), options.ids),
    changed: delta ? ['tracks', 'markers', 'captions'] : [],
  });
}
