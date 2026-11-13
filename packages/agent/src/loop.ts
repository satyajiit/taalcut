// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The loop (PRD 7.1, SPEC section 3): plan → route → act → observe → verify →
 * checkpoint → report. Each pass looks only at the folded state and takes the
 * next action, writing its event before acting; so a run picks up exactly
 * where its log ends, whether it is new, resumed after a crash or replayed.
 */
import { CancelledError, newId, ok, type AsyncResult, type TaalcutError } from '@taalcut/core';
import { executeOpenCalls } from './act';
import { changesCard, editorPlan } from './editor/editor-turn';
import { budgetBreach } from './budget';
import { commentBatchPlan } from './comments/comment-run';
import { correctionDue, correctionEvent, correctionSpent } from './context/correction';
import type { RunContext } from './context';
import { ModelCallAbandoned, NoToolCalls, TurnLimit, VerifyFailed } from './errors';
import { afterInputChanges } from './flow-followups';
import { effectToolsFor } from './hyperframes-skills';
import { modelTurn } from './model-turn';
import type { EventInput } from './run-log';
import { settleStepOrFail, startSkillStep, verifySkillStep } from './skill-step';
import { openToolCalls, type RunState, type StepState } from './state';
import { failStepEvents } from './step-settle';
import { routeWindow } from './skill-offer';
import { toolOffer } from './tool-offer';
import { finishToolStep, openingChoicesCard, startFlowFromCard, startToolStep } from './tool-step';
import { MAX_TEXT_TURNS } from './turn-context';
import { runTurnLimit, stepTurnLimit } from './turn-limits';

/** Drives the run until it pauses or ends. Resolves with an error only when the log can't be written. */
export async function driveRun(ctx: RunContext): AsyncResult<void> {
  for (;;) {
    const state = ctx.log.state;
    if (state.status !== 'running') return ok(undefined);
    const next = ctx.signal.aborted ? await cancel(ctx) : await nextAction(ctx, state);
    if (!next.ok) return next;
  }
}

async function nextAction(ctx: RunContext, state: RunState): AsyncResult<unknown> {
  const { log } = ctx;
  if (state.openModelCall) {
    // The process stopped while the model was answering. Close the call; the next pass asks again.
    return log.append([
      'model.failed',
      { modelCallId: state.openModelCall.modelCallId, error: ModelCallAbandoned() },
    ]);
  }
  const wallClock = budgetBreach(state, {}, ctx.now());
  if (wallClock?.limit === 'wallClock') return pauseForWallClock(ctx, wallClock.used, wallClock.max);

  const open = openToolCalls(state);
  if (open.length > 0) return executeOpenCalls(ctx, open);
  if (!state.plan) {
    // An opening card's choice starts its flow with no planning turn.
    if (state.started?.start && !state.flow) return startFlowFromCard(ctx, state.started.start);
    // EDT1-CMT: a batch of comments goes straight to the Editor (comments/comment-run.ts).
    const batch = commentBatchPlan(state, ctx.skills, ctx.phase2.replay?.plan);
    if (batch) return log.append(batch);
    // EDT1: a docked message that asks for a change goes to the Editor with no planning turn.
    const docked = state.lastTurn ? undefined : editorPlan(ctx);
    if (docked) return log.append(docked);
    const maxPlanRetries = Math.min(3, runTurnLimit(state, ctx.skills, ctx.settings));
    return state.lastTurn && !planTurnFailed(state, maxPlanRetries)
      ? log.append(['plan.created', { steps: [defaultStep(state)] }])
      : modelTurn(ctx, 'plan');
  }

  const step = state.plan[state.stepIndex];
  if (!step || step.status === 'done' || step.status === 'skipped') {
    // What the user changed meanwhile: later steps run again once, after this one.
    const changed = step && state.flow ? afterInputChanges(state, step, ctx.skills) : [];
    if (changed.length > 0) return log.append(...changed);
    const index = state.plan.findIndex((s, i) => i > state.stepIndex && s.status === 'todo');
    return index >= 0 ? startStep(ctx, index) : report(ctx);
  }
  if (step.ended) {
    if (step.tool) return finishToolStep(ctx, step);
    return step.skill ? verifySkillStep(ctx, step) : verify(ctx, step);
  }
  // BRK1-MAKE: a skill step whose model only talks ends after a few turns, not at its turn or token limit. AGT1: one
  // corrective note first (context/correction.ts); a step that still answers in words after it ends.
  const maxText = ctx.settings.maxTextTurns ?? MAX_TEXT_TURNS;
  if (step.skill && (step.textTurns ?? 0) >= maxText) {
    if (correctionDue(step)) return ctx.log.append(correctionEvent(ctx, step));
    if (correctionSpent(step))
      return settleStepOrFail(ctx, step, NoToolCalls({ turns: step.textTurns ?? 0 }));
  }
  const perStep = stepTurnLimit(step.skill ? ctx.skills.get(step.skill) : undefined, ctx.settings, step);
  if (step.turns >= perStep)
    return step.skill
      ? settleStepOrFail(ctx, step, TurnLimit({ limit: perStep }))
      : fail(ctx, TurnLimit({ limit: perStep }), step);
  const perRun = runTurnLimit(state, ctx.skills, ctx.settings);
  if (state.turns >= perRun)
    return step.skill
      ? settleStepOrFail(ctx, step, TurnLimit({ limit: perRun }))
      : fail(ctx, TurnLimit({ limit: perRun }), step);
  return modelTurn(ctx, 'act');
}

