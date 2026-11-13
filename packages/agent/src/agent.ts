// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * createAgent: wires the loop to its ports and keeps track of the runs it is
 * driving. One instance per agent process; no module-level state.
 */
import {
  err,
  newId,
  noTelemetry,
  ok,
  type AsyncResult,
  type ProjectId,
  type Result,
  type RunId,
} from '@taalcut/core';
import { answerEvents, closeOpen, isTerminal, outcome, resumeEvents } from './agent-answer';
import { createAgentExecutor } from './agent-executor';
import {
  type Agent,
  type AgentDeps,
  type AgentFeedEvent,
  type ApprovalAnswer,
  type ExternalRunHost,
  type RunOutcome,
  type StartRequest,
} from './agent-types';
import { createDefaultCostEstimator } from './budget';
import { createMemoryConsentStore } from './consent';
import { DEFAULT_LOOP_SETTINGS, type Phase2Context, type RunContext } from './context';
import { ApprovalUnknown, RunFinished } from './errors';
import { createExternalHost, isExternalRun } from './external/host';
import { emitCostRecorded } from './flow-telemetry';
import { createFlowWatcher } from './flow-watcher';
import { driveRun } from './loop';
import type { AgentEventSink } from './ports';
import { replayRun } from './replay';
import { RunLog, type LogListener } from './run-log';
import type { Soul } from './prompt';
import { mainSystemPrompt } from './skill-prompt';
import { runSoul } from './soul/dials';
import { runnablePaths } from './skill-tools';
import { emptySkillRegistry } from './skills';
import { startPayload } from './run-start';
import { pendingApprovals } from './state';
import { buildTrace } from './trace';
import { createTraceRecorder } from './trace-store';
import { uiEventsFor } from './ui-events';
import { acquireEditor } from './editor/editor-ownership';
import { createRunFinalization } from './editor/run-finalization';

interface ActiveRun {
  readonly log: RunLog;
  controller: AbortController;
  drive?: Promise<Result<void>>;
}

const DAY_MS = 24 * 60 * 60_000;

