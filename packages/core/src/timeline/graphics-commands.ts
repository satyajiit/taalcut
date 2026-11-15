// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Graphic commands (P3-V13, HFW1): a graphic on a timeline's text track is a composition the Designer made. It goes
 * on as a proposal (`placeComposition`), gets a new design (`setComposition`), becomes part of the video with the
 * person's "Use it" (`useProposal`), is retimed and reworded (`edit`) and removed (`remove`). Handlers:
 * @taalcut/render (it resolves the anchor). Every edit's inverse is `timeline.restore` with the tracks as they were.
 * A length is media time, like the stored graphic's; render rescales it to the canvas rate (nearest frame) once.
 * HFW1 retire: `add`, `propose` and `setComponent` (the kit's fields and DSG1's components) are gone.
 * DSG2: the Designer's graphics come as designs to choose between, the first in the video at once (`placeOptions`),
 * and the person swaps another in (`chooseOption`).
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { FrameRates } from '../time/frame-rate-value';
import { fromMilliseconds } from '../time/milliseconds';
import { RationalTime, rationalTimeSchema } from '../time/rational-time';
import { graphicParamValuesSchema } from '../templates/graphic-params';
import { graphicCompositionSchema } from '../workspace/composition';
import { GRAPHIC_OPTION_COUNT, GRAPHIC_OPTION_IDEA_MAX, graphicOptionStillSchema } from './graphic-options';
import { GRAPHIC_REQUEST_MAX, graphicProposalSchema, graphicScaleSchema } from './graphic-proposal';
import { graphicAnchorSchema, graphicPlacementSchema } from './graphics';
import { MAX_TIMELINE_COMPOSITIONS } from './timeline-schema';

export const GRAPHICS_COMMANDS = {
  edit: 'graphics.edit',
  remove: 'graphics.remove',
  /** EDT1-GFX: the person's "Use it": a proposed graphic becomes part of the video. */
  useProposal: 'graphics.useProposal',
  /**
   * HFW1: the Designer's step (`workspace.place`). Puts a graphic drawn with a composition that passed the gate on
   * the timeline as a proposal (the composition joins `graphicCompositions`), replacing the proposal it tries again
   * for. Inverse `timeline.restore`.
   */
  placeComposition: 'graphics.placeComposition',
  /**
   * HFW1: a new design for composition graphics already on the timeline (`workspace.replace`): each of them is drawn
   * with this composition from now on (it joins `graphicCompositions`), keeping its own values, its place and its
   * time. Inverse `timeline.restore`.
   */
  setComposition: 'graphics.setComposition',
  /**
   * DSG2: the Designer's step (`workspace.placeOptions`). A job's designs go on as each is ready: a new graphic
   * (`anchor`) or the text and graphics already there (`itemIds`, each keeping its words and its time) is drawn with
   * the first and is in the video at once; a later design joins the same set (`join`) as another option the person
   * chooses from, and the one in use stays. Every design's composition joins `graphicCompositions`. Inverse
   * `timeline.restore`.
   */
  placeOptions: 'graphics.placeOptions',
  /**
   * DSG2: the person's choice. Every graphic of the set is drawn with the chosen design from now on, keeping its
   * words and its time. Inverse `timeline.restore`.
   */
  chooseOption: 'graphics.chooseOption',
} as const;

const target = {
  projectId: idSchema<'Project'>(),
  timelineId: idSchema<'Timeline'>(),
  /** The revision it was made on: another is core.conflict. Default: the latest. */
  revision: z.int().positive().optional(),
};
/** How long a graphic may last: 0.5 to 600 s, compared exactly at any rate. */
export const GRAPHIC_DURATION_LIMITS = {
  min: RationalTime.of(500, FrameRates.milliseconds),
  max: RationalTime.of(600_000, FrameRates.milliseconds),
} as const;
export const graphicDurationSchema = rationalTimeSchema.refine(
  (time) =>
    !RationalTime.isBefore(time, GRAPHIC_DURATION_LIMITS.min) &&
    !RationalTime.isAfter(time, GRAPHIC_DURATION_LIMITS.max),
  { message: 'A graphic lasts 0.5 to 600 seconds' },
);

const changes = {
  anchor: graphicAnchorSchema.optional(),
  /** Absent: its own length. */
  duration: graphicDurationSchema.optional(),
  placement: graphicPlacementSchema.optional(),
  /** EDT1-GFX: its size against its composition's own (1). */
  scale: graphicScaleSchema.optional(),
  /**
   * @deprecated Round P3-1's unit, read only so an audit-log entry from it still redoes; it becomes `duration`
   * at 1000/1. Send `duration`.
   */
  durationMs: z.int().min(500).max(600_000).optional(),
};
const itemId = idSchema<'TimelineItem'>();
/** HFW1: only a composition that passed the gate goes on a timeline. */
const passedComposition = graphicCompositionSchema.refine((composition) => composition.gate.passed, {
  message: 'The composition did not pass the gate',
  path: ['gate', 'passed'],
});

