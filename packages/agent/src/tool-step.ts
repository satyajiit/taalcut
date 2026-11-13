// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A flow step the agent runs itself, with no model turn: one call of a tool
 * (the export, SPEC section 13). The call goes through the executor and the
 * policy like any other, so a checkpoint tool still stops for the one
 * approval (the tool's own approval card), and its result card shows the
 * render. A flow that starts from an opening card also needs no model turn.
 */
import { newId, OPENING_PATHS, type AsyncResult, type ChatStart, type ToolRunId } from '@taalcut/core';
import { z } from 'zod';
import type { RunContext } from './context';
import { SkillNotFound } from './errors';
import { conflictHead } from './export-conflicts';
import { afterToolStep } from './flow-followups';
import { emitCostRecorded, emitExportCompleted, emitFlowStarted } from './flow-telemetry';
import { flowFacts, flowProblems } from './flows';
import { toolExtras } from './model-turn';
import type { EventInput } from './run-log';
import type { StepState } from './run-state';
import { placeCard } from './skill-cards';
import { flowStartEvents, runnablePaths } from './skill-tools';
import { flowCallId } from './state';

/** step.started and the step's one tool call, its input built from the flow's facts. */
export function startToolStep(ctx: RunContext, index: number): AsyncResult<unknown> {
  const state = ctx.log.state;
  const step = state.plan![index]!;
  const started: EventInput = ['step.started', { stepId: step.id, index, text: step.text }];
  const tool = ctx.registry.resolve(step.tool ?? '');
  if (!tool) {
    const error = {
      code: 'tools.not_found',
      messageKey: 'errors.tools.not_found',
      retryable: false,
      detail: `No tool ${step.tool}.`,
    };
    return ctx.log.append(started, ['run.failed', { error }]);
  }
  const facts = flowFacts(state, step);
  // The tool's own schema keeps the fields it declares; the executor validates the rest.
  const input =
    tool.spec.input instanceof z.ZodObject
      ? Object.fromEntries(
          Object.entries(facts).filter(([key]) => key in (tool.spec.input as z.ZodObject).shape),
        )
      : facts;
  return ctx.log.append(started, [
    'tool.requested',
    {
      toolCallId: newId<'ToolRun'>() as ToolRunId,
      modelCallId: flowCallId(step.id),
      modelToolCallId: `flow_${step.id}`,
      tool: tool.descriptor.name,
      callName: tool.descriptor.callName,
      meta: false,
      input,
      sideEffect: tool.descriptor.sideEffect,
      ...toolExtras(tool),
    },
  ]);
}

/** The step's call ended: done, skipped (declined, or superseded by a change), or the run fails with its error. */
export async function finishToolStep(ctx: RunContext, step: StepState): AsyncResult<unknown> {
  const head = await conflictHead(ctx, step);
  const state = ctx.log.state;
  const follow = afterToolStep(state, step, ctx.skills, head);
  if (follow === undefined) {
    const call = state.toolCalls[step.toolCallId ?? ''];
    const error =
      call?.outcome?.kind === 'failed'
        ? call.outcome.payload.error
        : { code: 'core.internal', messageKey: 'errors.core.internal', retryable: false };
    return ctx.log.append(['run.failed', { error }]);
  }
  if (step.toolOutcome !== 'completed') return ctx.log.append(...follow);
  const done = await ctx.log.append(
    ['verify.result', { stepId: step.id, verdict: 'pass' }],
    ['checkpoint.saved', { stepId: step.id }],
  );
  if (done.ok && step.flow?.key === 'export') {
    emitCostRecorded(ctx, ctx.log.state, 'export');
    await emitExportCompleted(ctx, step);
  }
  return done;
}

/** An opening card's start: flow.started and the seeded plan, no planning turn. */
export async function startFlowFromCard(ctx: RunContext, start: ChatStart): AsyncResult<unknown> {
  const problems = flowProblems(start.path, ctx.skills, (name) => ctx.registry.describe(name) !== undefined);
  if (problems.length > 0) {
    const error = SkillNotFound(
      { skill: start.path },
      { detail: `The ${start.path} flow needs ${problems.join(', ')}.` },
    );
    return ctx.log.append(['run.failed', { error }]);
  }
  const appended = await ctx.log.append(...(await flowStartEvents(ctx, start)));
  if (appended.ok) emitFlowStarted(ctx, ctx.log.state);
  return appended;
}

/** After a flow that exported: the opening choices again, to make another. */
export function openingChoicesCard(ctx: RunContext): EventInput[] {
  const state = ctx.log.state;
  const exported = (state.plan ?? []).some((s) => s.flow?.key === 'export' && s.status === 'done');
  if (!state.flow || !exported || ctx.phase2.replay) return [];
  const paths = runnablePaths(ctx);
  const card = placeCard(
    {
      type: 'openingChoices',
      id: '',
      version: 1,
      runId: state.runId,
      paths: paths.length > 0 ? paths : [...OPENING_PATHS],
      unavailable: OPENING_PATHS.filter((p) => !paths.includes(p)).map((path) => ({
        path,
        reasonKey: 'flows.unavailable.notInstalled',
      })),
      hasSources: true,
    },
    `opening:${state.runId}`,
    undefined,
  );
  return card ? [['card.sent', { card }]] : [];
}