/** Route: the main model for now. The step text searches the catalogue and the best tools are loaded. */
function startStep(ctx: RunContext, index: number): AsyncResult<unknown> {
  const state = ctx.log.state;
  const step = state.plan![index]!;
  if (step.skill) return startSkillStep(ctx, index);
  if (step.tool) return startToolStep(ctx, index);
  const query = index === 0 ? `${state.started?.message ?? ''} ${step.text}` : step.text;
  // AGT2: as many as the main model's window offers (tool-offer.ts); on a window that offers them all, every tool,
  // the nearest the query first, so every cloud model's step is offered the same.
  const window = routeWindow(ctx, 'agent');
  const offer = toolOffer(window);
  const searched = ctx.registry
    .search(query, { limit: offer.all ? Number.MAX_SAFE_INTEGER : offer.search })
    .map((hit) => hit.name);
  const effectTools =
    index === 0
      ? effectToolsFor(state.started?.selections).filter((name) => ctx.registry.resolve(name) !== undefined)
      : [];
  const rest = offer.all ? ctx.registry.catalogue().map((entry) => entry.name) : [];
  const ranked = [...new Set([...effectTools, ...searched, ...rest])];
  const tools = offer.all ? ranked : ranked.slice(0, offer.turn);
  return ctx.log.append(
    ['step.started', { stepId: step.id, index, text: step.text }],
    ['route.chosen', { stepId: step.id, query, tools, ...(window !== undefined ? { window } : {}) }],
  );
}

async function verify(ctx: RunContext, step: StepState): AsyncResult<unknown> {
  const verdict = await ctx.verifier.verify({
    runId: ctx.log.runId,
    stepId: step.id,
    text: step.text,
    summary: step.summary,
  });
  if (verdict.verdict === 'pass') {
    return ctx.log.append(
      ['verify.result', { stepId: step.id, verdict: 'pass' }],
      ['checkpoint.saved', { stepId: step.id }],
    );
  }
  if (verdict.verdict === 'retry' && step.verifyRetries < ctx.settings.maxVerifyRetries) {
    return ctx.log.append(['verify.result', { stepId: step.id, verdict: 'retry', reason: verdict.reason }]);
  }
  return ctx.log.append(
    ['verify.result', { stepId: step.id, verdict: 'fail', reason: verdict.reason }],
    ['run.failed', { error: VerifyFailed({ stepId: step.id }, { detail: verdict.reason }) }],
  );
}

/** Report: the model's closing text for the last step, and what ran, from the log; a docked run's changes card. */
async function report(ctx: RunContext): AsyncResult<unknown> {
  const state = ctx.log.state;
  const changes = await changesCard(ctx);
  const did = state.toolCallOrder
    .map((id) => state.toolCalls[id]!)
    .filter((c) => !c.requested.meta && c.outcome?.kind === 'completed')
    .map((c) => c.requested.tool);
  const summary =
    [...(state.plan ?? [])].reverse().find((s) => s.summary.trim().length > 0)?.summary ||
    state.lastTurn?.text ||
    '';
  return ctx.log.append(...openingChoicesCard(ctx), ...changes, ['run.completed', { report: summary, did }]);
}

function pauseForWallClock(ctx: RunContext, used: number, max: number): AsyncResult<unknown> {
  const pending = Object.values(ctx.log.state.approvals).find(
    (a) => a.status === 'pending' && a.request.limit === 'wallClock',
  );
  const requestId = pending?.request.requestId ?? newId<'Approval'>();
  const events: EventInput[] = pending
    ? []
    : [
        [
          'approval.requested',
          {
            requestId,
            kind: 'budget',
            toolCallIds: [],
            reason: 'The run has used its time budget',
            limit: 'wallClock',
            used,
            max,
            estimate: { usd: 0, tokens: 0 },
          },
        ],
      ];
  return ctx.log.append(...events, ['run.paused', { reason: 'budget', requestIds: [requestId] }]);
}

/** Stop button: close every open call as cancelled, then end the run. */
function cancel(ctx: RunContext): AsyncResult<unknown> {
  const state = ctx.log.state;
  const cancelled = CancelledError();
  const events: EventInput[] = openToolCalls(state).map((call) => [
    'tool.failed',
    {
      toolCallId: call.requested.toolCallId,
      error: cancelled,
      attempts: 0,
      durationMs: 0,
      usage: { usd: 0, inputTokens: 0, outputTokens: 0 },
    },
  ]);
  if (state.openModelCall)
    events.unshift(['model.failed', { modelCallId: state.openModelCall.modelCallId, error: cancelled }]);
  return ctx.log.append(...events, ['run.cancelled', {}]);
}

function fail(ctx: RunContext, error: TaalcutError, step?: StepState): AsyncResult<unknown> {
  return ctx.log.append(...failStepEvents(ctx, step), ['run.failed', { error }]);
}

function planTurnFailed(state: RunState, maxTurns: number): boolean {
  if (!state.lastTurn?.hadToolCalls || state.turns >= maxTurns) return false;
  const last = state.transcript.findLast((item) => item.kind === 'assistant');
  return Boolean(last?.toolCallIds.some((id) => state.toolCalls[id]?.outcome?.kind === 'failed'));
}

function defaultStep(state: RunState) {
  return { id: 's1', text: state.started?.message.slice(0, 200) ?? '' };
}
