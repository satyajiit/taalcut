// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2 eyes: what each clip's slot is for, beside the clip. From the template version the timeline was made from:
 * the slot's number, role, intent, `needs` and `face` (what the Analyst stated, FIX-HOOK), the shot type, camera
 * move and people it asks for, and where it sits in the reel. From the timeline's cast: the score the pick filling
 * it got and its parts, when the clip there is still the cast's pick. `timeline.get` puts them on each row and
 * `video.compare` says them beside each slot's frames, so a model that edits knows what every slot should be.
 */
import { z } from 'zod';
import {
  CAMERA_MOTIONS,
  INTENT_FACES,
  RationalTime,
  SHOT_TYPES,
  SLOT_ROLES,
  type Template,
  type Timeline,
} from '@taalcut/core';
import { positions, videoItems } from '../model/sequence';

/** An intent's line is cut here: it is a direction, and each row carries one. */
export const SLOT_INTENT_CHARS = 200;

const seconds = z.number().nonnegative();
const part = z.number();

export const slotFactsSchema = z.object({
  /** The slot's number in the template, 1 first (the review's "Slot 3"). */
  slot: z.int().min(1),
  role: z.enum(SLOT_ROLES),
  /** What the slot shows and does, in the Analyst's words. */
  intent: z.string(),
  /** What the footage must show for the slot to work; empty when it says nothing. */
  needs: z.array(z.string()),
  /** Whether the reel shows the person's face here; null when it doesn't say. */
  face: z.enum(INTENT_FACES).nullable(),
  shotType: z.enum(SHOT_TYPES).nullable(),
  motion: z.enum(CAMERA_MOTIONS).nullable(),
  people: z.int().nullable(),
  /** Where the slot sits in the reel, in seconds. */
  reel: z.object({ at: seconds, seconds }),
  /** The cast's score for the clip filling it, and its parts (higher is better; penalty is subtracted). */
  cast: z
    .object({
      score: part,
      parts: z.object({
        intent: part,
        motion: part,
        subject: part,
        energy: part,
        quality: part,
        hook: part.nullable(),
        rerank: part.nullable(),
        penalty: part,
      }),
    })
    .optional(),
});
export type SlotFacts = z.output<typeof slotFactsSchema>;

const round = (value: number, places: number) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

const cut = (text: string) =>
  text.length > SLOT_INTENT_CHARS ? `${text.slice(0, SLOT_INTENT_CHARS - 1).trimEnd()}…` : text;

/**
 * Each slot's facts by slot id. `template` is the version the timeline names (null: none, or it can't be read: no
 * facts). A cast pick counts for a slot only while its clip is the one there (`clipIds`: slot id → clip id now).
 */
export function slotFactsOf(
  timeline: Pick<Timeline, 'cast'>,
  template: Pick<Template, 'slots'> | null,
  clipIds?: ReadonlyMap<string, string>,
): Map<string, SlotFacts> {
  const facts = new Map<string, SlotFacts>();
  if (!template) return facts;
  const cast = new Map(timeline.cast?.slots.map((slot) => [slot.slotId as string, slot]) ?? []);
  template.slots.forEach((slot, index) => {
    const picked = cast.get(slot.id);
    const current = clipIds?.get(slot.id);
    const pick =
      picked?.pick && (current === undefined || picked.clipId === current) ? picked.pick : undefined;
    const { intent } = slot;
    facts.set(slot.id, {
      slot: index + 1,
      role: slot.role,
      intent: cut(intent.text.trim()),
      needs: [...(intent.needs ?? [])],
      face: intent.face ?? null,
      shotType: intent.shotType,
      motion: intent.motion,
      people: intent.people,
      reel: {
        at: round(RationalTime.toSeconds(slot.start), 2),
        seconds: round(RationalTime.toSeconds(slot.duration), 2),
      },
      ...(pick
        ? {
            cast: {
              score: round(pick.score, 3),
              parts: {
                intent: round(pick.parts.intent, 3),
                motion: round(pick.parts.motion, 3),
                subject: round(pick.parts.subject, 3),
                energy: round(pick.parts.energy, 3),
                quality: round(pick.parts.quality, 3),
                hook: pick.parts.hook === null ? null : round(pick.parts.hook, 3),
                rerank: pick.parts.rerank === null ? null : round(pick.parts.rerank, 3),
                penalty: round(pick.parts.penalty, 3),
              },
            },
          }
        : {}),
    });
  });
  return facts;
}

/** Where a slot's clip sits on the timeline: its number as timeline.get shows it (gaps have none) and its seconds. */
export interface SlotPlace {
  readonly slotId: string;
  readonly clipId: string;
  /** The clip's number, 1 first, gaps not counted; null for a gap. */
  readonly clip: number | null;
  readonly kind: 'clip' | 'gap';
  readonly at: number;
  readonly seconds: number;
}

/** Each slot's clip (or gap) on V1, by slot id; a slot filled twice keeps its first. */
export function slotPlacesOf(timeline: Timeline): Map<string, SlotPlace> {
  const rate = timeline.canvas.rate;
  const toSeconds = (frames: number) => (frames * rate.den) / rate.num;
  const places = new Map<string, SlotPlace>();
  let number = 0;
  for (const { item, start, end } of positions(videoItems(timeline))) {
    const clip = item.type === 'clip' ? ++number : null;
    if (!item.slotId || places.has(item.slotId)) continue;
    places.set(item.slotId, {
      slotId: item.slotId,
      clipId: item.id,
      clip,
      kind: item.type,
      at: toSeconds(start),
      seconds: toSeconds(end - start),
    });
  }
  return places;
}
