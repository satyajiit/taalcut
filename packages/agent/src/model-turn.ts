// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One model turn: budget check, model.requested (written before the call),
 * the streamed call with deltas to the UI, then model.responded together with
 * a tool.requested for every tool call, in one append. So tool calls are in
 * the log before any of them runs.
 */
import {
  CancelledError,
  newId,
  ok,
  type AsyncResult,
  type ProjectId,
  type TaalcutError,
  type ToolRunId,
} from '@taalcut/core';
import {
  estimateUsd,
  type ChatMessage,
  type ModelResult,
  type ToolCall,
  type ToolSpec,
} from '@taalcut/models';
import { contentHash } from '@taalcut/tools';
import { budgetBreach } from './budget';
import type { RunContext } from './context';
import { checkProjectCap, cheaperChoices, pauseAtCap } from './costs';
import type { EventPayloads } from './events';
import { fitPrompt } from './context/fit';
import { META_TOOLS } from './meta-tools';
import { isFreeTurn, retryModelCall } from './model-retry';
import type { EventInput } from './run-log';
import { isLimitError, limitGate, limitTarget, noteClientSwitch, pauseAtLimit } from './limits/limit-pause';
import { afterActTurn, beforeActTurn, shadowActTurn } from './router/turn-hooks';
import { withToolImages } from './tool-images';
import { turnContext, type TurnContext } from './turn-context';

export type TurnOutcome = 'responded' | 'paused' | 'failed' | 'cancelled' | 'retrying';

export async function modelTurn(ctx: RunContext, phase: 'plan' | 'act'): AsyncResult<TurnOutcome> {
  const { log } = ctx;
  const modelCallId = newId<'ModelCall'>();
  const held = await beforeTurn(ctx, phase, modelCallId);
  if (!held.ok) return held;
  if (held.value) return ok(held.value);
  // AGT1: held under the model's window (context/compaction.ts); logged when anything was condensed.
  const { turn, messages, compacted, error } = fitPrompt(ctx, turnContext(ctx, phase), modelCallId, phase);
  if (error) return failContext(ctx, compacted, error);
  const { tools } = turn;
  const promptChars =
    turn.system.length + JSON.stringify(messages).length + JSON.stringify(tools.map((t) => t.name)).length;
  const estimate = ctx.estimator.estimate({
    promptChars,
    expectedOutputTokens: ctx.settings.expectedOutputTokens,
  });

  // FIX-RUN: a turn that costs nothing (on this Mac, or on the person's plan) is never held at a budget.
  const breach = isFreeTurn(ctx, turn.module) ? undefined : budgetBreach(log.state, estimate, ctx.now());
  const overBudget = breach !== undefined;
  if (breach && log.state.modelBudgetAllowance === 0) return pauseAtBudget(ctx, breach, estimate);
  const capped = await projectCapGate(ctx, turn, promptChars);
  if (capped) return capped;

  const requested = await log.append(...(compacted ? [compacted] : []), [
    'model.requested',
    {
      modelCallId,
      phase,
      promptHash: promptHash(turn.system, messages, tools),
      toolNames: tools.map((t) => t.name),
      estimate,
      ...(overBudget ? { overBudget } : {}),
      ...(turn.module !== 'agent' ? { module: turn.module } : {}),
    },
  ]);
  if (!requested.ok) return requested;

  // P3-B11 mode shadow: the router answers beside the call and never changes it.
  const shadow = phase === 'act' ? shadowActTurn(ctx, modelCallId) : undefined;
  // HFW1: the newest call's pictures, for a model that sees them (tool-images.ts); the hash and the log keep the words.
  const sent = await withToolImages(messages, ctx.log.state, {
    registry: ctx.registry,
    artifacts: ctx.artifacts,
    seesImages: ctx.seesImages?.(turn.module) ?? false,
  });
  const result = await stream(ctx, turn, sent, modelCallId, estimate);
  if (!result.ok) {
    shadow?.abort();
    return turnFailed(ctx, turn.module, modelCallId, result.error, estimate);
  }
  const routes = phase === 'act' ? await afterActTurn(ctx, modelCallId, result.value.toolCalls, shadow) : [];
  const responded = await log.append(
    ...routes,
    ['model.responded', respondedPayload(modelCallId, result.value)],
    ...result.value.toolCalls.map((call) => requestFor(ctx, modelCallId, call)),
  );
  return responded.ok ? ok('responded') : responded;
}

