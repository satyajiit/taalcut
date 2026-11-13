// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Exact replay (SPEC section 6): the same loop code runs again on a scratch
 * in-memory log, fed the recorded model turns, tool outcomes and verifier
 * verdicts. Nothing is dispatched, no model is called, the real log is not
 * touched. The replayed (tool, input) sequence must equal the logged one.
 */
import {
  err,
  noTelemetry,
  ok,
  type AsyncResult,
  type Result,
  type RunId,
  type SkillVerdict,
  type ToolRunId,
} from '@taalcut/core';
import type { ModelClient, ModelRequest, ModelResult } from '@taalcut/models';
import { canonicalJson, ToolAwaitingApproval, type ToolExecutor, type ToolResult } from '@taalcut/tools';
import type { Agent, AgentDeps, ReplayReport } from './agent-types';
import { ReplayDiverged, RunNotFound } from './errors';
import type { AgentEvent, EventOf } from './events';
import { loggedHeads } from './export-conflicts';
import { createMemoryEventLogStore } from './log-stores';
import { promptHash } from './model-turn';
import { withLoggedRouter } from './router/replay-advisor';
import { loggedPhase3 } from './run-start';
import { withLoggedExtensions } from './flows/extend';
import type { Verifier } from './ports';
import { foldEvents } from './state';
import { streamOf } from './testing';

interface RecordedTurn {
  readonly promptHash: string;
  readonly outcome: Result<ModelResult>;
  /** AGT1: the window the prompt was condensed to (context.compacted), so the replayed prompt is condensed alike. */
  readonly window?: number;
}

