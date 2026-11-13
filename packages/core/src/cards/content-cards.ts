// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Phase 3's content cards (round P3-1): variants side by side (P3-V3), gap fixes (P3-B8), hub results (P3-B12),
 * a cleanup plan (P3-V9) and a batch style result (P3-V10, P3-V16). packages/ui renders each; the payloads are
 * data, with model and hub text as plain text.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { publicErrorSchema } from '../basics/error-schema';
import { idSchema } from '../basics/ids';
import { moneySchema } from '../basics/money';
import { HUB_SORTS, hubBrowseItemSchema } from '../hub/hub-contract';
import { captionPresetIdSchema } from '../render/caption-presets';
import { GAP_FIX_KINDS } from '../skills/skill-refs';
import { STYLE_KINDS } from '../styles/style-schema';
import { rationalTimeSchema } from '../time/rational-time';
import { cleanupPlanSchema } from '../timeline/cleanup';
import { gapViewSchema } from '../timeline/timelines-contract';
import { variantDifferenceSchema, variantsShortSchema } from '../timeline/variants';
import { base, runId } from './card-parts';
import { flowStepRefSchema } from './flow-cards';

const projectId = idSchema<'Project'>();
const timelineId = idSchema<'Timeline'>();

/** P3-V3: the variants of one request, side by side. Re-sent with the same id as variants finish. */
export const variantsCompareCardSchema = z.object({
  type: z.literal('variantsCompare'),
  ...base,
  runId: runId.optional(),
  step: flowStepRefSchema.optional(),
  projectId,
  castId: idSchema<'Cast'>(),
  /** The video the variants were made from ("Original"). */
  baseTimelineId: timelineId,
  baseRevision: z.int().min(1),
  status: z.enum(['making', 'ready']),
  /** In order; each with what differs from the base. */
  variants: z
    .array(variantDifferenceSchema.extend({ index: z.int().min(1).max(5), revision: z.int().min(1) }))
    .max(5),
  asked: z.int().min(2).max(5),
  /** Fewer made than asked, and why. */
  short: variantsShortSchema.nullable(),
});

/** FIX-GAPS: a clip a weak slot could take instead: what indexing said it shows, and how well it fits the slot (0–1). */
export const gapSwapCandidateSchema = z.object({
  assetId: idSchema<'Asset'>(),
  /** Null for a photo. */
  shotId: idSchema<'Shot'>().nullable(),
  /** Plain text from the library; null when the shot has no description. */
  description: z.string().max(300).nullable(),
  fit: z.number().min(0).max(1),
});
export type GapSwapCandidate = z.output<typeof gapSwapCandidateSchema>;

/**
 * FIX-GAPS: a slot whose pick is under casting's confidence line: the clip in it now, the pick's confidence, and
 * whether one of its candidates clearly fits better (the default swaps to it; otherwise the clip stays).
 */
export const gapWeakPickSchema = z.object({
  pick: gapSwapCandidateSchema,
  confidence: z.number().min(0).max(1),
  betterFit: z.boolean(),
});
export type GapWeakPick = z.output<typeof gapWeakPickSchema>;

/**
 * FIX-ASK: a clip another shot has that fits this one clearly better: the shot that gives it up (its gap or clip id,
 * its number, how well the clip fits there) and the clip that shot gets instead, so no clip is used twice.
 */
export const gapBorrowCandidateSchema = gapSwapCandidateSchema.extend({
  from: z.object({
    gapId: idSchema<'TimelineItem'>(),
    number: z.int().positive(),
    fit: z.number().min(0).max(1),
  }),
  instead: gapSwapCandidateSchema,
});
export type GapBorrowCandidate = z.output<typeof gapBorrowCandidateSchema>;

/**
 * FIX-ASK: another part of a clip a shot already shows, when the clip is long enough for two moments that don't
 * overlap: the shot that has it now and where this part starts in the clip.
 */
export const gapReuseCandidateSchema = gapSwapCandidateSchema.extend({
  usedIn: z.int().positive(),
  sourceStart: rationalTimeSchema,
});
export type GapReuseCandidate = z.output<typeof gapReuseCandidateSchema>;