/** A prompt that cannot fit never starts a provider call, so there is no model.failed receipt to invent. */
async function failContext(
  ctx: RunContext,
  compacted: EventInput | undefined,
  error: TaalcutError,
): AsyncResult<TurnOutcome> {
  const failed = await ctx.log.append(...(compacted ? [compacted] : []), ['run.failed', { error }]);
  return failed.ok ? ok('failed') : failed;
}

/**
 * Phase 3's hooks before a turn: a run waiting for a model limit to lift pauses again until then (G8); with the
 * router's mode on, it may narrow this act turn to one family before its tools are chosen (P3-B11). Answers the
 * turn's outcome when the turn doesn't go ahead.
 */
async function beforeTurn(
  ctx: RunContext,
  phase: 'plan' | 'act',
  modelCallId: string,
): AsyncResult<TurnOutcome | undefined> {
  const waiting = await limitGate(ctx);
  if (waiting) return waiting;
  const routed = phase === 'act' ? await beforeActTurn(ctx, modelCallId) : [];
  if (routed.length === 0) return ok(undefined);
  const logged = await ctx.log.append(...routed);
  return logged.ok ? ok(undefined) : logged;
}

/** Over a run budget with no allowance left: ask, and pause until the person answers. */
async function pauseAtBudget(
  ctx: RunContext,
  breach: NonNullable<ReturnType<typeof budgetBreach>>,
  estimate: EventPayloads['model.requested']['estimate'],
): AsyncResult<TurnOutcome> {
  const requestId = newId<'Approval'>();
  const paused = await ctx.log.append(
    [
      'approval.requested',
      {
        requestId,
        kind: 'budget',
        toolCallIds: [],
        reason: `The next model call would go over the ${breach.limit} budget`,
        limit: breach.limit,
        used: breach.used,
        max: breach.max,
        estimate,
      },
    ],
    ['run.paused', { reason: 'budget', requestIds: [requestId] }],
  );
  return paused.ok ? ok('paused') : paused;
}

/** A failed call: a dropped one is retried, a model limit pauses (G8), a cancel cancels, anything else fails. */
async function turnFailed(
  ctx: RunContext,
  module: TurnContext['module'],
  modelCallId: string,
  error: TaalcutError,
  estimate: EventPayloads['model.requested']['estimate'],
): AsyncResult<TurnOutcome> {
  const cancelled = CancelledError.is(error) || ctx.signal.aborted;
  const retried = cancelled ? undefined : await retryModelCall(ctx, modelCallId, error);
  if (retried) return retried;
  if (!cancelled && isLimitError(error)) return pauseAtLimit(ctx, module, modelCallId, error, estimate);
  const failed = await ctx.log.append(
    ['model.failed', { modelCallId, error }],
    cancelled ? ['run.cancelled', {}] : ['run.failed', { error }],
  );
  return failed.ok ? ok(cancelled ? 'cancelled' : 'failed') : failed;
}

async function stream(
  ctx: RunContext,
  turn: TurnContext,
  messages: ChatMessage[],
  modelCallId: string,
  estimate: { readonly tokens: number },
): AsyncResult<ModelResult> {
  const runId = ctx.log.runId;
  const started = ctx.log.state.started;
  // The chat's exact level beats its effort (UX3-AGT); either beats the loop's reasoning setting.
  const picked = started?.reasoning
    ? { reasoning: started.reasoning }
    : started?.effort
      ? { effort: started.effort }
      : {};
  // A flow's calls are the project's: its CloudCall rows carry the project (budgets, the privacy panel).
  const projectId = ctx.log.state.flow?.projectId as ProjectId | undefined;
  // G8: a model the person switched this module to on a rateLimit card.
  const target = limitTarget(ctx.log.state, turn.module);
  const call = ctx.models.stream({
    module: turn.module,
    ...(target ? { target } : {}),
    system: turn.system,
    messages,
    tools: turn.tools,
    signal: ctx.signal,
    trace: { runId, spanId: modelCallId, ...(projectId ? { projectId } : {}) },
    ...(ctx.settings.temperature !== undefined ? { temperature: ctx.settings.temperature } : {}),
    ...(ctx.settings.reasoning ? { reasoning: ctx.settings.reasoning } : {}),
    // ModelClient maps the run's level or effort per model (clamped to the levels each one has).
    ...picked,
    ...(ctx.settings.maxOutputTokens ? { maxTokens: ctx.settings.maxOutputTokens } : {}),
  });
  for await (const event of call) {
    if (event.type === 'text_delta')
      ctx.sink.emit({ type: 'agent.text.delta', runId, modelCallId, delta: event.delta });
    else if (event.type === 'reasoning_delta')
      ctx.sink.emit({ type: 'agent.reasoning.delta', runId, modelCallId, delta: event.delta });
    else if (event.type === 'fallback')
      await noteClientSwitch(ctx, turn.module, modelCallId, event, estimate);
  }
  return call.result();
}