export function createAgent(deps: AgentDeps): Agent {
  const now = deps.now ?? Date.now;
  const finalization = createRunFinalization(deps.editing);
  const settings = deps.settings ?? {};
  const loop = { ...DEFAULT_LOOP_SETTINGS, ...settings.loop };
  const skills = deps.skills ?? emptySkillRegistry();
  const phase2: Phase2Context = {
    telemetry: deps.telemetry ?? noTelemetry,
    ...(deps.flows?.maxFixLoops !== undefined ? { maxFixLoops: deps.flows.maxFixLoops } : {}),
    ...(deps.budgets ? { budgets: deps.budgets } : {}),
    ...(deps.prices ? { prices: deps.prices } : {}),
    ...(deps.projects ? { projects: deps.projects } : {}),
    ...(deps.exports ? { exports: deps.exports } : {}),
    ...(deps.refs ? { refs: deps.refs } : {}),
    ...(deps.replayVerdicts
      ? {
          replay: {
            nextVerdict: deps.replayVerdicts,
            ...(deps.replayPlan ? { plan: deps.replayPlan } : {}),
            ...(deps.replayRouteWindows ? { nextRouteWindow: deps.replayRouteWindows } : {}),
            ...(deps.replayHeads ? { headAfter: deps.replayHeads } : {}),
          },
        }
      : {}),
  };
  const flowsRunnable = runnablePaths({ skills, registry: deps.tools }).length > 0;
  // A run's prompt: SOUL.md, then the dials its run.started logged (SPEC section 22), then the rules.
  const mainPrompt = (soul: Soul) =>
    mainSystemPrompt(soul, deps.tools.catalogue(), skills.list(), flowsRunnable);
  // The live feed: every logged event and every UI event, for the chat service and other followers.
  const listeners = new Set<(event: AgentFeedEvent) => void>();
  const notify = (event: AgentFeedEvent) => {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // A follower's bug must not break the run.
      }
    }
  };
  const sink: AgentEventSink = {
    emit: (event) => {
      deps.sink?.emit(event);
      notify(event);
    },
  };
  const recorder = deps.traces ? createTraceRecorder(deps.traces) : undefined;
  const onLogEvent: LogListener = (event, state, events) => {
    recorder?.record(event, events);
    notify(event);
    for (const ui of uiEventsFor(event, state)) sink.emit(ui);
  };
  const verifier = deps.verifier ?? { verify: async () => ({ verdict: 'pass' as const }) };
  const runs = new Map<RunId, ActiveRun>();
  const idempotencyKeys = new Map<string, string>();
  const consents = deps.consents ?? createMemoryConsentStore();

  const executor = createAgentExecutor({
    deps,
    runLog: (runId) => (runId ? runs.get(runId)?.log : undefined),
    openLogs: () => [...runs.values()].map((run) => run.log),
    consents,
    phase2,
    idempotencyKeys,
    sink,
    now,
  });

  /** The run's log. Reloaded from the store unless this agent is driving it, so answers logged elsewhere count. */
  async function open(runId: RunId): AsyncResult<ActiveRun> {
    const known = runs.get(runId);
    if (known?.drive) return ok(known);
    const log = await RunLog.open(deps.log, runId, now, onLogEvent);
    if (!log.ok) return log;
    if (!log.value.state.started) return err(RunFinished({ runId }, { detail: 'No such run in the log.' }));
    const run: ActiveRun = { log: log.value, controller: new AbortController() };
    runs.set(runId, run);
    return ok(run);
  }

  function drive(run: ActiveRun): Promise<Result<void>> {
    if (run.drive) return run.drive;
    if (run.controller.signal.aborted) run.controller = new AbortController();
    const state = run.log.state;
    const soul = runSoul(deps.soul, state.started?.soul?.dials);
    const ctx: RunContext = {
      log: run.log,
      signal: run.controller.signal,
      models: deps.models,
      registry: deps.tools,
      executor,
      systemPrompt: mainPrompt(soul),
      ...(deps.artifacts ? { artifacts: deps.artifacts } : {}),
      verifier,
      estimator: deps.estimator ?? createDefaultCostEstimator(() => state.modelUsage, settings),
      sink,
      now,
      settings: loop,
      idempotencyKeys,
      soul,
      skills,
      phase2,
      phase3: deps.phase3 ?? {},
      ...(deps.contextWindow ? { contextWindow: deps.contextWindow } : {}),
      ...(deps.seesImages ? { seesImages: deps.seesImages } : {}),
      ...(deps.templateSlots ? { templateSlots: deps.templateSlots } : {}),
    };
    run.drive = driveRun(ctx)
      .then(async (result) => {
        if (isTerminal(run.log.state)) {
          const finalized = await finalization.finish(run.log.runId);
          if (!finalized.ok) return finalized;
        }
        await recorder?.flush(run.log.runId);
        if (isTerminal(run.log.state) && deps.traceExporter) {
          await deps.traceExporter.export(buildTrace(run.log.runId, run.log.events));
        }
        return result;
      })
      .finally(() => {
        run.drive = undefined;
      });
    return run.drive;
  }

  async function settle(runId: RunId): AsyncResult<RunOutcome> {
    const run = runs.get(runId);
    if (!run) return outcomeOf(runId);
    const driven = await (run.drive ?? Promise.resolve(ok(undefined)));
    if (!driven.ok) return driven;
    return ok(outcome(run.log.state));
  }

  async function outcomeOf(runId: RunId): AsyncResult<RunOutcome> {
    const run = await open(runId);
    return run.ok ? ok(outcome(run.value.log.state)) : run;
  }

  async function continueRun(run: ActiveRun, after: 'crash' | 'approval'): AsyncResult<RunOutcome> {
    // An external run (MCP) has no loop to continue: its runner acts on the answers.
    if (isExternalRun(run.log)) return ok(outcome(run.log.state));
    const project = run.log.state.started?.editingProjectId;
    if (project && deps.editing) {
      const acquired = await deps.editing.acquire(project as ProjectId, run.log.runId);
      if (!acquired.ok) return acquired;
    }
    const resumed = await run.log.append(...resumeEvents(run.log.state, after));
    if (!resumed.ok) return resumed;
    void drive(run);
    return settle(run.log.runId);
  }

  const watcher = deps.refs
    ? createFlowWatcher({
        refs: deps.refs,
        skills,
        runs: () => [...runs.values()].map((r) => r.log),
        resume: (log) => {
          const run = runs.get(log.runId);
          if (run && !run.drive && pendingApprovals(log.state).length === 0)
            void continueRun(run, 'approval');
        },
        ...(deps.flows?.staleAfterMs !== undefined ? { staleAfterMs: deps.flows.staleAfterMs } : {}),
      })
    : undefined;

  const agent = {
    onFinalize: finalization.subscribe,
    async start(request: StartRequest): AsyncResult<RunId> {
      const runId = newId<'AgentRun'>();
      const acquired = await acquireEditor(deps, request, runId);
      if (!acquired.ok) return acquired;
      let handedOff = false;
      try {
        const payload = await startPayload(deps, request);
        const log = await RunLog.open(deps.log, runId, now, onLogEvent);
        if (!log.ok) return log;
        const started = await log.value.append([
          'run.started',
          {
            ...payload,
            ...(acquired.value
              ? {
                  editingProjectId: acquired.value,
                  editingTargets: deps.editing?.snapshot(acquired.value).targetItemIds ?? [],
                }
              : {}),
            ...(request.editorContext ? { editingContext: request.editorContext } : {}),
          },
        ]);
        if (!started.ok) return started;
        const run: ActiveRun = { log: log.value, controller: new AbortController() };
        runs.set(runId, run);
        handedOff = true;
        void drive(run);
        return ok(runId);
      } finally {
        if (!handedOff) await deps.editing?.release(runId);
      }
    },

    async run(request: StartRequest): AsyncResult<RunOutcome> {
      const runId = await agent.start(request);
      return runId.ok ? settle(runId.value) : runId;
    },

    wait: settle,

    async answer(runId: RunId, answer: ApprovalAnswer): AsyncResult<RunOutcome> {
      const run = await open(runId);
      if (!run.ok) return run;
      const { log } = run.value;
      const approval = log.state.approvals[answer.requestId];
      if (!approval || approval.status !== 'pending')
        return err(ApprovalUnknown({ requestId: answer.requestId }));
      // A stopped run's open questions stay unanswered: nothing would act on the answer.
      if (isTerminal(log.state)) return err(RunFinished({ runId }));
      // An export whose timeline moved since its card was shown closes as stale instead (SPEC section 13).
      if (answer.decision === 'approve') await watcher?.recheck(log, `approval:${answer.requestId}`);
      const written =
        log.state.approvals[answer.requestId]?.status === 'pending'
          ? await log.append(...(await answerEvents(log.state, approval, answer, consents, now())))
          : ok(undefined);
      if (!written.ok) return written;
      if (log.state.status !== 'paused' || pendingApprovals(log.state).length > 0)
        return ok(outcome(log.state));
      return continueRun(run.value, 'approval');
    },

    async cancel(runId: RunId): AsyncResult<RunOutcome> {
      deps.editing?.stop(runId);
      const run = await open(runId);
      if (!run.ok) return run;
      if (run.value.drive) {
        run.value.controller.abort();
        await run.value.drive;
        // An awaited action may have paused after Stop. Close that state too before releasing ownership.
      }
      if (isTerminal(run.value.log.state)) {
        const finalized = await finalization.finish(runId);
        return finalized.ok ? ok(outcome(run.value.log.state)) : finalized;
      }
      const written = await run.value.log.append(...closeOpen(run.value.log.state), ['run.cancelled', {}]);
      if (!written.ok) return written;
      const finalized = await finalization.finish(runId);
      await recorder?.flush(runId);
      return finalized.ok ? ok(outcome(run.value.log.state)) : finalized;
    },

    async resume(runId: RunId): AsyncResult<RunOutcome> {
      const run = await open(runId);
      if (!run.ok) return run;
      const state = run.value.log.state;
      if (isExternalRun(run.value.log)) return ok(outcome(state));
      if (run.value.drive) return settle(runId);
      if (isTerminal(state)) return err(RunFinished({ runId }));
      if (state.status === 'running') return continueRun(run.value, 'crash');
      if (pendingApprovals(state).length > 0) return ok(outcome(state));
      return continueRun(run.value, 'approval');
    },

    async recoverInterrupted(): AsyncResult<RunId[]> {
      const ids = await deps.log.openRuns();
      if (!ids.ok) return ids;
      const resumed: RunId[] = [];
      for (const runId of ids.value) {
        if (runs.get(runId)?.drive) continue;
        const run = await open(runId);
        if (!run.ok || isExternalRun(run.value.log)) continue;
        const state = run.value.log.state;
        if (state.status === 'paused' && pendingApprovals(state).length > 0) continue;
        const project = state.started?.editingProjectId;
        if (project && deps.editing) {
          const acquired = await deps.editing.acquire(project as ProjectId, runId);
          if (!acquired.ok) continue;
        }
        const appended = await run.value.log.append(
          ...resumeEvents(state, state.status === 'running' ? 'crash' : 'approval'),
        );
        if (!appended.ok) continue;
        void drive(run.value);
        resumed.push(runId);
      }
      return ok(resumed);
    },

    replay: (runId: RunId) => replayRun(deps, runId, createAgent),

    async trace(runId: RunId) {
      const events = await deps.log.read(runId);
      return events.ok ? ok(buildTrace(runId, events.value)) : events;
    },

    events: (runId: RunId) => deps.log.read(runId),

    subscribe(listener: (event: AgentFeedEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    noteCommand: (change: Parameters<Agent['noteCommand']>[0]) =>
      watcher?.noteCommand(change) ?? Promise.resolve(),

    async sweepAbandonedFlows(): AsyncResult<RunId[]> {
      const ids = await deps.log.openRuns();
      if (!ids.ok) return ids;
      const swept: RunId[] = [];
      const after = deps.flows?.abandonedAfterMs ?? DAY_MS;
      for (const runId of ids.value) {
        if (runs.get(runId)?.drive) continue;
        const run = await open(runId);
        if (!run.ok) continue;
        const state = run.value.log.state;
        if (!state.flow || state.flowAbandoned || now() - state.lastAt < after) continue;
        const logged = await run.value.log.append(['flow.abandoned', { flowId: state.flow.flowId }]);
        if (!logged.ok) continue;
        emitCostRecorded({ phase2 }, run.value.log.state, 'abandoned');
        swept.push(runId);
      }
      return ok(swept);
    },

    // P3-V4: what the external runner (MCP) builds on: this agent's run logs, feed and dependencies.
    external: () =>
      (externalHost ??= createExternalHost({
        deps,
        runs,
        open,
        onLogEvent,
        consents,
        phase2,
        now,
        subscribe: agent.subscribe,
      })),

    close: () => watcher?.close(),
  };
  let externalHost: ExternalRunHost | undefined;
  return agent;
}
