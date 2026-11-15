// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MATCH1: what `timeline.cast` and `timeline.assemble` say about moments (landed-moments.ts places them): the
 * slots whose template asks for one, with how to state it and the instant a stated part was read as (`lands`, only
 * when there is such a slot: a cast without one pays no words for it, here or in the Librarian's prompt, whose
 * window has no room); what became of each stated moment; and, for an assembly, the edges of kept reel slots the
 * reel blended with a person's (reel-transitions.ts).
 */
import { keepsReelFootage, type SlotEdge, type Template, type Timeline } from '@taalcut/core';
import type { z } from 'zod';
import { reelBlends } from '../assembly/reel-transitions';
import type { CastResult } from '../casting/engine';
import type { StatedPart } from '../casting/stated-parts';
import { castMoments, momentsOf, placedMoments, type StatedMoment } from './landed-moments';
import type { castToolOutputSchema } from './schemas';

/** Said with the list of slots that state a moment (`lands`), in the answer of a cast or an assembly. */
export const LANDS_WORDS =
  'Each slot in `lands` has a cut that hangs on one instant of the footage: `moment` says what is seen at its ' +
  'start or end. A part stated for such a slot (parts: [{slotId, shotId, from, to}], seconds of the shot’s ' +
  'file) is read as that instant: for edge "end" its `to` (`from`: any time before it), for edge "start" its ' +
  '`from` (`to` may be left out). `at` shows the instant taken; without `at` none is stated yet. The clip is ' +
  'placed so that frame is the last before the transition out of the slot begins ("end") or the first after ' +
  'the transition into it ends ("start"). To name the instant to the frame, look at the shot that fills the ' +
  'slot with library.frameStrip, narrowing the stretch, then state the part. What became of it is in the ' +
  'answer (a cast: the slot’s `moment`; an assembly: `moments`): landed and where in the video, or why not.';

/** The person slots that state a moment, each with the instant a stated part was read as, when one was. */
export function landsAsked(
  template: Template,
  moments: readonly StatedMoment[] = [],
): { slotId: string; edge: SlotEdge; moment: string; at?: number }[] {
  return template.slots.flatMap((slot) => {
    if (!slot.lands || keepsReelFootage(slot)) return [];
    const stated = moments.find((moment) => moment.slotId === slot.id);
    return [
      {
        slotId: slot.id as string,
        edge: slot.lands.edge,
        moment: slot.lands.moment,
        ...(stated ? { at: stated.at } : {}),
      },
    ];
  });
}

/** The slots that state a moment, with how to state its instant; nothing when the template has none. */
function landsField(template: Template, moments: readonly StatedMoment[]) {
  const slots = landsAsked(template, moments);
  return slots.length > 0 ? { lands: { how: LANDS_WORDS, slots } } : {};
}

/** A cast's answer with what its template's slots ask to land, and what became of each stated moment. */
export function withCastMoments(
  answer: z.input<typeof castToolOutputSchema>,
  cast: CastResult,
  template: Template,
  parts: readonly StatedPart[] | undefined,
): z.input<typeof castToolOutputSchema> {
  const moments = momentsOf(template, parts);
  const outcomes = moments.length > 0 ? castMoments(cast, template, moments) : [];
  return {
    ...answer,
    variants: answer.variants.map((variant, index) => ({
      ...variant,
      slots: variant.slots.map((slot) => {
        const found = outcomes[index]?.get(slot.slotId);
        if (!found) return slot;
        const { slotId: _slot, ...moment } = found;
        return { ...slot, moment };
      }),
    })),
    ...landsField(template, moments),
  };
}

/** Assembly's word on the stated moments, the slots that state one, and the reel's blended edges. */
export function assemblyMoments(
  timelines: readonly Timeline[],
  template: Template,
  parts: readonly StatedPart[] | undefined,
  reel: boolean,
) {
  const moments = momentsOf(template, parts);
  const blends = reel ? reelBlends(template) : [];
  return {
    ...(moments.length > 0 ? { moments: placedMoments(timelines, template, moments) } : {}),
    ...landsField(template, moments),
    ...(blends.length > 0 ? { reelBlends: blends } : {}),
  };
}
