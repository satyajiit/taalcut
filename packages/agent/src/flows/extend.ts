// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Running flow extensions (SPEC section 25). Before a skill step starts, every extension anchored after a
 * finished step (or before this one) that hasn't been asked there is asked, one per pass of the loop: the
 * answer is logged, and a step that joins goes into the plan right after its anchor (or right before it),
 * with its cards and, when it asks, the question that pauses the run. A replay never asks: it reads the
 * logged answers in order.
 */
import { newId, type AsyncResult, type Card } from '@taalcut/core';
import type { RunContext } from '../context';
import { checkProjectCap } from '../costs';
import { nextFlowStepId } from '../flows';
import type { AgentEvent, PlanStep } from '../events';
import type { Phase3Deps } from '../phase3-deps';
import type { EventInput } from '../run-log';
import type { RunState, StepState } from '../run-state';
import type { FlowExtension, FlowExtensionDecision, LoggedExtensionCheck, SettlerCall } from './extensions';

interface PendingCheck {
  readonly extension: FlowExtension;
  readonly anchor: StepState;
  readonly insertAfter: string;
}

const asked = (state: RunState, extension: string, anchorStepId: string) =>
  state.extensionChecks.some((c) => c.extension === extension && c.anchorStepId === anchorStepId);

/** AGT2: an extension after the Editor follows the Maker where the Maker makes the video in its place. */
const anchoredOn = (key: string, step: StepState) =>
  step.flow?.key === key || (key === 'editor' && step.flow?.key === 'maker');

/** The first extension still to ask before plan step `index` starts. */
function pendingCheck(
  state: RunState,
  extensions: readonly FlowExtension[],
  index: number,
): PendingCheck | undefined {
  const plan = state.plan ?? [];
  const next = plan[index];
  for (const extension of extensions) {
    if ('after' in extension.anchor) {
      const key = extension.anchor.after;
      const anchor = plan
        .slice(0, index)
        .find((s) => s.status === 'done' && anchoredOn(key, s) && !asked(state, extension.id, s.id));
      if (anchor) return { extension, anchor, insertAfter: anchor.id };
    } else if (next && index > 0 && next.flow?.key === extension.anchor.before) {
      const previous = plan[index - 1];
      if (previous && !asked(state, extension.id, next.id))
        return { extension, anchor: next, insertAfter: previous.id };
    }
  }
  return undefined;
}

async function decide(
  ctx: RunContext,
  pending: PendingCheck,
): Promise<FlowExtensionDecision & { readonly errorCode?: string }> {
  const replayed = ctx.phase3.flowExtensions?.replayed;
  if (ctx.phase2.replay || replayed) return fromLog(replayed?.(), pending);
  const state = ctx.log.state;
  const projectId = state.flow?.projectId ?? state.started?.projectId;
  const decided = await pending.extension.when(state, {
    anchor: pending.anchor,
    projectId,
    autonomy: state.started?.autonomy ?? 'before-render',
    budgetLeftUsd: async () => {
      const cap = await checkProjectCap(ctx.phase2, projectId, 0);
      return cap.cap ? Math.max(0, cap.cap.usd - cap.cap.spentUsd) : null;
    },
    signal: ctx.signal,
  });
  // A store that can't answer adds no step: the run goes on as Phase 2's, and QA still checks the result.
  return decided.ok ? decided.value : { join: false, errorCode: decided.error.code };
}

/** The logged answer for this check; a replay that runs out (or disagrees) adds nothing. */
function fromLog(logged: LoggedExtensionCheck | undefined, pending: PendingCheck): FlowExtensionDecision {
  if (!logged?.joined || logged.extension !== pending.extension.id) return { join: false };
  return { join: true, ...(logged.data !== undefined ? { data: logged.data } : {}) };
}

function stepFor(extension: FlowExtension, id: string, anchor: StepState): PlanStep {
  return {
    id,
    text: '',
    labelKey: extension.step.labelKey,
    flow: { key: extension.id, variant: anchor.flow?.variant ?? 1 },
    ...(extension.step.skill ? { skill: extension.step.skill } : {}),
    ...(extension.step.tool ? { tool: extension.step.tool } : {}),
  };
}