export async function replayRun(
  deps: AgentDeps,
  runId: RunId,
  makeAgent: (deps: AgentDeps) => Agent,
): AsyncResult<ReplayReport> {
  const read = await deps.log.read(runId);
  if (!read.ok) return read;
  const events = read.value;
  const started = events.find((e): e is EventOf<'run.started'> => e.type === 'run.started');
  if (!started) return err(RunNotFound({ runId }));

  let drift = 0;
  let turnIndex = 0;
  const turns = recordedTurns(events);
  const models: ModelClient = {
    stream(request: ModelRequest) {
      const turn = turns[turnIndex++];
      if (!turn)
        return streamOf(
          err(
            ReplayDiverged(
              { index: turnIndex - 1 },
              { detail: 'The replay asked the model more often than the run did.' },
            ),
          ),
        );
      if (promptHash(request.system ?? '', request.messages, request.tools ?? []) !== turn.promptHash)
        drift++;
      return streamOf(turn.outcome);
    },
    complete(request) {
      return models.stream(request).result();
    },
  };

  const scratch = createMemoryEventLogStore();
  const verdicts = recordedSkillVerdicts(events);
  // AGT2: each step's route window as logged (the router's own routes log none and start no step).
  const routeWindows = events.flatMap((e) =>
    e.type === 'route.chosen' && e.payload.by !== 'router' ? [e.payload.window] : [],
  );
  // AGT2: the head each refused export read, as the review queued after it logged it (export-conflicts.ts).
  const heads = loggedHeads(events);
  const plan = events.find((e): e is EventOf<'plan.created'> => e.type === 'plan.created');
  // No cards, estimates, cap checks, telemetry, watcher or project lookups: the log already has them.
  const { budgets: _b, prices: _p, refs: _r, projects: _j, ...rest } = deps;
  const agent = makeAgent({
    ...rest,
    models,
    log: scratch,
    executor: recordedExecutor(events, deps),
    verifier: recordedVerifier(events),
    estimator: { estimate: () => ({ tokens: 0, usd: 0 }) },
    sink: { emit: () => {} },
    settings: { ...deps.settings, budget: {} },
    telemetry: noTelemetry,
    replayVerdicts: () => verdicts.shift(),
    replayRouteWindows: () => routeWindows.shift(),
    replayHeads: (stepId) => heads.get(stepId),
    // FIX-CMT: a comment batch's plan as logged (an older one asked nothing; comments/comment-run.ts).
    ...(plan ? { replayPlan: plan.payload.steps } : {}),
    // AGT1: each turn condensed to the window it was condensed to then (none when it wasn't).
    contextWindow: () => turns[turnIndex]?.window,
    // The run's own dials (and other Phase 3 facts), as logged: the replayed prompt is the original one.
    phase3: withLoggedRouter(
      withLoggedExtensions(loggedPhase3(deps.phase3, started.payload), events),
      events,
    ),
  });
  const p = started.payload;
  const flow = events.find((e): e is EventOf<'flow.started'> => e.type === 'flow.started');
  const projectId = flow?.payload.projectId ?? p.projectId;
  const outcome = await agent.run({
    conversationId: p.conversationId,
    ...(projectId ? { projectId } : {}),
    message: p.message,
    autonomy: 'autopilot',
    budget: {},
    localOnly: p.localOnly,
    ...(p.start ? { start: p.start } : {}),
    ...(p.selections ? { selections: p.selections } : {}),
    ...(p.comments ? { comments: p.comments } : {}),
  });
  if (!outcome.ok) return outcome;

  const expected = toolSequence(events);
  const actual = toolSequence([...scratch.runs.values()][0] ?? []);
  const length = Math.max(expected.length, actual.length);
  for (let index = 0; index < length; index++) {
    const e = expected[index];
    const a = actual[index];
    if (e?.tool !== a?.tool || e?.input !== a?.input) {
      return err(
        ReplayDiverged(
          { index },
          {
            detail: `Expected ${e ? `${e.tool} ${e.input}` : 'no call'}, got ${a ? `${a.tool} ${a.input}` : 'no call'}.`,
          },
        ),
      );
    }
  }
  // Same calls, but the replay wanted more model turns than were recorded, or ended differently.
  if (outcome.value.error && ReplayDiverged.is(outcome.value.error)) return err(outcome.value.error);
  const original = foldEvents(runId, events).status;
  if (original !== outcome.value.status) {
    return err(
      ReplayDiverged(
        { index: expected.length },
        { detail: `The run ended ${original}; the replay ended ${outcome.value.status}.` },
      ),
    );
  }
  return ok({
    runId,
    toolCalls: expected,
    modelTurns: turnIndex,
    promptDrift: drift,
    status: outcome.value.status,
  });
}

/** Model turns that ran to an outcome. Calls cut off by a crash were asked again, so they don't count. */
function recordedTurns(events: readonly AgentEvent[]): RecordedTurn[] {
  const hashes = new Map<string, string>();
  const windows = new Map<string, number>();
  const turns: RecordedTurn[] = [];
  const windowOf = (id: string) => (windows.has(id) ? { window: windows.get(id)! } : {});
  for (const event of events) {
    if (event.type === 'context.compacted') windows.set(event.payload.modelCallId, event.payload.window);
    if (event.type === 'model.requested') hashes.set(event.payload.modelCallId, event.payload.promptHash);
    if (event.type === 'model.responded') {
      const p = event.payload;
      turns.push({
        promptHash: hashes.get(p.modelCallId) ?? '',
        ...windowOf(p.modelCallId),
        outcome: ok({
          callId: p.modelCallId as ModelResult['callId'],
          module: 'agent',
          provider: p.provider,
          model: p.model,
          reasoning: 'off',
          message: p.message,
          text: p.text,
          toolCalls: p.toolCalls,
          stopReason: p.stopReason,
          usage: p.usage,
          latencyMs: p.latencyMs,
          local: p.local,
        }),
      });
    }
    if (event.type === 'model.failed' && event.payload.error.code !== 'agent.model_call_abandoned') {
      turns.push({
        promptHash: hashes.get(event.payload.modelCallId) ?? '',
        ...windowOf(event.payload.modelCallId),
        outcome: err(event.payload.error),
      });
    }
  }
  return turns;
}