/** One proposed way to fill a gap. */
export const gapFixOptionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('film') }),
  z.object({
    kind: z.literal('generate'),
    /** The image model's provider and model, shown `translate="no"`. */
    provider: z.string().min(1),
    model: z.string().min(1),
    estimate: moneySchema,
    /** Plain text the agent wrote: what the image will show. */
    prompt: z.string().max(500),
  }),
  z.object({ kind: z.literal('stock'), query: z.string().trim().min(1).max(200) }),
  z.object({
    kind: z.literal('drop'),
    /** The video's length after a ripple drop. */
    newDuration: rationalTimeSchema,
  }),
  /** FIX-GAPS, a weak slot only: its next-best candidates, best fit first. */
  z.object({ kind: z.literal('swap'), candidates: z.array(gapSwapCandidateSchema).min(1).max(3) }),
  /** FIX-GAPS, a weak slot only: the clip stays as cast. */
  z.object({ kind: z.literal('keep') }),
  /** FIX-ASK: the person adds clips for this video; once they are ready the open gaps are cast again. */
  z.object({ kind: z.literal('addClips') }),
  /** FIX-ASK: the clip another shot has, best fit first; that shot gets `instead`. */
  z.object({ kind: z.literal('borrow'), candidates: z.array(gapBorrowCandidateSchema).min(1).max(3) }),
  /** FIX-ASK: another part of a clip already used, best fit first; offered, never a default. */
  z.object({ kind: z.literal('reuse'), candidates: z.array(gapReuseCandidateSchema).min(1).max(3) }),
]);
export type GapFixOption = z.output<typeof gapFixOptionSchema>;
/** Why a fix isn't offered, in one line. */
export const GAP_FIX_UNAVAILABLE = [
  'localOnly',
  'noStockKey',
  'stockOff',
  'budgetCap',
  'noImageModel',
] as const;
/**
 * FIX-GAPS: a weak slot settles `swapped` (another clip went in) or `kept` (its clip stayed). FIX-ASK: `borrowed` (it
 * took the clip another shot had, and that shot got another) and `reused` (another part of a clip already used).
 */
export const GAP_OUTCOMES = ['open', 'filled', 'dropped', 'swapped', 'kept', 'borrowed', 'reused'] as const;

/**
 * FIX-ASK: why the run stopped to ask, at a level that otherwise decides alone: a shot has no clip, the opening shot's
 * clip is unsure, a shot that carries the template's text or graphics has an unsure clip, or many clips are unsure.
 */
export const GAP_ASK_REASONS = ['empty', 'opening', 'carries', 'manyUnsure'] as const;
export type GapAskReason = (typeof GAP_ASK_REASONS)[number];
/** FIX-ASK: what a shot carries in the template besides its clip. */
export const GAP_CARRIES = ['text', 'graphics'] as const;

/** FIX-ASK: the clip that comes closest to what a shot asks for; `usedIn` when another shot shows it now. */
export const gapClosestSchema = gapSwapCandidateSchema.extend({ usedIn: z.int().positive().nullable() });

/** FIX-ASK: the counts behind the gaps: the shots the video needs, those with a clip, with none, and unsure ones. */
export const gapSummarySchema = z.object({
  shots: z.int().min(1).max(200),
  filled: z.int().nonnegative(),
  empty: z.int().nonnegative(),
  unsure: z.int().nonnegative(),
});
export type GapSummary = z.output<typeof gapSummarySchema>;

/**
 * P3-B8: every gap with its fixes. A decision card while `asking` (answer with chat.decideApproval and
 * `{ kind: 'gapFix', fixes }`); otherwise a step panel.
 */
