// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The external runner (P3-V4, platform request §24): an MCP session's tool calls as one long-lived run of kind
 * external, with no model loop. Each call runs through the agent's own policy at autonomy 'before-render'
 * (Local only as it is now, budgets, the project cap, upload consent, approvals) plus the session's level;
 * its commands carry the session's origin (`mcp`, `mcp:<sessionId>`), so the audit log and undo name it;
 * its approval cards go to the run's conversation saying which external agent asked. A deferred call waits
 * up to `holdMs` for the person, then answers pending; the same call key later resumes it under the same id.
 */
import { newId, ok, type RunId } from '@taalcut/core';
import { isTerminal } from '../agent-answer';
import type { ExternalRunHost } from '../agent-types';
import type { ConversationStore } from '../ports';
import { callByKey, loggedOutcome, requestCall } from './external-calls';
import { createExternalExecutor, type ProgressListener } from './external-executor';
import { admitCall, executeExternalCall, type ExternalExecution } from './external-execution';
import { closingEvents, externalRunStarted } from './external-lifecycle';
import { callSignal, createExternalRuns, inFlight } from './external-runs';
import type { ExternalRunner } from './external-types';

export interface ExternalRunnerDeps {
  /** The agent's runs and dependencies: `agent.external()`. */
  readonly host: ExternalRunHost;
  /** Where each session's conversation is created and its run linked (the library's ConversationStore). */
  readonly conversations: Pick<ConversationStore, 'create' | 'linkRun'>;
  /** Local only as it is now (Settings); a session outlives a change of it. Default: the run's logged flag. */
  readonly localOnly?: () => boolean;
  /** How often a held call ticks "still waiting for approval". Default 10 s. */
  readonly tickMs?: number;
}

export function createExternalRunner(deps: ExternalRunnerDeps): ExternalRunner {
  const { host } = deps;
  const tools = host.deps.tools;
  const runs = createExternalRuns(host, (runId: RunId) => void runner.close(runId, 'revoked'));
  const progress = new Map<string, ProgressListener>();
  const idempotencyKeys = new Map<string, string>();
  const execution: ExternalExecution = {
    executor: createExternalExecutor({ host, runs, localOnly: deps.localOnly, progress, idempotencyKeys }),
    host,
    progress,
    idempotencyKeys,
    tickMs: deps.tickMs ?? 10_000,
  };

  const runner: ExternalRunner = {
    async open(session) {
      const conversation = await deps.conversations.create({ title: session.name });
      if (!conversation.ok) return conversation;
      const conversationId = conversation.value.id;
      const runId = newId<'AgentRun'>();
      const held = await host.start(runId, externalRunStarted(host, session, conversationId, deps.localOnly));
      if (!held.ok) return held;
      runs.adopt(runId, held.value);
      const linked = await deps.conversations.linkRun(conversationId, runId);
      return linked.ok ? ok({ runId, conversationId }) : linked;
    },

    async call(runId, name, input, options) {
      const attached = await runs.attach(runId);
      if (!attached.ok) return attached;
      const run = attached.value;
      run.requester = options.requester;
      run.origin = options.origin;
      const { log } = run.held;
      const tool = admitCall(log, tools, name, options.level);
      if (!tool.ok) return tool;
      const known = callByKey(log, options.callKey);
      const logged = known && loggedOutcome(known);
      if (logged) return logged;
      const requested = known
        ? ok(known.requested.toolCallId)
        : await requestCall(log, {
            callKey: options.callKey,
            sessionId: run.sessionId,
            name,
            args: input,
            tool: tool.value,
          });
      if (!requested.ok) return requested;
      const call = {
        log,
        toolCallId: requested.value,
        name,
        input,
        options,
        signal: callSignal(run, options),
      };
      return inFlight(run, executeExternalCall(execution, call));
    },

    async close(runId, reason) {
      const run = await runs.find(runId);
      if (!run) return ok(undefined);
      run.closing.abort();
      await Promise.allSettled([...run.inFlight]);
      const { log } = run.held;
      if (!isTerminal(log.state)) {
        const closed = await log.append(...closingEvents(log.state, reason));
        if (!closed.ok) return closed;
      }
      runs.forget(runId);
      run.held.release();
      return ok(undefined);
    },
  };
  return runner;
}
