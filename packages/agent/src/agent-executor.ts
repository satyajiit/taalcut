// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The tool executor an agent runs every call through: the registry, the agent's policy (approvals, consent,
 * the project cap), the command bus, artifacts, the result cache and the log-backed idempotency store. Its
 * progress events become the chat's progress cards.
 */
import type { RunId } from '@taalcut/core';
import { createToolExecutor, type ToolExecutor } from '@taalcut/tools';
import type { AgentDeps } from './agent-types';
import type { Phase2Context } from './context';
import { createAgentPolicy } from './policy';
import type { AgentEventSink, ConsentStore } from './ports';
import type { RunLog } from './run-log';
import { createLogIdempotencyStore, toolCommandBus } from './tool-wiring';
import { withCoverDelivery } from './cover-delivery';

export interface AgentExecutorDeps {
  readonly deps: AgentDeps;
  /** The log of a run this agent is driving (or has open). */
  readonly runLog: (runId: RunId | undefined) => RunLog | undefined;
  /** Every run this agent has open, for progress events. */
  readonly openLogs: () => Iterable<RunLog>;
  readonly consents: ConsentStore;
  readonly phase2: Phase2Context;
  readonly idempotencyKeys: Map<string, string>;
  readonly sink: AgentEventSink;
  readonly now: () => number;
}

export function createAgentExecutor(input: AgentExecutorDeps): ToolExecutor {
  const { deps, now, sink } = input;
  if (deps.executor) return deps.executor;
  return createToolExecutor({
    registry: deps.tools,
    policy: createAgentPolicy({
      runLog: input.runLog,
      now,
      consents: input.consents,
      costs: input.phase2,
      resolveSpec: (name) => deps.tools.resolve(name)?.spec,
      // HFW1: a tool whose pictures are its upload (workspace.renderOver) asks only where the chain sees them.
      sendsPictures: (name) => deps.tools.resolve(name)?.spec.images !== undefined,
      ...(deps.seesImages ? { seesImages: deps.seesImages } : {}),
      ...(deps.cloudProviders ? { cloudProviders: deps.cloudProviders } : {}),
      ...(deps.scratchRoot ? { scratchRoot: deps.scratchRoot } : {}),
      ...(deps.fileExists ? { fileExists: deps.fileExists } : {}),
      ...(deps.uploadNames ? { uploadNames: deps.uploadNames } : {}),
      ...(deps.phase3?.localOnly ? { localOnly: deps.phase3.localOnly } : {}),
    }),
    ...(deps.commands
      ? { commands: toolCommandBus(withCoverDelivery(deps.commands, input.runLog, now)) }
      : {}),
    ...(deps.artifacts ? { artifacts: deps.artifacts } : {}),
    ...(deps.toolCache ? { cache: deps.toolCache } : {}),
    idempotency: createLogIdempotencyStore((runId) => input.runLog(runId)?.state, input.idempotencyKeys),
    now,
    onEvent: (event) => {
      if (event.type !== 'tool.progress') return;
      for (const log of input.openLogs()) {
        const call = log.state.toolCalls[event.callId];
        if (!call) continue;
        const { fraction, note } = event;
        sink.emit({
          type: 'agent.card',
          card: {
            kind: 'progress',
            runId: log.runId,
            toolCallId: event.callId,
            tool: call.requested.tool,
            fraction,
            ...(note ? { note } : {}),
          },
        });
      }
    },
  });
}
