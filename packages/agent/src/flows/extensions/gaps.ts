// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `gaps` extension (SPEC sections 25 and 26, P3-B8): after the Librarian, when its timelines have gaps,
 * the `agent.gaps` step joins. The fixes are worked out here, once per round, from what can run now (proposals.ts)
 * and logged with the step. FIX-ASK: the run asks (question gapFix) on the gapFix card at "Ask me at every step",
 * and at "Only before render" whenever it matters (a shot with no clip, an unsure opening clip, an unsure clip on a
 * shot with the template's text or graphics, or many unsure clips: ask-policy.ts); on autopilot the defaults apply
 * and the card and the step's own words say what was done and why. An answer of "Add more clips" waits for the
 * person's new clips, casts those gaps again and asks the next round (gap-rounds.ts). The step's input is the
 * latest round's rows with the user's answer to it applied; after it hands off, the cards show how each gap settled.
 * When the model's handoff never passes the check, the step is settled from the stored timelines (BRK1-MAKE), so
 * filling gaps never fails the make.
 */
import { err, ok, ValidationError, type AsyncResult, type Card, type SkillQuestion } from '@taalcut/core';
import type { AutonomyLevel } from '../../events';
import type { RunState } from '../../run-state';
import { answeredRows, type OfferedClips } from '../../gaps/answers';
import { asksAt } from '../../gaps/ask-policy';
import {
  gapFixCards,
  gapsJoinDataSchema,
  outcomeOf,
  readJoinData,
  type GapOutcome,
  type GapsJoinData,
} from '../../gaps/gap-card';
import { joinData, type JoinRound } from '../../gaps/gap-join';
import { addClipsGaps, latestAnswer, MAX_ROUNDS, settledByRecast, waitForClips } from '../../gaps/gap-rounds';
import {
  GAPS_SKILL_ID,
  gapsInputSchema,
  gapsOutputSchema,
  IMAGE_TOOL,
  settledGaps,
  STOCK_TOOL,
} from '../../gaps/gap-skill';
import type { GapsDeps, GapTimeline, ImagePath, StockPath } from '../../gaps/gap-types';
import { openSlots, type ProposalInput } from '../../gaps/proposals';
import { cardFlowId, stepRef } from '../../skill-cards';
import type {
  FlowExtension,
  FlowExtensionAgainContext,
  FlowExtensionCardInput,
  FlowExtensionContext,
  FlowExtensionDecision,
} from '../extensions';

export const GAPS_EXTENSION = 'gaps';

export interface GapsExtensionDeps extends GapsDeps {
  /** Is this tool registered? Generate and stock are offered only when their tools are. */
  readonly registered: (tool: string) => boolean;
}

function timelineIdsOf(output: unknown): string[] {
  if (output === null || typeof output !== 'object' || !('timelineIds' in output)) return [];
  const ids = output.timelineIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

async function proposalInput(deps: GapsExtensionDeps, signal: AbortSignal): Promise<ProposalInput> {
  const localOnly = deps.localOnly?.() ?? false;
  const image: ImagePath = localOnly
    ? { ok: false, reason: 'localOnly' }
    : deps.images && deps.registered(IMAGE_TOOL)
      ? await deps.images(signal)
      : { ok: false, reason: 'noImageModel' };
  const stock: StockPath = localOnly
    ? { ok: false, reason: 'localOnly' }
    : deps.stock && deps.registered(STOCK_TOOL)
      ? deps.stock()
      : { ok: false, reason: 'stockOff' };
  return { image, stock, addClips: deps.clips !== undefined };
}

/** The clips the latest round's card offered each gap (what an answer's swapTo may name). */
function offeredBy(data: GapsJoinData): OfferedClips {
  const option = (gapId: string, kind: string) =>
    data.gaps.find((g) => g.view.gapId === gapId)?.view.options.find((o) => o.kind === kind);
  return {
    swaps: (gapId) => {
      const found = option(gapId, 'swap');
      return found?.kind === 'swap' ? found.candidates : [];
    },
    borrows: (gapId) => {
      const found = option(gapId, 'borrow');
      return found?.kind === 'borrow' ? found.candidates : [];
    },
    reuses: (gapId) => {
      const found = option(gapId, 'reuse');
      return found?.kind === 'reuse' ? found.candidates : [];
    },
  };
}

async function readAll(
  deps: GapsDeps,
  ids: readonly string[],
  signal: AbortSignal,
  offers = false,
): AsyncResult<GapTimeline[]> {
  const timelines: GapTimeline[] = [];
  for (const id of ids) {
    const read = await deps.source.read(id, signal, offers ? { offers } : undefined);
    if (!read.ok) return read;
    timelines.push(read.value);
  }
  return ok(timelines);
}

/**
 * Each gap's outcome after the handoff; FIX-ASK: a shot that gave its clip to a borrow is settled by it (it took
 * the clip the borrow gave it).
 */
function outcomes(output: unknown, input: unknown): Map<string, GapOutcome> | undefined {
  const parsed = gapsOutputSchema.safeParse(output);
  if (!parsed.success) return undefined;
  const settled = new Map(parsed.data.gaps.map((g) => [g.gapId, outcomeOf(g.applied)]));
  const given = gapsInputSchema.safeParse(input);
  for (const row of given.success ? given.data.gaps : [])
    if (row.borrow && settled.get(row.gapId) === 'borrowed') settled.set(row.borrow.clipId, 'swapped');
  return settled;
}

interface RoundContext {
  readonly autonomy: AutonomyLevel;
  readonly signal: AbortSignal;
  budgetLeftUsd(): Promise<number | null>;
}

/** One round's decision: its facts checked, and the question when the policy (or the level) asks. */
async function decide(
  deps: GapsExtensionDeps,
  timelines: readonly GapTimeline[],
  ctx: RoundContext,
  round: JoinRound,
): AsyncResult<FlowExtensionDecision> {
  const built = joinData(timelines, await proposalInput(deps, ctx.signal), await ctx.budgetLeftUsd(), round);
  const data = gapsJoinDataSchema.safeParse(built);
  if (!data.success) return err(ValidationError({ field: 'gaps' }, { detail: data.error.message }));
  const open = data.data.gaps.some((g) => !g.settled);
  const ask: SkillQuestion | undefined = open && asksAt(ctx.autonomy, built.why) ? 'gapFix' : undefined;
  return ok({ join: true, data: data.data, ...(ask ? { ask } : {}) });
}

/** FIX-ASK: the next round after "Add more clips": wait for the clips, cast those gaps again, read again. */
async function nextRound(
  deps: GapsExtensionDeps,
  state: RunState,
  ctx: FlowExtensionAgainContext,
): AsyncResult<FlowExtensionDecision | undefined> {
  const data = readJoinData(ctx.data);
  const asked = addClipsGaps(latestAnswer(state, ctx.step.id));
  const round = data?.round ?? 1;
  if (!deps.clips || !data || asked.length === 0 || round >= MAX_ROUNDS) return ok(undefined);
  const since = data.since ?? 0;
  const clips = await waitForClips(deps.clips, since, deps.clipWait, ctx.signal);
  if (!clips.ok) return clips;
  let used = 0;
  if (clips.value.ready > 0)
    for (const timeline of data.timelines) {
      const gapIds = data.gaps
        .filter((g) => g.row.timelineId === timeline.timelineId && asked.includes(g.view.gapId) && !g.settled)
        .map((g) => g.view.gapId);
      if (gapIds.length === 0) continue;
      const recast = await deps.clips.recast(timeline.timelineId, gapIds, ctx.signal);
      if (!recast.ok) return recast;
      used += recast.value.changed;
    }
  const timelines = await readAll(
    deps,
    data.timelines.map((t) => t.timelineId),
    ctx.signal,
    true,
  );
  if (!timelines.ok) return timelines;
  const open = new Set(timelines.value.flatMap((t) => openSlots(t).map((s) => s.gapId)));
  return decide(deps, timelines.value, ctx, {
    round: round + 1,
    since,
    newClips: { added: clips.value.added, ready: clips.value.ready, used },
    settled: settledByRecast(data, open),
  });
}

export function gapsExtension(deps: GapsExtensionDeps): FlowExtension {
  return {
    id: GAPS_EXTENSION,
    anchor: { after: 'librarian' },
    step: { skill: GAPS_SKILL_ID, labelKey: 'skills.agent.gaps' },
    async when(state, ctx: FlowExtensionContext) {
      const ids = timelineIdsOf(ctx.anchor.handedOff?.output);
      if (ids.length === 0) return ok({ join: false });
      const timelines = await readAll(deps, ids, ctx.signal, true);
      if (!timelines.ok) return timelines;
      if (timelines.value.every((t) => openSlots(t).length === 0)) return ok({ join: false });
      // Clips added since the Librarian started are the person's new ones (the owner's came in mid-run).
      const since = ctx.anchor.entered?.at ?? ctx.anchor.handedOff?.at ?? state.lastAt;
      return decide(deps, timelines.value, ctx, { round: 1, since });
    },
    again: (state, ctx) => nextRound(deps, state, ctx),
    input(state, step, data) {
      const parsed = readJoinData(data);
      if (!parsed) return {};
      return {
        timelineIds: parsed.timelines.map((t) => t.timelineId),
        gaps: answeredRows(
          parsed.gaps.filter((g) => !g.settled).map((g) => g.row),
          latestAnswer(state, step.id),
          offeredBy(parsed),
        ),
      };
    },
    async settle(_state, step, signal) {
      const input = gapsInputSchema.safeParse(step.entered?.input);
      if (!input.success) return ok(undefined);
      const timelines = await readAll(deps, input.data.timelineIds, signal);
      return timelines.ok ? ok(settledGaps(input.data, timelines.value)) : timelines;
    },
    cards(input: FlowExtensionCardInput): Card[] {
      const data = readJoinData(input.data);
      if (!data) return [];
      const { state, step } = input;
      const ref = step ? stepRef(state, step, input.output === undefined ? 'running' : 'ready') : undefined;
      const settled = input.output === undefined ? undefined : outcomes(input.output, step?.entered?.input);
      return gapFixCards({
        runId: state.runId,
        cardFlowId: cardFlowId(state),
        ...(ref ? { step: ref } : {}),
        data,
        ...(settled ? { outcomes: settled } : {}),
        ...(input.approvalId ? { approvalId: input.approvalId } : {}),
      });
    },
  };
}
