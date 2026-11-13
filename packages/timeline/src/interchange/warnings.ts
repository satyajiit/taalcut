// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What another editor won't get exactly as Taalcut plays it (core's InterchangeWarning), the same for every
 * writer in v1: offline originals, speed (approximated or left in metadata), transitions written as cuts, text
 * as markers and stills. The export dialog shows them in words.
 */
import type { InterchangeWarning, Timeline } from '@taalcut/core';
import type { InterchangeContext } from './exporter';

export interface WarningOptions {
  /** Transitions are written as plain cuts plus a marker (v1 default for both writers). */
  readonly transitionsAsCuts: boolean;
}

type MediaItem = Exclude<Timeline['tracks'][number], { kind: 'text' }>['items'][number];
type ClipItem = Extract<MediaItem, { type: 'clip' }>;

/** A clip's own warnings: its original offline, its speed, a still. */
function clipWarnings(clip: ClipItem, context: InterchangeContext): InterchangeWarning[] {
  const out: InterchangeWarning[] = [];
  if (!context.media.get(clip.media.assetId)?.path) out.push({ code: 'mediaOffline', clipId: clip.id });
  if (clip.speed) out.push({ code: 'rampApproximated', clipId: clip.id });
  if (clip.media.kind === 'image') out.push({ code: 'imageAsStill', clipId: clip.id });
  return out;
}

function itemWarnings(
  item: MediaItem,
  context: InterchangeContext,
  options: WarningOptions,
): InterchangeWarning[] {
  if (item.type === 'transition')
    return options.transitionsAsCuts ? [{ code: 'transitionAsCut', itemId: item.id }] : [];
  return item.type === 'clip' ? clipWarnings(item, context) : [];
}

/** How many text items the text tracks hold (written as markers). */
function textCount(timeline: Timeline): number {
  return timeline.tracks.reduce(
    (sum, track) =>
      sum + (track.kind === 'text' ? track.items.filter((item) => item.type === 'text').length : 0),
    0,
  );
}

export function interchangeWarnings(
  timeline: Timeline,
  context: InterchangeContext,
  options: WarningOptions,
): InterchangeWarning[] {
  const out = timeline.tracks.flatMap((track) =>
    track.kind === 'text' ? [] : track.items.flatMap((item) => itemWarnings(item, context, options)),
  );
  const texts = textCount(timeline);
  if (texts > 0) out.push({ code: 'textAsMarker', count: texts });
  return out;
}
