// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { REEL_WORDS, reelById } from '#content/reels';
import type { Reel, Slot } from '#content/schema';
import type { Segment } from '#components/ui/segment-bar';
import type { ConfidenceLevel } from '../auto-pick/confidence';
import { clipById } from '../auto-pick/roll';
import { frameOf, framesOf } from '../frames';

/**
 * The page's template: That Airport Feeling, the owner's 4K60 export, read by Taalcut into 9 slots on 24 music beats
 * (#content/reels, from the app's own breakdown). Its footage taken out, each slot keeps only the kind of shot it
 * wants (wide or close, walking or still, quick or held, opener or closer), never one trip's subject, so another
 * trip's clip can honestly fit it. Three camera rolls fill it: the trip it was made from (A flight out, its own 9
 * clips, so it plays as the reel), the Vietnam trip (9 of its 13 clips, each chosen for its slot's kind of shot) and
 * Vietnam, on repeat (9 of its 15 raw phone clips). Where the best clip fits less well (a held slot with a short clip,
 * a departure with a walk or a crossing, night lights with a sunset), the pick says Medium; the app shows how sure it
 * is, never a reason (DESIGN.md › The Confidence, Not a Reason Rule).
 */

export const TEMPLATE_REEL_ID = 'airport';

export function templateReel(): Reel {
  return reelById(TEMPLATE_REEL_ID);
}

/** What each slot wants, in slot order: the kind of shot, in a few words, true to the reel's own shot. */
export const SHOT_NEEDS: readonly string[] = [
  'Leading in, to open',
  'Lights or signs above',
  'In a crowd',
  'A wide space, quick',
  'Something big, held',
  'Close behind someone',
  'Setting off',
  'A city, wide and bright',
  'Night lights, to close',
];

export type RollId = 'vietnam' | 'flight' | 'repeat' | 'next';

export interface RollPick {
  /** The camera roll's clip (#content/reels), its frames in the atlas and its loop. */
  readonly clipId: string;
  readonly sure: ConfidenceLevel;
}

export interface Roll {
  readonly id: RollId;
  /** The camera roll's own name for it (REEL_WORDS › roll), or the empty one's. */
  readonly label: string;
  /** The clip its highlight shows. None: the empty roll, waiting. */
  readonly cover?: string;
  /** One pick per slot, in slot order; none for the empty roll. */
  readonly picks: readonly RollPick[];
  /** The roll the reel was made from: filled with it, the template plays as the reel, so the reel's own video shows. */
  readonly own?: boolean;
}

const high = (clipId: string): RollPick => ({ clipId, sure: 'high' });
const medium = (clipId: string): RollPick => ({ clipId, sure: 'medium' });

export const ROLLS: readonly Roll[] = [
  {
    id: 'vietnam',
    label: REEL_WORDS.vietnam?.roll ?? 'Vietnam trip',
    cover: 'vietnam-12',
    picks: [
      high('vietnam-01'), // leading in down the airport walkway
      high('vietnam-07'), // coloured lights strung over a night street
      high('vietnam-02'), // into the crowd on a busy night street
      high('vietnam-12'), // a wide hall of arches, 0.6 s
      { clipId: 'vietnam-09', sure: 'medium' }, // a temple front, but 0.3 s for a held slot
      high('vietnam-08'), // close behind, rain and neon
      { clipId: 'vietnam-06', sure: 'medium' }, // walking off into the green: a walk, not a departure
      high('vietnam-11'), // towers on a bright street
      high('vietnam-13'), // lanterns lit at dusk, the closer
    ],
  },
  {
    id: 'flight',
    label: REEL_WORDS.airport?.roll ?? 'A flight out',
    cover: 'airport-05',
    own: true,
    picks: Array.from({ length: 9 }, (_, i) => high(`airport-${String(i + 1).padStart(2, '0')}`)),
  },
  {
    id: 'repeat',
    label: REEL_WORDS.repeat?.roll ?? 'Vietnam, on repeat',
    cover: 'repeat-05',
    picks: [
      high('repeat-01'), // a garden path leading in under the cliffs
      high('repeat-06'), // paper lanterns overhead
      high('repeat-13'), // in the crowd along the train street
      high('repeat-02'), // open water to the horizon, 1.5 s
      high('repeat-09'), // the stone gate in its lily pond, held
      high('repeat-10'), // close behind him, walking down the pier
      medium('repeat-05'), // a boat out on the bay: crossing, not setting off
      high('repeat-12'), // a wide avenue on a bright day, under the road signs
      medium('repeat-15'), // the pool at sunset: evening light, not night lights
    ],
  },
  { id: 'next', label: 'Your next trip', picks: [] },
];

export const DEFAULT_ROLL: RollId = 'vietnam';

export function rollById(id: RollId): Roll {
  return ROLLS.find((r) => r.id === id) ?? (ROLLS[0] as Roll);
}

/** A slot of the template: its time, its part, its need, and its length. */
export interface TemplateSlot extends Pick<Slot, 'id' | 'role' | 'start' | 'end'> {
  readonly n: number;
  readonly need: string;
  readonly length: number;
}

export function templateSlots(reel: Reel = templateReel()): TemplateSlot[] {
  return reel.slots.map((s, i) => ({
    id: s.id,
    role: s.role,
    start: s.start,
    end: s.end,
    n: i + 1,
    need: SHOT_NEEDS[i] ?? s.needs,
    length: s.end - s.start,
  }));
}

/** The slots as the segment bar draws them. */
export function templateSegments(slots: readonly TemplateSlot[]): Segment[] {
  return slots.map((s) => ({ start: s.start, end: s.end, group: s.role }));
}

/** The slot playing at `t` seconds; the last one at or after the end. */
export function slotIndexAt(slots: readonly Pick<TemplateSlot, 'start' | 'end'>[], t: number): number {
  const at = slots.findIndex((s) => t >= s.start && t < s.end);
  return at === -1 ? Math.max(0, slots.length - 1) : at;
}

/**
 * How fast a clip plays in its slot: as it was shot when it is as long as the slot, slowed to fill a longer slot,
 * but never under half speed (it then holds its last frame).
 */
export function clipRate(clipSeconds: number, slotSeconds: number): number {
  if (slotSeconds <= 0 || clipSeconds >= slotSeconds) return 1;
  return Math.max(0.5, clipSeconds / slotSeconds);
}

/**
 * A clip's still at rest: its last frame in the atlas, from the part of the shot its loop plays (a reel's opening shot
 * carries the reel's own words on screen in its first frames; its loop, and so this frame, is past them).
 */
export function stillOf(clipId: string | undefined): number | undefined {
  const frames = framesOf(clipId);
  return frames.at(-1) ?? frameOf(clipId);
}

/** A pick's words: what its clip shows, in full and in two words. */
export function pickWords(pick: RollPick): {
  readonly name: string;
  readonly short: string;
  readonly seconds: number;
} {
  const clip = clipById(pick.clipId);
  return { name: clip.name, short: clip.short, seconds: clip.seconds };
}

/** The roll's fill in one line, for the status under the highlights. */
export function fillWords(roll: Roll, slots: number): string {
  if (roll.picks.length === 0) return `${roll.label}: the template waits for its clips.`;
  if (roll.own) return `${roll.label}: its own ${slots} clips, so it plays as the reel.`;
  const unsure = roll.picks.filter((p) => p.sure !== 'high').length;
  const lead = `${roll.label}: ${slots} slots filled`;
  return unsure === 0 ? `${lead}.` : `${lead}, ${unsure} picks less sure.`;
}
