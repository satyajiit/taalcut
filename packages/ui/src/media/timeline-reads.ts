// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the media cards read off a live timeline: a slot's number and its item on V1 (a clip or still a gap), where
 * each voice clip starts on the voice track, and a motion graphic on a text track. Pure functions over core's
 * Timeline; frames are canvas frames.
 */
import type { Clip, GraphicItem, Timeline } from '@taalcut/core';

type Gap = Extract<Timeline['tracks'][number]['items'][number], { type: 'gap' }>;

export type SlotItem =
  | { readonly kind: 'clip'; readonly clip: Clip; readonly number: number; readonly start: number }
  | { readonly kind: 'gap'; readonly gap: Gap; readonly number: number; readonly start: number };

/** The item on V1 that holds a slot, with its number (1-based, as the cut counts them) and start; null if none. */
export function slotItem(timeline: Timeline, slotId: string): SlotItem | null {
  const track = timeline.tracks.find((candidate) => candidate.id === 'V1') ?? timeline.tracks[0];
  if (!track || track.kind === 'text') return null;
  let start = 0;
  let number = 0;
  for (const item of track.items) {
    if (item.type === 'transition') continue;
    number += 1;
    if (item.slotId === slotId)
      return item.type === 'clip'
        ? { kind: 'clip', clip: item, number, start }
        : { kind: 'gap', gap: item, number, start };
    start += item.duration.value;
  }
  return null;
}

/** Where each clip on the voice track (an audio track of role 'voice') sits, in canvas frames. */
export function voiceClipSpans(
  timeline: Timeline,
): ReadonlyMap<string, { readonly start: number; readonly frames: number }> {
  const spans = new Map<string, { start: number; frames: number }>();
  const track = timeline.tracks.find((candidate) => candidate.kind === 'audio' && candidate.role === 'voice');
  if (!track || track.kind !== 'audio') return spans;
  let start = 0;
  for (const item of track.items) {
    if (item.type === 'transition') continue;
    if (item.type === 'clip') spans.set(item.id, { start, frames: item.duration.value });
    start += item.duration.value;
  }
  return spans;
}

/** The clip on V1 playing at a canvas frame; null over a gap or past the end. */
export function clipAt(timeline: Timeline, frame: number): Clip | null {
  const track = timeline.tracks.find((candidate) => candidate.id === 'V1') ?? timeline.tracks[0];
  if (!track || track.kind === 'text') return null;
  let start = 0;
  for (const item of track.items) {
    if (item.type === 'transition') continue;
    if (frame >= start && frame < start + item.duration.value) return item.type === 'clip' ? item : null;
    start += item.duration.value;
  }
  return null;
}

/** A motion graphic on any text track; null when it isn't there. */
export function graphicOn(timeline: Timeline, itemId: string): GraphicItem | null {
  for (const track of timeline.tracks) {
    if (track.kind !== 'text') continue;
    for (const item of track.items) if (item.type === 'graphic' && item.id === itemId) return item;
  }
  return null;
}
