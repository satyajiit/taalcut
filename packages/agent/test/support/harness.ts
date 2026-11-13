// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** An agent wired to scripted models, fixture tools and in-memory ports. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { err, ok, unwrap, type RunId, type ToolModule } from '@taalcut/core';
import {
  createAgent,
  createMemoryEventLogStore,
  createScriptedModelClient,
  parseSoul,
  type AgentDeps,
  type AgentEvent,
  type AgentSettings,
  type AgentUiEvent,
  type CommandDispatcher,
  type EventLogStore,
  type ModelScript,
  type ScriptedReply,
} from '@taalcut/agent';
import type { ChatMessage } from '@taalcut/models';
import { createMemoryArtifactStore, createMemoryToolCache, createToolRegistry } from '@taalcut/tools';
import { clipsModule, type FixtureOptions } from './fixtures';

export const SOUL = parseSoul(
  readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'SOUL.md'), 'utf8'),
);

export interface Dispatched {
  readonly command: string;
  readonly payload: unknown;
  readonly key?: string;
}

/**
 * A command bus stand-in with the idempotency core's bus will have: a command
 * whose idempotency key was already committed is not applied again.
 */
export function recordingCommands(options: { failWith?: string } = {}) {
  const applied: Dispatched[] = [];
  const keys = new Set<string>();
  const commands: CommandDispatcher = {
    async dispatch(command, payload, meta) {
      if (options.failWith)
        return err({ code: options.failWith, messageKey: `errors.${options.failWith}`, retryable: false });
      if (meta.idempotencyKey && keys.has(meta.idempotencyKey)) return ok({ applied: false });
      if (meta.idempotencyKey) keys.add(meta.idempotencyKey);
      applied.push({ command, payload, ...(meta.idempotencyKey ? { key: meta.idempotencyKey } : {}) });
      return ok({ applied: true });
    },
  };
  return { commands, applied };
}

export interface HarnessOptions extends FixtureOptions {
  readonly script: ModelScript;
  readonly modules?: ToolModule[];
  readonly store?: EventLogStore;
  readonly settings?: AgentSettings;
  readonly now?: () => number;
  readonly deps?: Partial<AgentDeps>;
}

export const registryFor = (modules: ToolModule[]) => unwrap(createToolRegistry(modules));

export function harness(options: HarnessOptions) {
  const registry = registryFor(options.modules ?? [clipsModule(options)]);
  const store = options.store ?? createMemoryEventLogStore();
  const models = createScriptedModelClient(options.script);
  const { commands, applied } = recordingCommands();
  const ui: AgentUiEvent[] = [];
  const artifacts = createMemoryArtifactStore();
  const agent = createAgent({
    models,
    tools: registry,
    log: store,
    soul: SOUL,
    commands,
    artifacts,
    toolCache: createMemoryToolCache(),
    sink: { emit: (event) => ui.push(event) },
    settings: { autonomy: 'autopilot', budget: {}, ...options.settings },
    ...(options.now ? { now: options.now } : {}),
    ...options.deps,
  });
  const events = async (runId: RunId): Promise<AgentEvent[]> => unwrap(await store.read(runId));
  return { agent, registry, store, models, applied, ui, artifacts, events };
}

/** A script from a list of replies, one per model turn; the last reply repeats. */
export function turns(...replies: ScriptedReply[]): ModelScript {
  return (_request, turn) => replies[Math.min(turn, replies.length - 1)]!;
}

export const call = (name: string, args: Record<string, unknown> = {}) => ({ name, arguments: args });
export const plan = (...steps: string[]): ScriptedReply => ({
  toolCalls: [call('updatePlan', { steps: steps.map((text) => ({ text })) })],
});

/** The text of a tool message, or '' for any other message. */
export function toolText(message: ChatMessage | undefined): string {
  return message?.role === 'tool' ? String(message.content) : '';
}

export function types(events: readonly AgentEvent[]): string[] {
  return events.map((e) => e.type);
}

export function ofType<T extends AgentEvent['type']>(events: readonly AgentEvent[], type: T) {
  return events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type);
}
