// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Reading a Timeline v1 document for display: where each V1 item sits in
 * canvas frames, who chose each clip (the cast), and the beat grid rescaled to
 * canvas frames. Pure functions; the editor and the cards share them.
 */
import type { Clip, SlotCast, Timeline } from '@taalcut/core';

export type PlacedItem =
  | {
      readonly kind: 'clip';
      readonly clip: Clip;
      readonly index: number;
      readonly start: number;
      readonly frames: number;
    }
  | { readonly kind: 'gap'; readonly id: string; readonly start: number; readonly frames: number };

/** V1's clips and gaps end to end in canvas frames (transitions overlap their neighbours, so they take no room). */
export function placeVideo(timeline: Timeline): { items: PlacedItem[]; total: number } {
  const track = timeline.tracks.find((candidate) => candidate.id === 'V1') ?? timeline.tracks[0];
  const items: PlacedItem[] = [];
  let start = 0;
  let index = 0;
  if (!track || track.kind === 'text') return { items, total: 0 };
  for (const item of track.items) {
    if (item.type === 'transition') continue;
    const frames = item.duration.value;
    if (item.type === 'clip') {
      index += 1;
      items.push({ kind: 'clip', clip: item, index, start, frames });
    } else {
      items.push({ kind: 'gap', id: item.id, start, frames });
    }
    start += frames;
  }
  return { items, total: start };
}

/** The cast slot that names a clip, if any. */
export function castFor(timeline: Timeline, clipId: string): SlotCast | null {
  return timeline.cast?.slots.find((slot) => slot.clipId === clipId) ?? null;
}

/** Who chose a clip: you (your swap or pick), the AI (a cast pick), or nobody named (null). */
export function chosenBy(timeline: Timeline, clipId: string): 'ai' | 'you' | null {
  const slot = castFor(timeline, clipId);
  if (!slot) return null;
  return slot.note === 'userPick' ? 'you' : 'ai';
}

export interface BeatTick {
  readonly frame: number;
  readonly downbeat: boolean;
}

/** The beat map's beats in canvas frames, inside the video's length; downbeats marked. */
export function beatTicks(timeline: Timeline, total: number): BeatTick[] {
  const map = timeline.beatMap;
  if (!map) return [];
  const canvas = timeline.canvas.rate;
  const downbeats = new Set(map.downbeats);
  const ticks: BeatTick[] = [];
  map.beats.forEach((beat, index) => {
    const frame = Math.round((beat.value * canvas.num * beat.rate.den) / (beat.rate.num * canvas.den));
    if (frame >= 0 && frame < total) ticks.push({ frame, downbeat: downbeats.has(index) });
  });
  return ticks;
}

/** One beat in canvas frames (from the bpm, else the gap between the first two beats), at least one frame. */
export function beatFrames(timeline: Timeline): number {
  const canvas = timeline.canvas.rate;
  const map = timeline.beatMap;
  if (map?.bpm) return Math.max(1, Math.round((60 * canvas.num) / (map.bpm * canvas.den)));
  const ticks = beatTicks(timeline, Number.POSITIVE_INFINITY);
  if (ticks.length > 1) return Math.max(1, ticks[1]!.frame - ticks[0]!.frame);
  // No beat map: half a second.
  return Math.max(1, Math.round(canvas.num / (2 * canvas.den)));
}

/** The video's clips (V1) in order. */
export function videoClips(timeline: Timeline): Clip[] {
  return placeVideo(timeline).items.flatMap((item) => (item.kind === 'clip' ? [item.clip] : []));
}

/** The asset and shot a clip plays, as the shot lookup takes them. */
export function clipShot(clip: Clip): { assetId: Clip['media']['assetId']; shotId: string | null } {
  return { assetId: clip.media.assetId, shotId: clip.media.kind === 'video' ? clip.media.shotId : null };
}
