// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-C2: the reel's effects on a video made from its template. Each effect the breakdown heard on a cut
 * (`audio.listening.sfxAtCuts`, under the slot whose cut it is) goes on the same cut of a timeline with the
 * template's slots: slot i starts at the timeline's cut i − 1 (the first slot starts the video, at no cut). A
 * timeline with another number of cuts (shots added or taken out since) has no such cuts and gets none. Each effect
 * keeps its family, what it sounded like and its offset to the cut, and is given a bank sound of its family. Pure.
 *
 * EAR1-R2: the offset measured the answering event's time, which is a hit's attack and a swell's peak (core's
 * `soundEventSchema.at`). So each request says what of the sound goes there (`align`): a take's onset for an event
 * heard as an attack, its apex for a swell. Placing every effect by its apex put a whoosh or riser heard as an
 * attack early by its rise.
 */
import {
  RationalTime,
  type CutSyncItem,
  type SfxCategory,
  type Template,
  type TemplateListening,
  type Timeline,
} from '@taalcut/core';

/** What of a take lands at the cut plus the reel's offset: its onset (the reel's event was an attack) or its apex. */
export type ReelAlign = 'onset' | 'apex';

/** One of the reel's effects, on a cut of the timeline. */
export interface ReelHitRequest {
  /** The timeline's cut, first cut 0 (as `sfx.generateHit` numbers them). */
  readonly cutIndex: number;
  /** The cut's time on the timeline, ms. */
  readonly cutMs: number;
  /** The template's slot whose cut it is. */
  readonly slotIndex: number;
  readonly family: SfxCategory;
  /** The effect against the cut, as the reel had it (negative: early). */
  readonly offsetMs: number;
  /** EAR1-R2: what the offset was measured to (the event's attack, or a swell's peak). */
  readonly align: ReelAlign;
  readonly soundHint?: string;
}

/** An event answers a cut when it is the report's `eventAt` (both to the millisecond). */
const SAME_EVENT_S = 0.0015;

/**
 * What the reel's offset at this cut measured: the answering event's attack (`onset`) unless that event is a swell
 * (timed at its peak). Without the event (a template that doesn't say), the apex, as before.
 */
export function reelAlign(listening: TemplateListening, item: CutSyncItem | undefined): ReelAlign {
  if (item?.status === 'swell') return 'apex';
  const at = item?.eventAt ? RationalTime.toSeconds(item.eventAt) : null;
  if (at === null) return 'apex';
  let best: TemplateListening['events'][number] | undefined;
  for (const event of listening.events) {
    const gap = Math.abs(RationalTime.toSeconds(event.at) - at);
    if (gap <= SAME_EVENT_S && (!best || gap < Math.abs(RationalTime.toSeconds(best.at) - at))) best = event;
  }
  if (!best) return 'apex';
  return best.shape === 'swell' ? 'apex' : 'onset';
}

/** The start of each shot after the first on the timeline's video track, ms (audio's timelineCuts, without kinds). */
export function timelineCutMs(timeline: Timeline): number[] {
  const track = timeline.tracks.find((candidate) => candidate.kind === 'video');
  const frameMs = (1000 * timeline.canvas.rate.den) / timeline.canvas.rate.num;
  const cuts: number[] = [];
  let at = 0;
  for (const [index, item] of (track?.items ?? []).entries()) {
    if (item.type === 'transition') continue;
    if (at > 0 && index > 0) cuts.push(at * frameMs);
    at += item.duration.value;
  }
  return cuts;
}

/**
 * The slot whose cut each effect is on: the slot starting where the reel's cut was heard (within a frame), so an
 * effect stays on its cut when slots before it were split or merged since, and goes with its cut; by its
 * `cutIndex` only when the report doesn't say where the cut was.
 */
function slotOfEffect(template: Template, item: CutSyncItem | undefined, cutIndex: number): number | null {
  if (item) {
    const frame = RationalTime.toSeconds(item.at) * (template.canvas.rate.num / template.canvas.rate.den);
    const slot = template.slots.findIndex((candidate) => Math.abs(candidate.start.value - frame) <= 1);
    return slot > 0 ? slot : null;
  }
  return cutIndex > 0 && cutIndex < template.slots.length ? cutIndex : null;
}

/**
 * The reel's effects on the timeline's cuts, or null when they can't be placed: the template heard none (or was
 * made before EAR1), or the timeline's cuts aren't the template's (a different number of shots).
 */
export function reelHitRequests(template: Template, timeline: Timeline): ReelHitRequest[] | null {
  const listening = template.audio.listening;
  if (!listening) return null;
  const cuts = timelineCutMs(timeline);
  if (cuts.length !== template.slots.length - 1) return null;
  const requests: ReelHitRequest[] = [];
  const used = new Set<number>();
  for (const effect of listening.sfxAtCuts) {
    const item = listening.cutSync.items.find((candidate) => candidate.cutIndex === effect.cutIndex);
    const slot = slotOfEffect(template, item, effect.cutIndex);
    if (slot === null || used.has(slot)) continue;
    used.add(slot);
    requests.push({
      cutIndex: slot - 1,
      cutMs: cuts[slot - 1]!,
      slotIndex: slot,
      family: effect.family,
      offsetMs: effect.offsetMs,
      align: reelAlign(listening, item),
      ...(effect.soundHint ? { soundHint: effect.soundHint } : {}),
    });
  }
  return requests.sort((a, b) => a.cutIndex - b.cutIndex);
}

/** What choosing a bank sound needs of one (lane D's catalogue item). */
export interface ReelSoundChoice {
  readonly id: string;
  readonly family: SfxCategory;
  readonly title: string;
  readonly kinds: readonly string[];
}

const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2),
  );

/**
 * The bank sound for an effect: of its family, the one whose title, id and kinds share the most words with what the
 * reel's sounded like; the family's first on a tie or without words. One hint always gets the same sound, so the
 * reel's repeated whoosh stays one whoosh. Null when the bank has nothing of the family.
 */
export function reelSoundFor<T extends ReelSoundChoice>(
  sounds: readonly T[],
  family: SfxCategory,
  hint: string | undefined,
): T | null {
  const ofFamily = sounds.filter((sound) => sound.family === family);
  if (ofFamily.length === 0) return null;
  const wanted = words(hint ?? '');
  let best = ofFamily[0]!;
  let bestScore = 0;
  for (const sound of ofFamily) {
    const have = words(`${sound.title} ${sound.id} ${sound.kinds.join(' ')}`);
    const score = [...wanted].filter((word) => have.has(word)).length;
    if (score > bestScore) {
      best = sound;
      bestScore = score;
    }
  }
  return best;
}