/**
 * Asks the next pending extension before plan step `index` starts. Undefined: nothing to ask, start the step.
 * Otherwise the answer is logged and the loop runs its next pass (the new step, or the next question).
 */
export async function extendFlow(ctx: RunContext, index: number): Promise<AsyncResult<unknown> | undefined> {
  const deps = ctx.phase3.flowExtensions;
  const state = ctx.log.state;
  if (!deps || deps.extensions.length === 0 || !state.flow) return undefined;
  const pending = pendingCheck(state, deps.extensions, index);
  if (!pending) return undefined;
  const { extension, anchor } = pending;
  const decision = await decide(ctx, pending);
  const events: EventInput[] = [
    [
      'flow.extensionChecked',
      {
        extension: extension.id,
        anchorStepId: anchor.id,
        joined: decision.join,
        ...(decision.errorCode ? { errorCode: decision.errorCode } : {}),
      },
    ],
  ];
  if (!decision.join) return ctx.log.append(...events);
  const stepId = nextFlowStepId(state);
  events.push([
    'plan.updated',
    { steps: [stepFor(extension, stepId, anchor)], insertAfter: pending.insertAfter },
  ]);
  return ctx.log.append(...events, ...joinedEvents(ctx, extension, stepId, decision));
}

/**
 * The step's facts (flow.extended), its cards and, when it asks, the question and the pause; a replay logs the
 * facts alone. `again`: another round of facts for a step that joined already (FIX-ASK).
 */
function joinedEvents(
  ctx: RunContext,
  extension: FlowExtension,
  stepId: string,
  decision: Extract<FlowExtensionDecision, { join: true }>,
  again = false,
): EventInput[] {
  const state = ctx.log.state;
  const data = decision.data;
  const extended: EventInput = [
    'flow.extended',
    { extension: extension.id, stepId, ...(data !== undefined ? { data } : {}), ...(again ? { again } : {}) },
  ];
  if (ctx.phase2.replay) return [extended];
  if (!decision.ask) {
    const cards = extension.cards?.({ state, data }) ?? [];
    return [extended, ...cards.map((card) => cardSent(card, stepId))];
  }
  const requestId = newId<'Approval'>();
  const cards = extension.cards?.({ state, data, approvalId: requestId }) ?? [];
  return [
    extended,
    [
      'approval.requested',
      {
        requestId,
        kind: 'question',
        toolCallIds: [],
        reason: decision.ask,
        question: decision.ask,
        customCard: cards.length > 0,
      },
    ],
    ...cards.map((card) => cardSent(card, stepId, requestId)),
    ['run.paused', { reason: 'approval', requestIds: [requestId] }],
  ];
}

/**
 * FIX-ASK: before an extension's own step starts, its `again` (SPEC section 25). Undefined: start the step.
 * Otherwise another round is logged (with its question, when it asks) and the loop runs its next pass. Never in a
 * replay; a port that fails starts the step with the facts it has.
 */
export async function extendAgain(ctx: RunContext, index: number): Promise<AsyncResult<unknown> | undefined> {
  const state = ctx.log.state;
  const step = state.plan?.[index];
  if (ctx.phase2.replay || !step) return undefined;
  const by = joinedBy(ctx, step);
  if (!by?.extension.again) return undefined;
  const projectId = state.flow?.projectId ?? state.started?.projectId;
  const decided = await by.extension.again(state, {
    step,
    data: by.data,
    projectId,
    autonomy: state.started?.autonomy ?? 'before-render',
    budgetLeftUsd: async () => {
      const cap = await checkProjectCap(ctx.phase2, projectId, 0);
      return cap.cap ? Math.max(0, cap.cap.usd - cap.cap.spentUsd) : null;
    },
    signal: ctx.signal,
  });
  if (!decided.ok || !decided.value?.join) return undefined;
  return ctx.log.append(...joinedEvents(ctx, by.extension, step.id, decided.value, true));
}

const cardSent = (card: Card, stepId: string, approvalId?: string): EventInput => [
  'card.sent',
  { card, stepId, ...(approvalId ? { approvalId } : {}) },
];