/** One design of a set as it is placed: its composition, what it is going for, and a still of it over the footage. */
const placedDesign = z.object({
  composition: passedComposition,
  /** The point of view behind it, in the designing model's words: untrusted, plain text. */
  idea: z.string().trim().min(1).max(GRAPHIC_OPTION_IDEA_MAX),
  still: graphicOptionStillSchema.optional(),
});

/** Moves a P3-1 `durationMs` to `duration` (exact); `duration` wins when both are sent. */
function upgradeDuration<P extends { duration?: RationalTime; durationMs?: number }>({
  durationMs,
  ...payload
}: P) {
  return durationMs === undefined || payload.duration !== undefined
    ? payload
    : { ...payload, duration: fromMilliseconds(durationMs) };
}

export const graphicsCommandPayloads = {
  [GRAPHICS_COMMANDS.edit]: z
    .object({
      ...target,
      itemId,
      ...changes,
      /** Values for its composition's variables (its words, its colours), merged over the stored ones. */
      params: graphicParamValuesSchema.optional(),
    })
    .transform(upgradeDuration),
  [GRAPHICS_COMMANDS.remove]: z
    .object({
      ...target,
      itemId: itemId.optional(),
      itemIds: z.array(itemId).min(1).max(50).optional(),
    })
    .refine((payload) => payload.itemId !== undefined || (payload.itemIds?.length ?? 0) > 0, {
      message: 'Give itemId or itemIds',
    }),
  [GRAPHICS_COMMANDS.useProposal]: z.object({ ...target, itemId }),
  [GRAPHICS_COMMANDS.placeComposition]: z.object({
    ...target,
    composition: passedComposition,
    /** Values for its variables (its words, its colours); absent ones take their defaults. */
    params: graphicParamValuesSchema.default({}),
    /** When it comes on: words someone says, a shot, or a time (the tool resolves `at`, `phrase` or a target). */
    anchor: graphicAnchorSchema,
    /** Absent: the composition's own length. */
    duration: graphicDurationSchema.optional(),
    placement: graphicPlacementSchema.optional(),
    scale: graphicScaleSchema.optional(),
    proposal: graphicProposalSchema,
    /** "Try again": the proposed graphic this one replaces (it must still be a proposal). */
    replaces: itemId.optional(),
  }),
  [GRAPHICS_COMMANDS.setComposition]: z
    .object({
      ...target,
      /** The graphics it draws from now on (each keeps its own values). */
      itemIds: z.array(itemId).min(1).max(MAX_TIMELINE_COMPOSITIONS),
      composition: passedComposition,
      /** Values merged over each graphic's own (a colour for all of them); a value the new design doesn't name drops. */
      params: graphicParamValuesSchema.optional(),
    })
    .refine((payload) => new Set(payload.itemIds).size === payload.itemIds.length, {
      message: 'Each graphic once',
      path: ['itemIds'],
    }),
  [GRAPHICS_COMMANDS.placeOptions]: z
    .object({
      ...target,
      /**
       * The designs, the one to use first: a set holds up to three. One starts a set that later designs join; with
       * `join`, the designs to add to the set the graphics already carry.
       */
      designs: z.array(placedDesign).min(1).max(GRAPHIC_OPTION_COUNT),
      /** The person's words the designs were made from. */
      request: z.string().trim().min(1).max(GRAPHIC_REQUEST_MAX),
      createdAt: z.int().nonnegative(),
      /** A new graphic: when it comes on. */
      anchor: graphicAnchorSchema.optional(),
      /** A new graphic: values for its variables (its words). Text or graphics already there keep their own. */
      params: graphicParamValuesSchema.optional(),
      /** A new graphic: absent, the first design's own length. */
      duration: graphicDurationSchema.optional(),
      placement: graphicPlacementSchema.optional(),
      scale: graphicScaleSchema.optional(),
      /**
       * Text or graphics already there, redesigned in place. A graphic that shares a set with others brings them
       * along: an option is one look for all of them.
       */
      itemIds: z.array(itemId).min(1).max(MAX_TIMELINE_COMPOSITIONS).optional(),
      /**
       * With `itemIds`: the designs join the set those graphics carry as further options. The design in use, each
       * graphic's words and its time stay. Absent: the designs start a set and the first goes into use.
       */
      join: z.boolean().optional(),
    })
    .refine((payload) => (payload.anchor === undefined) !== (payload.itemIds === undefined), {
      message: 'Give anchor for a new graphic, or itemIds for ones already there',
      path: ['anchor'],
    })
    .refine((payload) => !payload.join || payload.itemIds !== undefined, {
      message: 'join adds to the set of graphics already there: give itemIds',
      path: ['join'],
    })
    .refine((payload) => new Set(payload.itemIds ?? []).size === (payload.itemIds?.length ?? 0), {
      message: 'Each graphic once',
      path: ['itemIds'],
    })
    .refine(
      (payload) =>
        new Set(payload.designs.map((design) => design.composition.id)).size === payload.designs.length,
      { message: 'Each design once', path: ['designs'] },
    ),
  [GRAPHICS_COMMANDS.chooseOption]: z.object({
    ...target,
    /** Any graphic of the set. */
    itemId,
    /** The design to use, by its composition (one of the set's). */
    compositionId: idSchema<'GraphicComposition'>(),
  }),
};
