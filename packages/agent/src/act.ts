// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Runs the open tool calls of a turn (SPEC section 5). Pseudo-tools first,
 * then read tools in parallel (bounded), then tools that change state one at
 * a time in the model's order, so undo order matches the log. A call the
 * policy defers stays open and the run pauses; it runs again, under the same
 * id, once the user answers.
 */
import { CancelledError, ok, type AsyncResult, type TaalcutError } from '@taalcut/core';
import { ToolAwaitingApproval, type ToolResult } from '@taalcut/tools';
import { commentPointing } from './comments/comment-request';
import type { RunContext } from './context';
import { knownIds, mendIds } from './context/id-repair';
import { readerOptions } from './context/reader-options';
import { outsideSkillDetail, withRefusalHint } from './context/refusal-hints';
import { OutsideSkill } from './errors';
import { META_TOOLS, runMetaTool } from './meta-tools';
import { stepOffer } from './skill-offer';
import { draftRefusal, roundEvents } from './make-rounds';
import { resultCardEvents } from './result-cards';
import type { EventInput } from './run-log';
import { SKILL_META_TOOLS, runSkillMeta } from './skill-tools';
import { stepAllows } from './skill-withheld';
import { pendingApprovals, type ToolCallState } from './state';

const NO_USAGE = { usd: 0, inputTokens: 0, outputTokens: 0 };

export type ActOutcome = 'done' | 'paused';

export async function executeOpenCalls(
  ctx: RunContext,
  open: readonly ToolCallState[],
): AsyncResult<ActOutcome> {
  const meta = open.filter((c) => c.requested.meta);
  const reads = open.filter((c) => !c.requested.meta && c.requested.sideEffect === 'read');
  const writes = open.filter((c) => !c.requested.meta && c.requested.sideEffect !== 'read');
  let deferred = false;

  for (const call of meta) {
    const done = SKILL_META_TOOLS.includes(call.requested.tool)
      ? await runSkillMeta(ctx, call)
      : await runMeta(ctx, call);
    if (!done.ok) return done;
    if (done.value === 'deferred') deferred = true;
  }
  const isCloud = (c: ToolCallState) =>
    ctx.registry.resolve(c.requested.tool)?.descriptor.costClass !== 'local';
  const runOne = async (call: ToolCallState) => {
    const outcome = await runRegistryTool(ctx, call);
    if (outcome.ok && outcome.value === 'deferred') deferred = true;
    return outcome;
  };
  const results = await Promise.all([
    pool(
      reads.filter((c) => !isCloud(c)),
      ctx.settings.maxParallel,
      runOne,
    ),
    pool(reads.filter(isCloud), ctx.settings.maxParallelCloud, runOne),
  ]);
  const failed = results.flat().find((r) => !r.ok);
  if (failed && !failed.ok) return failed;
  for (const call of writes) {
    if (ctx.signal.aborted) break;
    const outcome = await runOne(call);
    if (!outcome.ok) return outcome;
  }

  if (!deferred) return ok('done');
  const pending = pendingApprovals(ctx.log.state);
  const paused = await ctx.log.append([
    'run.paused',
    {
      reason: pending.some((a) => a.request.kind === 'budget') ? 'budget' : 'approval',
      requestIds: pending.map((a) => a.request.requestId),
    },
  ]);
  return paused.ok ? ok('paused') : paused;
}

async function runRegistryTool(ctx: RunContext, call: ToolCallState): AsyncResult<'logged' | 'deferred'> {
  const { requested } = call;
  const started = ctx.now();
  // A skill's turns may call only the skill's tools; anything else never runs.
  const state = ctx.log.state;
  const step = state.plan?.[state.stepIndex];
  const skill = step?.skill ? ctx.skills.get(step.skill) : undefined;
  if (skill && !stepAllows(ctx, skill, step)(requested.tool)) {
    // AGT1: the refusal names the step's tools.
    const refused = OutsideSkill(
      { skill: skill.id, tool: requested.tool },
      { detail: outsideSkillDetail(skill, stepAllows(ctx, skill, step), requested.tool) },
    );
    const written = await ctx.log.append(failed(requested.toolCallId, refused, 0, undefined));
    return written.ok ? ok('logged') : written;
  }
  // AGT2: a draft past the Maker's budget is refused, saying what to do instead (make-rounds.ts).
  const spent = draftRefusal(state, step, requested.tool);
  if (spent) {
    const written = await ctx.log.append(failed(requested.toolCallId, spent, 0, undefined));
    return written.ok ? ok('logged') : written;
  }
  // AGT1: an id copied wrong is mended to the run's own (context/id-repair.ts).
  const mended = mendIds(requested.input, knownIds(ctx.log.state));
  const brief = ctx.log.state.started?.editor;
  // FIX-CMT: a comment batch's tools point at what the comments are on, as a docked run's at its selection.
  const pointing =
    commentPointing(ctx.log.state) ??
    (brief ? { context: brief.context, targets: brief.targets } : undefined);
  const largeLiveWindow =
    !ctx.phase2.replay && !process.env.TAALCUT_TEST_RECORDED_MODELS && (step?.window ?? 0) >= 128_000;
  const result = await ctx.executor.execute(requested.callName, mended?.input ?? requested.input, {
    callId: requested.toolCallId,
    runId: ctx.log.runId,
    signal: ctx.signal,
    // Below the policy: render and export must carry an approval unless the run is on autopilot.
    checkpointsPreapproved: ctx.log.state.started?.autonomy === 'autopilot',
    // EDT1-OPS: a docked run's tools check a change against what the person pointed at (the brief).
    ...(pointing ? { editor: pointing } : {}),
    ...(largeLiveWindow ? { inlineOutputLimit: 32 * 1024 } : {}),
  });
  if (!result.ok && ToolAwaitingApproval.is(result.error)) return ok('deferred');
  const cards = result.ok ? await resultCardEvents(ctx, call, result.value) : [];
  const outcome = result.ok
    ? completed(ctx, result.value, cards.length > 0)
    : failed(
        requested.toolCallId,
        withRefusalHint(ctx, call, result.error),
        ctx.now() - started,
        ctx.idempotencyKeys.get(requested.toolCallId),
      );
  const written = await ctx.log.append(
    outcome,
    ...cards,
    ...settleToolEstimate(ctx, call, result.ok ? result.value : undefined),
    ...(result.ok ? roundEvents(state, step, result.value) : []),
  );
  return written.ok ? ok('logged') : written;
}