/** The extension that added this step, and the data its latest round joined on (FIX-ASK: `again` rounds). */
function joinedBy(ctx: Pick<RunContext, 'phase3' | 'log'>, step: StepState) {
  const joined = ctx.log.state.extensions.findLast((e) => e.stepId === step.id);
  const extension = joined && ctx.phase3.flowExtensions?.extensions.find((e) => e.id === joined.extension);
  return extension && joined ? { extension, data: joined.data } : undefined;
}

/** An extension step's own input fields (on top of the flow's facts). */
export function extensionInput(
  ctx: Pick<RunContext, 'phase3' | 'log'>,
  step: StepState,
): Record<string, unknown> {
  const by = joinedBy(ctx, step);
  return by?.extension.input?.(ctx.log.state, step, by.data) ?? {};
}

/** After an extension's step hands off: its cards again, now with what the step did. */
export function extensionCards(
  ctx: Pick<RunContext, 'phase3' | 'log' | 'phase2'>,
  step: StepState,
  output: unknown,
): EventInput[] {
  const by = joinedBy(ctx, step);
  if (!by?.extension.cards || ctx.phase2.replay) return [];
  const cards = by.extension.cards({ state: ctx.log.state, step, data: by.data, output });
  return cards.map((card) => cardSent(card, step.id));
}

/**
 * BRK1-MAKE: the settled handoff of an extension step whose model never passed the check, or undefined (no
 * settle, or it found nothing to hand off). A step no extension added is settled by its skill's settler, when the
 * composition gave one. Replay hands back the logged one.
 */
export async function settleExtensionStep(ctx: RunContext, step: StepState): Promise<unknown> {
  const deps = ctx.phase3.flowExtensions;
  if (ctx.phase2.replay) return deps?.settled?.(step.id);
  const by = joinedBy(ctx, step);
  const settler = by ? undefined : deps?.settlers?.[step.skill ?? ''];
  if (!by?.extension.settle && !settler) return undefined;
  try {
    const settled = settler
      ? await settler(completedCalls(ctx, step), ctx.signal)
      : await by!.extension.settle!(ctx.log.state, step, ctx.signal);
    return settled.ok ? settled.value : undefined;
  } catch {
    return undefined;
  }
}

/** The step's completed tool calls, in the order the model asked: what a settler reads (extensions.ts). */
function completedCalls(ctx: RunContext, step: StepState): SettlerCall[] {
  const state = ctx.log.state;
  const index = state.plan?.indexOf(step) ?? -1;
  return state.transcript.flatMap((item) => {
    if (item.kind !== 'assistant' || item.step !== index) return [];
    return item.toolCallIds.flatMap((id) => {
      const call = state.toolCalls[id];
      if (!call || call.requested.meta || call.outcome?.kind !== 'completed') return [];
      const output = call.outcome.payload.output;
      return [
        {
          tool: call.requested.tool,
          input: call.requested.input,
          output: output.kind === 'inline' ? output.value : undefined,
        },
      ];
    });
  });
}

/** Replay: the run's logged extension answers, handed back in order instead of asking (SPEC section 25). */
export function withLoggedExtensions(phase3: Phase3Deps, events: readonly AgentEvent[]): Phase3Deps {
  if (!phase3.flowExtensions) return phase3;
  const checks: LoggedExtensionCheck[] = [];
  const settled = new Map<string, unknown>();
  for (const event of events) {
    if (event.type === 'skill.handedOff' && event.payload.settled) {
      settled.set(event.payload.stepId, event.payload.output);
    } else if (event.type === 'flow.extensionChecked') {
      const { extension, anchorStepId, joined } = event.payload;
      checks.push({ extension, anchorStepId, joined });
    } else if (event.type === 'flow.extended' && event.payload.data !== undefined && !event.payload.again) {
      // flow.extended follows its check in the same append.
      const last = checks.at(-1);
      if (last?.joined && last.extension === event.payload.extension)
        checks[checks.length - 1] = { ...last, data: event.payload.data };
    }
  }
  return {
    ...phase3,
    flowExtensions: {
      ...phase3.flowExtensions,
      replayed: () => checks.shift(),
      settled: (stepId) => settled.get(stepId),
    },
  };
}
