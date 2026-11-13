// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The facts the gaps extension joins on (logged in flow.extended's `data`) and the `gapFix` card built from
 * them (core's gapFixCardSchema, U-2): one card per timeline, one row per gap with its fixes, what isn't
 * offered and why, and how it settled. While the user is asked it carries `asking`.
 */
import {
  GAP_ASK_REASONS,
  GAP_CARRIES,
  GAP_FIX_KINDS,
  GAP_FIX_UNAVAILABLE,
  GAP_OUTCOMES,
  gapClosestSchema,
  gapFixOptionSchema,
  gapSummarySchema,
  gapViewSchema,
  gapWeakPickSchema,
  parseCard,
  rationalTimeSchema,
  type Card,
  type FlowStepRef,
  type GapFixKind,
} from '@taalcut/core';
import { z } from 'zod';

const media = z.object({ assetId: z.string().min(1), shotId: z.string().min(1).nullable() });

const rowSchema = z.object({
  timelineId: z.string().min(1),
  gapId: z.string().min(1),
  slotId: z.string().min(1).nullable(),
  number: z.int().positive(),
  state: z.enum(['empty', 'weak']),
  intent: z.string().max(500),
  fixes: z.array(z.enum(GAP_FIX_KINDS)).min(1),
  fix: z.enum(GAP_FIX_KINDS),
  prompt: z.string().max(500).optional(),
  query: z.string().max(200).optional(),
  swapTo: media.optional(),
  borrow: z.object({ clipId: z.string().min(1), number: z.int().positive(), instead: media }).optional(),
  sourceStart: rationalTimeSchema.optional(),
  why: z.string().max(300).optional(),
});

/** FIX-ASK: clips added since the cast: how many, how many are ready, how many went in. */
const newClipsSchema = z.object({
  added: z.int().nonnegative(),
  ready: z.int().nonnegative(),
  used: z.int().nonnegative(),
});

/** What flow.extended logs for the gaps step: each timeline as it was, each gap's card row and skill row. */
export const gapsJoinDataSchema = z.object({
  timelines: z
    .array(
      z.object({
        timelineId: z.string().min(1),
        projectId: z.string().min(1),
        revision: z.int().min(1),
        /** FIX-ASK: the counts over the video, for the card's first line. */
        summary: gapSummarySchema.optional(),
      }),
    )
    .min(1),
  gaps: z
    .array(
      z.object({
        view: gapViewSchema.extend({
          options: z.array(gapFixOptionSchema).min(1).max(GAP_FIX_KINDS.length),
          unavailable: z
            .array(z.object({ kind: z.enum(GAP_FIX_KINDS), reason: z.enum(GAP_FIX_UNAVAILABLE) }))
            .max(GAP_FIX_KINDS.length),
          weak: gapWeakPickSchema.optional(),
          wants: z.string().max(120).nullable().optional(),
          closest: gapClosestSchema.nullable().optional(),
          carries: z.array(z.enum(GAP_CARRIES)).max(GAP_CARRIES.length).optional(),
        }),
        row: rowSchema,
        /** FIX-ASK: a gap the person's new clips already filled: shown settled, never given to the step. */
        settled: z.enum(GAP_OUTCOMES).optional(),
      }),
    )
    .min(1)
    .max(50),
  /** FIX-ASK: which ask this is (1 when the step joined; one more after each Add more clips). */
  round: z.int().min(1).max(10).optional(),
  /** FIX-ASK: clips added after this time (ms) are the person's new clips. */
  since: z.int().nonnegative().optional(),
  newClips: newClipsSchema.optional(),
  /** FIX-ASK: why the run asks, when it does. */
  why: z.array(z.enum(GAP_ASK_REASONS)).max(GAP_ASK_REASONS.length).optional(),
});
export type GapsJoinData = z.output<typeof gapsJoinDataSchema>;

/** A gap's outcome on the card: open until the step hands off, then what was applied. */
export type GapOutcome = (typeof GAP_OUTCOMES)[number];

export function outcomeOf(applied: GapFixKind | null | undefined): GapOutcome {
  if (applied === 'drop') return 'dropped';
  if (applied === 'generate' || applied === 'stock') return 'filled';
  if (applied === 'swap') return 'swapped';
  if (applied === 'keep') return 'kept';
  if (applied === 'borrow') return 'borrowed';
  if (applied === 'reuse') return 'reused';
  return 'open';
}

export interface GapCardInput {
  readonly runId: string;
  /** The flow whose card ids the run uses. */
  readonly cardFlowId: string;
  readonly step?: FlowStepRef;
  readonly data: GapsJoinData;
  /** Each gap's outcome by gapId; absent: open. */
  readonly outcomes?: ReadonlyMap<string, GapOutcome>;
  /** While the user is asked. */
  readonly approvalId?: string;
}

export const gapCardId = (cardFlowId: string, timelineId: string) => `gaps:${cardFlowId}:${timelineId}`;

/** One card per timeline with gaps, checked against core's card protocol (an invalid one is left out). */
/** FIX-ASK: the fix Taalcut proposes for a gap, when the card offers it (the asking card starts with it chosen). */
function proposedOf(g: GapsJoinData['gaps'][number]) {
  const { fix, swapTo } = g.row;
  if (!g.view.options.some((o) => o.kind === fix)) return {};
  return { proposed: { fix, ...(swapTo ? { swapTo } : {}) } };
}

export function gapFixCards(input: GapCardInput): Card[] {
  return input.data.timelines.flatMap((timeline) => {
    const gaps = input.data.gaps.filter((g) => g.row.timelineId === timeline.timelineId);
    if (gaps.length === 0) return [];
    const parsed = parseCard({
      type: 'gapFix',
      id: gapCardId(input.cardFlowId, timeline.timelineId),
      version: 1,
      runId: input.runId,
      ...(input.step ? { step: input.step } : {}),
      projectId: timeline.projectId,
      timelineId: timeline.timelineId,
      revision: timeline.revision,
      gaps: gaps.map((g) => ({
        ...g.view,
        outcome: g.settled ?? input.outcomes?.get(g.view.gapId) ?? 'open',
        ...(g.settled ? {} : proposedOf(g)),
      })),
      ...(timeline.summary ? { summary: timeline.summary } : {}),
      ...(input.data.newClips ? { newClips: input.data.newClips } : {}),
      ...(input.approvalId
        ? {
            asking: {
              approvalId: input.approvalId,
              ...(input.data.why?.length ? { why: input.data.why } : {}),
            },
          }
        : {}),
    });
    return parsed.ok ? [parsed.value] : [];
  });
}

/** The logged join data, or undefined when it doesn't parse (a log from another build). */
export function readJoinData(data: unknown): GapsJoinData | undefined {
  const parsed = gapsJoinDataSchema.safeParse(data);
  return parsed.success ? parsed.data : undefined;
}
