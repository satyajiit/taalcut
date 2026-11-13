// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The tool executor external runs (P3-V4) call through: the agent's own policy (budgets, the project cap,
 * upload consent, approvals) with Local only as it is now and approval cards naming the external agent, and
 * a command bus that puts the session's origin (`mcp`, `mcp:<sessionId>`) on every command its tools dispatch.
 */
import type { RunId } from '@taalcut/core';
import { createToolExecutor, type ToolCommandBus, type ToolExecutor, type ToolPolicy } from '@taalcut/tools';
import type { ExternalRunHost } from '../agent-types';
import { createAgentPolicy } from '../policy';
import type { CommandDispatcher } from '../ports';
import { createLogIdempotencyStore } from '../tool-wiring';
import { withLocalOnlyNow, withRequesterCard } from './external-policy';
import type { ExternalRuns } from './external-runs';
import type { ExternalCallOptions } from './external-types';

export type ProgressListener = NonNullable<ExternalCallOptions['onProgress']>;

export interface ExternalExecutorDeps {
  readonly host: ExternalRunHost;
  readonly runs: Pick<ExternalRuns, 'get'>;
  /** Local only as it is now; absent: the run's logged flag. */
  readonly localOnly?: () => boolean;
  /** Each call's progress listener by tool call id, while it runs. */
  readonly progress: ReadonlyMap<string, ProgressListener>;
  /** The idempotency key each call ran under (the executor writes it; the call's outcome logs it). */
  readonly idempotencyKeys: Map<string, string>;
}

export function createExternalExecutor(deps: ExternalExecutorDeps): ToolExecutor {
  const { host, runs } = deps;
  const { commands, artifacts, toolCache } = host.deps;
  return createToolExecutor({
    registry: host.deps.tools,
    policy: externalPolicy(deps),
    ...(commands ? { commands: originBus(commands, (id) => runs.get(id)?.origin) } : {}),
    ...(artifacts ? { artifacts } : {}),
    ...(toolCache ? { cache: toolCache } : {}),
    idempotency: createLogIdempotencyStore((runId) => runs.get(runId)?.held.log.state, deps.idempotencyKeys),
    now: host.now,
    onEvent: (event) => {
      if (event.type === 'tool.progress')
        deps.progress.get(event.callId)?.(event.fraction ?? null, event.note);
    },
  });
}

/** The agent's policy for the runs this runner holds, with Local only now and the requester's cards. */
function externalPolicy({ host, runs, localOnly }: ExternalExecutorDeps): ToolPolicy {
  const { tools, cloudProviders, scratchRoot, fileExists, uploadNames, phase3 } = host.deps;
  const agentPolicy = createAgentPolicy({
    runLog: (runId) => (runId ? runs.get(runId)?.held.log : undefined),
    now: host.now,
    consents: host.consents,
    costs: host.phase2,
    resolveSpec: (name) => withRequesterCard(tools.resolve(name)?.spec, (id) => runs.get(id)?.requester),
    ...(cloudProviders ? { cloudProviders } : {}),
    ...(scratchRoot ? { scratchRoot } : {}),
    ...(fileExists ? { fileExists } : {}),
    ...(uploadNames ? { uploadNames } : {}),
    ...(phase3?.localOnly ? { localOnly: phase3.localOnly } : {}),
  });
  return withLocalOnlyNow(agentPolicy, localOnly, phase3?.localOnly?.onDevice);
}

/** The command bus an external run's tools dispatch through: the session's origin on every command. */
function originBus(
  commands: CommandDispatcher,
  originOf: (runId: RunId) => ExternalCallOptions['origin'] | undefined,
): ToolCommandBus {
  return {
    dispatch(command, payload, meta) {
      const origin = meta.runId ? originOf(meta.runId) : undefined;
      return commands.dispatch(command, payload, {
        source: 'mcp',
        actor: origin?.actor ?? 'mcp',
        toolCallId: meta.callId,
        tool: meta.tool,
        ...(meta.runId ? { runId: meta.runId } : {}),
        ...(meta.idempotencyKey ? { idempotencyKey: meta.idempotencyKey } : {}),
        ...(meta.signal ? { signal: meta.signal } : {}),
      });
    },
  };
}