/** estimate.settled for a paid call's own estimate (outside a skill): what it really cost. */
function settleToolEstimate(
  ctx: RunContext,
  call: ToolCallState,
  result: ToolResult | undefined,
): EventInput[] {
  const estimate = Object.values(ctx.log.state.estimates).find(
    (e) => e.recorded.toolCallId === call.requested.toolCallId && !e.settled,
  );
  if (!estimate) return [];
  const usage = result?.usage ?? { usd: 0, inputTokens: 0, outputTokens: 0 };
  return [
    [
      'estimate.settled',
      {
        estimateId: estimate.recorded.estimateId,
        actual: { usd: usage.usd, tokens: usage.inputTokens + usage.outputTokens },
      },
    ],
  ];
}

function completed(ctx: RunContext, result: ToolResult, resultCard = false): EventInput {
  const key = ctx.idempotencyKeys.get(result.callId) ?? ctx.idempotencyKeys.get(result.sameAs ?? '');
  return [
    'tool.completed',
    {
      toolCallId: result.callId,
      version: result.version,
      inputHash: result.inputHash,
      output: result.output,
      cached: result.cached,
      deduplicated: result.deduplicated,
      attempts: result.attempts,
      durationMs: result.durationMs,
      usage: result.usage,
      ...(result.approvalId ? { approvalId: result.approvalId } : {}),
      ...(key ? { idempotencyKey: key } : {}),
      ...(resultCard ? { resultCard } : {}),
      ...(result.summary ? { summary: result.summary } : {}),
    },
  ];
}

function failed(
  toolCallId: ToolCallState['requested']['toolCallId'],
  error: TaalcutError,
  durationMs: number,
  idempotencyKey: string | undefined,
): EventInput {
  return [
    'tool.failed',
    {
      toolCallId,
      error,
      attempts: CancelledError.is(error) ? 0 : 1,
      durationMs,
      usage: NO_USAGE,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    },
  ];
}

async function runMeta(ctx: RunContext, call: ToolCallState): AsyncResult<unknown> {
  const { requested } = call;
  const started = ctx.now();
  const plan = ctx.log.state.plan;
  const step = plan?.[ctx.log.state.stepIndex];
  const skill = step?.skill ? ctx.skills.get(step.skill) : undefined;
  const outcome = await runMetaTool(requested.tool, requested.input, {
    registry: ctx.registry,
    ...(ctx.artifacts ? { artifacts: ctx.artifacts } : {}),
    currentPlan: plan,
    skills: ctx.skills,
    ...(skill ? { allowed: stepAllows(ctx, skill, step), skill: skill.id } : {}),
    findLimit: stepOffer(step).search,
    // b1: the 4B planned handOff as a skill.
    isTool: (name) =>
      ctx.registry.resolve(name) !== undefined ||
      META_TOOLS.includes(name) ||
      SKILL_META_TOOLS.includes(name),
    storedArtifacts: () => storedArtifacts(ctx),
    ...readerOptions(ctx, skill?.module ?? 'agent'),
  });
  const durationMs = ctx.now() - started;
  if (!outcome.ok) {
    const error = {
      code: outcome.code,
      messageKey: `errors.${outcome.code}`,
      retryable: false,
      detail: outcome.detail,
    };
    return ctx.log.append([
      'tool.failed',
      { toolCallId: requested.toolCallId, error, attempts: 1, durationMs, usage: NO_USAGE },
    ]);
  }
  const events: EventInput[] = [];
  if (outcome.steps)
    events.push(
      plan ? ['plan.updated', { steps: outcome.steps }] : ['plan.created', { steps: outcome.steps }],
    );
  events.push([
    'tool.completed',
    {
      toolCallId: requested.toolCallId,
      output: { kind: 'inline', value: outcome.text },
      cached: false,
      deduplicated: false,
      attempts: 1,
      durationMs,
      usage: NO_USAGE,
      ...(outcome.loaded ? { loaded: outcome.loaded } : {}),
    },
  ]);
  return ctx.log.append(...events);
}

/** Runs `work` over `items` with at most `limit` at a time, starting them in order. */
async function pool<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** AGT1: the artifacts this run's tools stored, newest first, for readArtifact's refusal of an id that isn't one. */
function storedArtifacts(ctx: RunContext): { id: string; summary: string }[] {
  const state = ctx.log.state;
  return state.toolCallOrder
    .flatMap((id) => {
      const outcome = state.toolCalls[id]?.outcome;
      if (outcome?.kind !== 'completed' || outcome.payload.output.kind !== 'artifact') return [];
      const { ref } = outcome.payload.output;
      return [{ id: ref.id, summary: ref.summary.slice(0, 80) }];
    })
    .reverse();
}