/** Answers each registry tool call with the outcome the run logged for the same (tool, input), in order. */
function recordedExecutor(events: readonly AgentEvent[], deps: AgentDeps): ToolExecutor {
  const outcomes = new Map<string, AgentEvent[]>();
  for (const event of events)
    if (event.type === 'tool.completed' || event.type === 'tool.failed')
      outcomes.set(event.payload.toolCallId, [event]);
  const queues = new Map<string, (AgentEvent | undefined)[]>();
  for (const event of events) {
    if (event.type !== 'tool.requested' || event.payload.meta) continue;
    const key = keyOf(event.payload.tool, event.payload.input);
    queues.set(key, [...(queues.get(key) ?? []), outcomes.get(event.payload.toolCallId)?.[0]]);
  }
  return {
    async execute(name, input, options = {}) {
      const tool = deps.tools.resolve(name)?.descriptor.name ?? name;
      const queue = queues.get(keyOf(tool, input));
      if (!queue || queue.length === 0)
        return err(ReplayDiverged({ index: -1 }, { detail: `Unrecorded call ${tool}.` }));
      const recorded = queue.shift();
      const callId = (options.callId ?? '') as ToolRunId;
      if (!recorded) return err(ToolAwaitingApproval({ tool }));
      if (recorded.type === 'tool.failed') return err(recorded.payload.error);
      if (recorded.type !== 'tool.completed') return err(ToolAwaitingApproval({ tool }));
      const p = recorded.payload;
      const result: ToolResult = {
        callId,
        tool,
        version: p.version ?? '',
        inputHash: p.inputHash ?? '',
        value: p.output.kind === 'inline' ? p.output.value : p.output.ref,
        output: p.output,
        usage: p.usage,
        cached: p.cached,
        deduplicated: p.deduplicated,
        attempts: p.attempts,
        durationMs: p.durationMs,
        ...(p.approvalId ? { approvalId: p.approvalId } : {}),
      };
      return ok(result);
    },
  };
}

/** The skills' logged verdicts, in order (replay never calls a skill's check). */
function recordedSkillVerdicts(events: readonly AgentEvent[]): SkillVerdict[] {
  return events.flatMap((e) =>
    e.type !== 'skill.verified'
      ? []
      : [
          e.payload.verdict === 'pass'
            ? { verdict: 'pass' }
            : { verdict: e.payload.verdict, reason: e.payload.reason ?? '' },
        ],
  );
}

function recordedVerifier(events: readonly AgentEvent[]): Verifier {
  // Skill and flow tool steps log verify.result too, but they don't ask the Verifier.
  const own = new Set(
    events.flatMap((e) =>
      e.type === 'skill.verified'
        ? [e.payload.stepId]
        : e.type === 'step.started' &&
            events.some(
              (t) => t.type === 'tool.requested' && t.payload.modelCallId === `flow:${e.payload.stepId}`,
            )
          ? [e.payload.stepId]
          : [],
    ),
  );
  const verdicts = events.flatMap((e) =>
    e.type === 'verify.result' && !own.has(e.payload.stepId) ? [e.payload] : [],
  );
  let next = 0;
  return {
    async verify() {
      const v = verdicts[next++];
      if (!v || v.verdict === 'pass') return { verdict: 'pass' };
      return { verdict: v.verdict, reason: v.reason ?? '' };
    },
  };
}

function toolSequence(events: readonly AgentEvent[]): { tool: string; input: string }[] {
  return events.flatMap((e) =>
    e.type === 'tool.requested' && !e.payload.meta
      ? [{ tool: e.payload.tool, input: canonicalJson(e.payload.input) }]
      : [],
  );
}

function keyOf(tool: string, input: unknown): string {
  return `${tool}|${canonicalJson(input)}`;
}
