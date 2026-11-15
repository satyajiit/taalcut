// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MATCH1: a kept reel clip beside the person's clip, where the reel went from one to the other by a dissolve or a
 * fade. In the reel those frames hold two pictures at once: the kept shot, and the shot the person's clip now
 * replaces. Played as they are, the made video would show the reel's creator's footage through the person's.
 *
 * The template says which frames those are: the slot that follows the transition has `transitionIn`, and the frames
 * [start - before, start + after) are not one shot's own picture (templates, gradual.ts). So:
 *
 * - **The person's clip, then the reel's.** The kept clip starts `after` frames into its slot, at the first frame
 *   that is purely its own, and still sits where it sat in the reel (in time with the reel's sound). The frames
 *   before it hold that first clean frame still (a held frame, as the editor's freeze makes), and the template's
 *   transition is put between the person's clip and the held frame, with the reel's kind and length: the person's
 *   clip dissolves into the kept shot's first clean frame, which then starts to play.
 * - **The reel's clip, then the person's.** The kept clip ends `before` frames early, at its last clean frame,
 *   which is held to the slot's end; the transition goes between the held frame and the person's clip.
 *
 * The held frame is always there, one frame at least: a transition shows its incoming clip early and runs its
 * outgoing clip late, and beside a playing reel clip those would be the reel's blended frames again.
 *
 * A whip is not blended: each side's frames are its own, blurred by its own move, so a kept clip beside one plays
 * whole and nothing is drawn on top, as KEEP1 had every transition. A slot too short to keep a frame of its own
 * beside the blended ones plays whole as well (the transition is longer than the shot: nothing clean to start
 * from), and `reelBlends` says so, for the assembly's answer. Between two kept slots the reel's picture is the
 * reel's, untouched. Pure.
 */
import {
  keepsReelFootage,
  RationalTime,
  type Clip,
  type SequenceItem,
  type Template,
  type TemplateSlot,
  type TimelineItemId,
} from '@taalcut/core';
import { reelClip, type ReelMedia } from './reel-footage';

/** The transitions whose frames hold two pictures (a dissolve), or one picture dimmed toward none (a fade). */
const blends = (transition: TemplateSlot['transitionIn']): transition is NonNullable<typeof transition> =>
  transition?.kind === 'dissolve' || transition?.kind === 'fade';

/** Whether the template's transition into `slot` is one a kept clip is cut clear of. */
export const isBlended = (slot: TemplateSlot | undefined): boolean => blends(slot?.transitionIn ?? null);

export interface ReelEdges {
  /** Frames at the slot's start that are held (the kept clip starts after them); 0 when it starts with the slot. */
  readonly lead: number;
  /** Frames at the slot's end that are held (the kept clip ends before them); 0 when it runs to the slot's end. */
  readonly tail: number;
}

/**
 * How much of a kept slot's start and end is blended with the person's side. Only a neighbour the person's clip
 * fills counts, and the kept clip keeps at least one frame: when both edges don't fit, the start's is kept (the
 * shot's opening is where the eye is), then neither.
 */
export function reelEdges(template: Template, index: number): ReelEdges {
  const slot = template.slots[index];
  if (!slot || !keepsReelFootage(slot)) return { lead: 0, tail: 0 };
  const length = slot.duration.value;
  const { lead, tail } = blendedEdges(template, index);
  if (lead + tail < length) return { lead, tail };
  if (lead < length) return { lead, tail: 0 };
  return { lead: 0, tail: tail < length ? tail : 0 };
}

/** The frames of a kept slot's start and end a dissolve or a fade shares with a person's slot, one at least. */
function blendedEdges(template: Template, index: number): ReelEdges {
  const slot = template.slots[index]!;
  const previous = template.slots[index - 1];
  const next = template.slots[index + 1];
  const into =
    previous && !keepsReelFootage(previous) && blends(slot.transitionIn) ? slot.transitionIn : null;
  const out = next && !keepsReelFootage(next) && blends(next.transitionIn) ? next.transitionIn : null;
  return { lead: into ? Math.max(1, into.after.value) : 0, tail: out ? Math.max(1, out.before.value) : 0 };
}

/** One edge of a kept slot the reel blended with a person's slot, and whether assembly cut the kept clip clear. */
export interface ReelBlend {
  readonly slotId: string;
  readonly edge: 'start' | 'end';
  readonly kind: 'dissolve' | 'fade';
  /** The kept slot's frames at that edge that are not its own picture alone. */
  readonly frames: number;
  /** A held clean frame stands in for them and the transition is drawn again; false: the slot is too short. */
  readonly redrawn: boolean;
}

/** Every such edge of the template, for the assembly's answer: what was changed, and what could not be. */
export function reelBlends(template: Template): ReelBlend[] {
  return template.slots.flatMap((slot, index): ReelBlend[] => {
    if (!keepsReelFootage(slot)) return [];
    const blended = blendedEdges(template, index);
    const held = reelEdges(template, index);
    const next = template.slots[index + 1];
    const kindOf = (transition: TemplateSlot['transitionIn']) =>
      transition?.kind === 'fade' ? 'fade' : 'dissolve';
    return [
      ...(blended.lead > 0
        ? [
            {
              slotId: slot.id as string,
              edge: 'start' as const,
              kind: kindOf(slot.transitionIn),
              frames: blended.lead,
              redrawn: held.lead > 0,
            } as const,
          ]
        : []),
      ...(blended.tail > 0
        ? [
            {
              slotId: slot.id as string,
              edge: 'end' as const,
              kind: kindOf(next?.transitionIn ?? null),
              frames: blended.tail,
              redrawn: held.tail > 0,
            } as const,
          ]
        : []),
    ];
  });
}

/** One frame of the kept reel held for `frames`: no slot of its own, no sound, no ramp (core's held-frame rule). */
function held(clip: Clip, id: TimelineItemId, frame: RationalTime, frames: number): Clip {
  return {
    ...clip,
    id,
    sourceStart: frame,
    holdFrame: frame,
    duration: RationalTime.of(frames, clip.duration.rate),
    slotId: null,
    syncPoint: null,
    beatAnchor: null,
  };
}

/**
 * The items of a slot that keeps the reel's footage: the kept clip (`ids.clip`, the slot's own), with a held first
 * clean frame before it and a held last clean frame after it where `edges` say so, and the template's transition
 * between the person's clip (`afterClip`: the item before is one) and the held first frame.
 */
export function reelItems(
  slot: TemplateSlot,
  media: ReelMedia,
  template: Template,
  edges: ReelEdges,
  ids: { readonly clip: TimelineItemId; item(): TimelineItemId },
  afterClip: boolean,
): SequenceItem[] {
  const whole = reelClip(slot, media, template, ids.clip);
  if (edges.lead === 0 && edges.tail === 0) return [whole];
  const rate = template.canvas.rate;
  const first = slot.start.value + edges.lead;
  const frames = slot.duration.value - edges.lead - edges.tail;
  const items: SequenceItem[] = [];
  if (edges.lead > 0) {
    const transition = slot.transitionIn;
    if (afterClip && transition)
      items.push({
        type: 'transition',
        id: ids.item(),
        kind: transition.kind,
        inOffset: transition.before,
        outOffset: transition.after,
        direction: transition.direction,
      });
    // The held frame starts on the slot's cut, so the cut's beat is its.
    items.push({
      ...held(whole, ids.item(), RationalTime.of(first, rate), edges.lead),
      beatAnchor: whole.beatAnchor,
    });
  }
  items.push({
    ...whole,
    sourceStart: RationalTime.of(first, rate),
    duration: RationalTime.of(frames, rate),
    beatAnchor: edges.lead > 0 ? null : whole.beatAnchor,
  });
  if (edges.tail > 0)
    items.push(held(whole, ids.item(), RationalTime.of(first + frames - 1, rate), edges.tail));
  return items;
}