export const gapFixCardSchema = z.object({
  type: z.literal('gapFix'),
  ...base,
  runId: runId.optional(),
  step: flowStepRefSchema.optional(),
  projectId,
  timelineId,
  revision: z.int().min(1),
  gaps: z
    .array(
      gapViewSchema.extend({
        options: z.array(gapFixOptionSchema).min(1).max(GAP_FIX_KINDS.length),
        unavailable: z
          .array(z.object({ kind: z.enum(GAP_FIX_KINDS), reason: z.enum(GAP_FIX_UNAVAILABLE) }))
          .max(GAP_FIX_KINDS.length),
        /** Settled outcome, when the agent filled or dropped it. */
        outcome: z.enum(GAP_OUTCOMES),
        /** FIX-GAPS: present when the slot has a clip whose pick is weak, not a hole. */
        weak: gapWeakPickSchema.optional(),
        /** FIX-ASK: what the shot asks for, the template's words made short (plain text); null when it says nothing. */
        wants: z.string().max(120).nullable().optional(),
        /** FIX-ASK: the clip that comes closest, when any does. */
        closest: gapClosestSchema.nullable().optional(),
        /** FIX-ASK: the template's text or graphics on this shot. */
        carries: z.array(z.enum(GAP_CARRIES)).max(GAP_CARRIES.length).optional(),
        /**
         * FIX-ASK: the fix Taalcut proposes (what autopilot applies), one of `options`, with the clip a swap, borrow or
         * reuse takes; the asking card starts with it chosen.
         */
        proposed: z
          .object({
            fix: z.enum(GAP_FIX_KINDS),
            swapTo: z.object({ assetId: idSchema<'Asset'>(), shotId: idSchema<'Shot'>().nullable() }).optional(),
          })
          .optional(),
      }),
    )
    .min(1)
    .max(50),
  /** FIX-ASK: what's wrong, counted over the whole video. */
  summary: gapSummarySchema.optional(),
  /** FIX-ASK: clips added for this video since it was cast: how many, how many are ready, how many went in. */
  newClips: z
    .object({ added: z.int().nonnegative(), ready: z.int().nonnegative(), used: z.int().nonnegative() })
    .optional(),
  /** While the run asks; FIX-ASK: `why` says what made it ask. */
  asking: z
    .object({
      approvalId: z.string().min(1),
      why: z.array(z.enum(GAP_ASK_REASONS)).max(GAP_ASK_REASONS.length).optional(),
    })
    .optional(),
});

/** P3-B12, P3-V8: the agent's `hub.search` result. A snapshot of the index; live state via CardData. */
export const hubResultsCardSchema = z.object({
  type: z.literal('hubResults'),
  ...base,
  runId: runId.optional(),
  /** What was searched, in the user's words (plain text). */
  query: z.string().max(200).nullable(),
  sort: z.enum(HUB_SORTS),
  items: z
    .array(hubBrowseItemSchema.omit({ description: true, tags: true, createdAt: true, forkedFrom: true }))
    .max(20),
  /** The index's age when searched; shown as "as of …" when older than an hour. */
  indexFetchedAt: z.int().nonnegative(),
  error: publicErrorSchema.optional(),
});

/** P3-V9: a proposed cleanup with its numbers. Apply dispatches timeline.applyCleanup with `plan`. */
export const cleanupPlanCardSchema = z.object({
  type: z.literal('cleanupPlan'),
  ...base,
  runId: runId.optional(),
  step: flowStepRefSchema.optional(),
  projectId,
  plan: cleanupPlanSchema,
  /** Seconds before and after. */
  before: z.number().nonnegative(),
  after: z.number().nonnegative(),
  status: z.enum(['proposed', 'applied']),
});

export const STYLE_BATCH_SKIPS = ['noCaptions', 'changedSince'] as const;

/** P3-V10, P3-V16: the result of the agent's batch.applyStyle; Undo all names `commandId`. */
export const styleBatchCardSchema = z.object({
  type: z.literal('styleBatch'),
  ...base,
  runId: runId.optional(),
  apply: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('style'),
      styleId: idSchema<'Style'>(),
      name: z.string().max(80),
      styleKind: z.enum(STYLE_KINDS),
    }),
    z.object({ kind: z.literal('captionPreset'), presetId: captionPresetIdSchema }),
  ]),
  applied: z.array(z.object({ projectId, timelineId })).max(50),
  skipped: z.array(z.object({ projectId, timelineId, reason: z.enum(STYLE_BATCH_SKIPS) })).max(50),
  commandId: idSchema<'Command'>(),
});
