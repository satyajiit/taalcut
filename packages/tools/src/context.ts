// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Builds the ToolContext a tool's run() receives: its signal, artifact store,
 * usage and progress reporting, the call's idempotency key, and, for tools
 * that wrap a command, a dispatch bound to that one command.
 */
import {
  err,
  type AnyTool,
  type ArtifactStore,
  type RunId,
  type ToolContextBase,
  type ToolCostEstimate,
  type ToolEditorContext,
  type ToolRunId,
  type ToolUsage,
} from '@taalcut/core';
import { ToolServiceUnavailable } from './errors';
import type { ToolCallOrigin, ToolCommandBus, ToolDispatchMeta, ToolEvent, ToolUsageTotal } from './ports';

export const ZERO_USAGE: ToolUsageTotal = { usd: 0, inputTokens: 0, outputTokens: 0 };

const UNAVAILABLE_ARTIFACTS: ArtifactStore = {
  put: async () => err(ToolServiceUnavailable({ service: 'artifacts' })),
  get: async () => err(ToolServiceUnavailable({ service: 'artifacts' })),
};

export interface ContextArgs {
  readonly spec: AnyTool;
  readonly callId: ToolRunId;
  readonly runId?: RunId;
  readonly signal: AbortSignal;
  readonly attempt: number;
  readonly estimate?: ToolCostEstimate;
  /** Collects every usage report across attempts: money spent on a failed attempt is still spent. */
  readonly usages: ToolUsage[];
  readonly idempotencyKey?: string;
  readonly artifacts?: ArtifactStore;
  readonly commands?: ToolCommandBus;
  /** Default: the built-in agent. */
  readonly origin?: ToolCallOrigin;
  /** EDT1-OPS: a docked message's run: what the person pointed at (core ToolContextBase.editor). */
  readonly editor?: ToolEditorContext;
  readonly emit: (event: ToolEvent) => void;
}

/**
 * Core's ToolContextBase has no `idempotencyKey` field yet (asked of the core
 * owner); until it does, keyed tools read it from the context at runtime. An
 * external tool with no command passes it to its service (upload, post) so a
 * repeat after a crash is refused there.
 */
export interface KeyedToolContext extends ToolContextBase {
  readonly idempotencyKey?: string;
}

export function buildToolContext(args: ContextArgs): KeyedToolContext {
  const { spec, callId, runId } = args;
  const base: KeyedToolContext = {
    signal: args.signal,
    callId,
    ...(runId ? { runId } : {}),
    ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
    attempt: args.attempt,
    ...(args.estimate ? { estimate: args.estimate } : {}),
    artifacts: args.artifacts ?? UNAVAILABLE_ARTIFACTS,
    ...(args.editor ? { editor: args.editor } : {}),
    reportUsage: (usage) => {
      args.usages.push(usage);
    },
    reportProgress: (fraction, note) =>
      args.emit({ type: 'tool.progress', callId, fraction: Math.min(1, Math.max(0, fraction)), note }),
  };
  const command = spec.command;
  if (command === undefined) return base;
  const meta: ToolDispatchMeta = {
    source: args.origin?.source ?? 'agent',
    ...(args.origin?.actor ? { actor: args.origin.actor } : {}),
    tool: spec.name,
    callId,
    ...(runId ? { runId } : {}),
    ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
    signal: args.signal,
  };
  const commands = args.commands;
  const dispatch = (payload: unknown) =>
    commands
      ? commands.dispatch(command, payload, meta)
      : Promise.resolve(err(ToolServiceUnavailable({ service: 'commands' })));
  // A CommandToolContext; typed as the base because AnyTool's run() accepts either.
  return { ...base, dispatch } as KeyedToolContext;
}

export function sumUsage(usages: readonly ToolUsage[]): ToolUsageTotal {
  return usages.reduce<ToolUsageTotal>(
    (total, u) => ({
      usd: total.usd + (u.usd ?? 0),
      inputTokens: total.inputTokens + (u.inputTokens ?? 0),
      outputTokens: total.outputTokens + (u.outputTokens ?? 0),
    }),
    ZERO_USAGE,
  );
}