function respondedPayload(modelCallId: string, result: ModelResult): EventPayloads['model.responded'] {
  return {
    modelCallId,
    provider: result.provider,
    model: result.model,
    local: result.local,
    message: result.message,
    text: result.text,
    toolCalls: [...result.toolCalls],
    usage: result.usage,
    latencyMs: result.latencyMs,
    stopReason: result.stopReason,
    reasoning: result.reasoning,
    ...(result.planBilled ? { planBilled: true } : {}),
  };
}

function requestFor(ctx: RunContext, modelCallId: string, call: ToolCall): EventInput {
  const meta = META_TOOLS.includes(call.name);
  const tool = meta ? undefined : ctx.registry.resolve(call.name);
  return [
    'tool.requested',
    {
      toolCallId: newId<'ToolRun'>() as ToolRunId,
      modelCallId,
      modelToolCallId: call.id,
      tool: tool?.descriptor.name ?? call.name,
      callName: call.name,
      meta,
      input: call.arguments,
      sideEffect: tool?.descriptor.sideEffect ?? 'read',
      ...(tool ? toolExtras(tool) : {}),
    },
  ];
}

/** What the log notes about a registry tool: its paid module and whether it shows its own cards. */
export function toolExtras(tool: {
  readonly descriptor: { readonly permission: { readonly cloudModules?: readonly string[] } };
  readonly spec: { readonly approvalCard?: unknown; readonly resultCard?: unknown };
}): Pick<EventPayloads['tool.requested'], 'cloudModule' | 'cards'> {
  const cloudModule = tool.descriptor.permission.cloudModules?.[0];
  const cards = {
    ...(tool.spec.approvalCard ? { approval: true } : {}),
    ...(tool.spec.resultCard ? { result: true } : {}),
  };
  return {
    ...(cloudModule ? { cloudModule } : {}),
    ...(Object.keys(cards).length > 0 ? { cards } : {}),
  };
}

/**
 * The project cap before a paid model call (SPEC section 14): over it, the run
 * pauses on the budgetCap card with the cheaper models that would fit.
 */
async function projectCapGate(ctx: RunContext, turn: TurnContext, promptChars: number) {
  const state = ctx.log.state;
  const projectId = state.flow?.projectId ?? state.started?.projectId;
  const price = ctx.phase2.prices?.price(turn.module);
  if (ctx.phase2.replay || !projectId || !price || price.local) return undefined;
  const tokens = { inputTokens: Math.ceil(promptChars / 4), outputTokens: ctx.settings.expectedOutputTokens };
  const usd = estimateUsd(price, tokens);
  const cap = await checkProjectCap(ctx.phase2, projectId, usd);
  if (!cap.over) return undefined;
  const paused = await pauseAtCap(ctx.log, {
    toolCallIds: [],
    projectId,
    labelKey: turn.skill?.labelKey ?? 'flows.step.model',
    reason: `The next ${turn.module} model call would go over the project's cap`,
    estimate: { usd, tokens: tokens.inputTokens + tokens.outputTokens },
    cap: cap.cap,
    cheaper: cheaperChoices(ctx.phase2.prices, turn.module, tokens, cap.cap.usd - cap.cap.spentUsd),
  });
  return paused.ok ? ok('paused' as const) : paused;
}

/** Hash of what was sent, minus provider-native blobs. Replay compares it to spot prompt drift. */
export function promptHash(
  system: string,
  messages: readonly ChatMessage[],
  tools: readonly ToolSpec[],
): string {
  const plain = messages.map((m) => (m.role === 'assistant' ? { ...m, native: undefined } : m));
  return contentHash({ system, messages: plain, tools: tools.map((t) => t.name) });
}
