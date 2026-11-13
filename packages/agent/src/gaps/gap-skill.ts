// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `agent.gaps` (SPEC section 26, P3-B8): the step the gaps extension puts after the Librarian. Its input
 * lists each gap with the fix to apply (the user's answer, else the default); the model applies them with
 * the timeline, images and stock tools and hands off what it did. The second method reads the timelines
 * again: every gap the step was given has a fix (every open gap, when the step's input isn't passed), film and
 * drop are always among them, generate and stock only when they can run now, and every applied fix shows in
 * the stored timeline. FIX-GAPS: a weak pick may also swap (timeline.swapClip, to the given candidate) or keep.
 * FIX-ASK: any gap may take the clip another shot has (that shot gets the given clip instead; both show in the stored
 * timeline) or another part of a clip already used (from the given start).
 */
import {
  defineSkill,
  GAP_FIX_KINDS,
  ok,
  rationalTimeSchema,
  ULID_PATTERN,
  type AnySkill,
  type AsyncResult,
  type GapFixKind,
  type SkillVerdict,
  type ToolCostEstimate,
} from '@taalcut/core';
import { z } from 'zod';
import { GAP_PROMPT } from './gap-prompt';
import type { GapsDeps, GapSlot, GapTimeline, SwapTarget } from './gap-types';
import { openSlots } from './proposals';

export const GAPS_SKILL_ID = 'agent.gaps';
/**
 * The stock search tool (P3-V18, library lane); stock is offered only while it is registered. AGT2: the library
 * registers it as stock.search (and the import as stock.import); the old name matched no tool, so stock never ran.
 */
export const STOCK_TOOL = 'stock.search';
export const STOCK_IMPORT_TOOL = 'stock.import';
export const IMAGE_TOOL = 'images.generateForSlot';

/** Every tool the skill may use (SPEC section 26); only the registered ones are offered. */
export const GAP_TOOLS = [
  'timeline.markForFilming',
  'timeline.gaps',
  IMAGE_TOOL,
  STOCK_TOOL,
  STOCK_IMPORT_TOOL,
  'timeline.fillGap',
  'timeline.swapClip',
  'timeline.dropSlot',
  'library.search',
] as const;
/** Drop is always offered, so the skill is composed only once its tool is there. */
export const GAP_REQUIRED_TOOLS: readonly string[] = ['timeline.dropSlot'];

const ulid = z.string().regex(ULID_PATTERN);
const fixKind = z.enum(GAP_FIX_KINDS);
const media = z.object({ assetId: z.string().min(1), shotId: z.string().min(1).nullable() });

export const gapsInputSchema = z.object({
  projectId: ulid,
  timelineIds: z.array(ulid).min(1).max(10),
  slotIds: z.array(z.string().min(1)).max(60).optional(),
  gaps: z
    .array(
      z.object({
        timelineId: ulid,
        gapId: z.string().min(1),
        slotId: z.string().min(1).nullable(),
        number: z.int().positive(),
        state: z.enum(['empty', 'weak']),
        intent: z.string().max(500),
        fixes: z.array(fixKind).min(1),
        fix: fixKind,
        prompt: z.string().max(500).optional(),
        query: z.string().max(200).optional(),
        swapTo: media.optional(),
        borrow: z
          .object({ clipId: z.string().min(1), number: z.int().positive(), instead: media })
          .optional(),
        sourceStart: rationalTimeSchema.optional(),
        why: z.string().max(300).optional(),
      }),
    )
    .max(50),
});

export const gapsOutputSchema = z.object({
  gaps: z
    .array(
      z.object({
        timelineId: ulid,
        gapId: z.string().min(1).describe("The gap's id from your input"),
        slotId: z.string().min(1).nullable(),
        fixes: z.array(fixKind).min(1).max(GAP_FIX_KINDS.length).describe('The fixes the gap was offered'),
        applied: fixKind.nullable().describe('The fix you applied; null if none worked'),
      }),
    )
    .max(50),
  filming: z.int().nonnegative().describe('Slots now on the "film this" list'),
  timelines: z
    .array(z.object({ timelineId: ulid, revision: z.int().min(1) }))
    .min(1)
    .max(10)
    .describe("Each timeline's revision after your changes"),
});
export type GapsOutput = z.output<typeof gapsOutputSchema>;
/** The gaps the step was given, from its input. */
export type GivenGaps = z.output<typeof gapsInputSchema>['gaps'];

const retry = (reason: string): SkillVerdict => ({ verdict: 'retry', reason });

const sameMedia = (a: SwapTarget | undefined, b: SwapTarget) =>
  a !== undefined && a.assetId === b.assetId && a.shotId === b.shotId;

/**
 * Whether an applied fix shows in the stored slot. FIX-GAPS: a weak pick's swap (or still, or stock clip) shows
 * as a clip casting is no longer unsure of, with the given candidate when the step's input names one; keep shows
 * as the weak pick still there.
 */
function showsApplied(applied: GapFixKind, slot: GapSlot | undefined, swapTo?: SwapTarget): boolean {
  if (applied === 'drop') return slot === undefined || slot.state === 'dropped';
  if (applied === 'keep') return slot?.state === 'weak';
  if (applied === 'swap')
    return slot?.state === 'picked' && (swapTo === undefined || sameMedia(slot.current, swapTo));
  // FIX-ASK: a borrowed or reused clip fills an empty shot (filled) or replaces an unsure one (picked).
  if (applied === 'borrow' || applied === 'reuse')
    return (
      (slot?.state === 'picked' || slot?.state === 'filled') &&
      (swapTo === undefined || sameMedia(slot.current, swapTo))
    );
  if (applied === 'generate' || applied === 'stock')
    return slot?.state === 'filled' || slot?.state === 'picked';
  return slot !== undefined && (slot.state === 'empty' || slot.note === 'filmRequested');
}

type HandedGap = GapsOutput['gaps'][number];
type FixesNow = { readonly generate: boolean; readonly stock: boolean };

/** A handoff at a revision the store has moved past. */
function staleHandoff(output: GapsOutput, timelines: readonly GapTimeline[]): string | undefined {
  for (const handed of output.timelines) {
    const stored = timelines.find((t) => t.timelineId === handed.timelineId);
    if (stored && stored.revision !== handed.revision)
      return `Timeline ${handed.timelineId} is at revision ${stored.revision}; hand off that.`;
  }
  return undefined;
}

/** What a gap's offered fixes get wrong: film and drop always, generate and stock only when available. */
function offerProblem(gap: HandedGap, can: FixesNow): string | undefined {
  if (!gap.fixes.includes('film') || !gap.fixes.includes('drop'))
    return `Gap ${gap.gapId}: film and drop are always among its fixes.`;
  if (gap.fixes.includes('generate') && !can.generate)
    return `Gap ${gap.gapId}: no still can be generated now; don't offer generate.`;
  if (gap.fixes.includes('stock') && !can.stock)
    return `Gap ${gap.gapId}: stock search isn't available; don't offer stock.`;
  return undefined;
}

/** What a gap's applied fix gets wrong: none, one it didn't offer, or one the stored timeline doesn't show. */
function appliedProblem(
  gap: HandedGap,
  timelines: readonly GapTimeline[],
  given: GivenGaps | undefined,
): string | undefined {
  if (gap.applied === null) return `Gap ${gap.gapId}: nothing was applied; use film if a fix failed.`;
  if (!gap.fixes.includes(gap.applied)) return `Gap ${gap.gapId}: ${gap.applied} wasn't one of its fixes.`;
  const timeline = timelines.find((t) => t.timelineId === gap.timelineId);
  const slot = timeline?.slots.find((s) => s.gapId === gap.gapId || (gap.slotId && s.slotId === gap.slotId));
  const row = given?.find((g) => g.gapId === gap.gapId);
  const named = gap.applied === 'swap' || gap.applied === 'borrow' || gap.applied === 'reuse';
  if (!showsApplied(gap.applied, slot, named ? row?.swapTo : undefined))
    return `Gap ${gap.gapId}: the timeline doesn't show "${gap.applied}" yet. Apply it, then hand off.`;
  if (gap.applied !== 'borrow' || !row?.borrow) return undefined;
  // The shot that gave its clip up shows what it got instead, when the reader lists it.
  const giver = timeline?.slots.find((s) => s.gapId === row.borrow?.clipId);
  return !giver || sameMedia(giver.current, row.borrow.instead)
    ? undefined
    : `Gap ${gap.gapId}: shot ${row.borrow.number} (clip ${row.borrow.clipId}) doesn't show the clip it gets instead yet. Swap it in with timeline.swapClip, then hand off.`;
}

/**
 * A gap the handoff doesn't account for: of exactly those the step was given, when its input is known (round
 * P3-3); else of every gap the stored timelines still have.
 */
function unhandledSlot(
  output: GapsOutput,
  timelines: readonly GapTimeline[],
  given: GivenGaps | undefined,
): string | undefined {
  const handled = (gapId: string, slotId: string | null) =>
    output.gaps.some((g) => g.gapId === gapId || (slotId !== null && g.slotId === slotId));
  if (given) {
    const missed = given.find((gap) => !handled(gap.gapId, gap.slotId));
    return missed
      ? `Slot ${missed.number} of timeline ${missed.timelineId} was given to you as a gap (gapId ${missed.gapId}) and has no fix. Apply its fix (${missed.fix}) and hand off every gap of your input.`
      : undefined;
  }
  for (const timeline of timelines)
    for (const open of openSlots(timeline))
      if (!handled(open.gapId, open.slotId))
        return `Slot ${open.number} of timeline ${timeline.timelineId} is still a gap with no fix.`;
  return undefined;
}

/**
 * What a given gap shows now, as an applied fix: dropped, filled by its fix, or still empty (on the film list).
 * FIX-GAPS: a weak pick still in place is kept (filmed when it is on the film list); one replaced by its fix shows it.
 */
function appliedNow(gap: GivenGaps[number], slot: GapSlot | undefined): GapFixKind | null {
  if (!slot || slot.state === 'dropped') return gap.fixes.includes('drop') ? 'drop' : null;
  if (slot.state === 'filled' || slot.state === 'picked') {
    const named = ['generate', 'stock', 'swap', 'borrow', 'reuse'] as const;
    const filled = named.find((fix) => fix === gap.fix) ?? null;
    return filled && gap.fixes.includes(filled) && showsApplied(filled, slot, gap.swapTo) ? filled : null;
  }
  if (slot.state === 'weak')
    return slot.note === 'filmRequested' || !gap.fixes.includes('keep') ? 'film' : 'keep';
  return 'film';
}

/**
 * BRK1-MAKE: the handoff Taalcut settles the step with when the model's never passed the check: each gap it was
 * given as the stored timelines show it now (a gap nothing was done to is empty, so it is on the film list), and
 * each timeline's stored revision. Pure, given what was read; the skill's check still runs on it.
 */
export function settledGaps(
  input: Pick<z.output<typeof gapsInputSchema>, 'timelineIds' | 'gaps'>,
  timelines: readonly GapTimeline[],
): GapsOutput {
  const gaps = input.gaps.map((gap) => {
    const timeline = timelines.find((t) => t.timelineId === gap.timelineId);
    const slot = timeline?.slots.find(
      (s) => s.gapId === gap.gapId || (gap.slotId !== null && s.slotId === gap.slotId),
    );
    return {
      timelineId: gap.timelineId,
      gapId: gap.gapId,
      slotId: gap.slotId,
      fixes: [...gap.fixes],
      applied: appliedNow(gap, slot),
    };
  });
  return {
    gaps,
    filming: gaps.filter((gap) => gap.applied === 'film').length,
    timelines: input.timelineIds.flatMap((timelineId) => {
      const stored = timelines.find((t) => t.timelineId === timelineId);
      return stored ? [{ timelineId, revision: stored.revision }] : [];
    }),
  };
}

/** The second method over the stored timelines (pure, given what was read): the first problem, in order. */
export function checkGaps(
  output: GapsOutput,
  timelines: readonly GapTimeline[],
  can: FixesNow,
  given?: GivenGaps,
): SkillVerdict {
  const stale = staleHandoff(output, timelines);
  if (stale) return retry(stale);
  for (const gap of output.gaps) {
    const problem = offerProblem(gap, can) ?? appliedProblem(gap, timelines, given);
    if (problem) return retry(problem);
  }
  const unhandled = unhandledSlot(output, timelines, given);
  if (unhandled) return retry(unhandled);
  const filming = output.gaps.filter((g) => g.applied === 'film').length;
  return filming === output.filming
    ? { verdict: 'pass' }
    : retry(`${filming} gap(s) went on the film list, not ${output.filming}.`);
}

/**
 * The skill over its ports, offering only the tools that are registered; undefined until drop's tool is
 * (the timeline lane's), since a gap must always be droppable.
 */
export function createGapsSkill(deps: GapsDeps, registered: (tool: string) => boolean): AnySkill | undefined {
  if (!GAP_REQUIRED_TOOLS.every(registered)) return undefined;
  const names = GAP_TOOLS.filter(registered);
  const can = async (signal: AbortSignal) => ({
    generate: registered(IMAGE_TOOL) && ((await deps.images?.(signal))?.ok ?? false),
    stock: registered(STOCK_TOOL) && (deps.stock?.().ok ?? false),
  });
  return defineSkill({
    id: GAPS_SKILL_ID,
    // 1.4.0 (AGT2): the stock tools by their registered names; no timeline.rerankSlot (no tool has it).
    version: '1.4.0',
    labelKey: 'skills.agent.gaps',
    description:
      "Fixes the slots no shot fits and the weak picks: swaps, keeps, borrows another shot's clip, reuses a clip, films, generates, finds stock or drops them, as decided.",
    prompt: GAP_PROMPT,
    tools: { names },
    input: gapsInputSchema,
    output: gapsOutputSchema,
    limits: { expectedTurns: 4 },
    refs: (out) => out.timelines.map((t) => ({ entity: 'timeline', id: t.timelineId, version: t.revision })),
    async verify(out, ctx): AsyncResult<SkillVerdict> {
      const ids = [
        ...new Set([...out.timelines.map((t) => t.timelineId), ...out.gaps.map((g) => g.timelineId)]),
      ];
      const read: GapTimeline[] = [];
      for (const id of ids) {
        const timeline = await deps.source.read(id, ctx.signal);
        if (!timeline.ok) return timeline;
        read.push(timeline.value);
      }
      // The step's input when the runner passes it: exactly the gaps it was given must be handled.
      return ok(checkGaps(out, read, await can(ctx.signal), ctx.input?.gaps));
    },
    async estimate(input, ctx): AsyncResult<ToolCostEstimate> {
      const image = await deps.images?.(ctx.signal);
      const stills = input.gaps.filter((g) => g.fix === 'generate').length;
      const usd = image?.ok ? image.usdPerImage * stills : 0;
      // Billed per image: the cost card's images line says "1 image", not "0 tokens" (review M8).
      return ok({ usd, billed: { unit: 'image', quantity: stills }, basis: `${stills} generated still(s)` });
    },
  });
}
