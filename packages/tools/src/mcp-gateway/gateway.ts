// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The MCP gateway (P3-V4), in the agent process: what the mcp process may ask (the live sessions' bearer hashes
 * and levels, a session's tool list, one call, last-used bookkeeping, its listening status) and what Settings
 * reads. Tools run through the external runner, so MCP and the app share one code path, one audit log and one
 * undo history per project. The MCP_COMMANDS handlers come with it (`commands`), to register on the same bus.
 */
import {
  latestValues,
  MCP_COMMANDS,
  MCP_ENABLED_SETTING,
  MCP_PORT_SETTING,
  ok,
  type AnyCommand,
  type AsyncResult,
  type Clock,
  type CommandBus,
  type McpCallItem,
  type McpServerStatus,
  type McpSessionId,
  type McpState,
  type McpToolDef,
  type Result,
  type SettingsStore,
  type Telemetry,
  type mcpGatewaySessionsSchema,
} from '@taalcut/core';
import type { z } from 'zod';
import type { ToolRegistry } from '../registry';
import { createCallLedger } from './call-ledger';
import { liveSession, runMcpCall, type McpCallInput } from './call-flow';
import { createMcpCommands } from './commands';
import type { McpSessionWrites } from './session-writes';
import { exposedTools } from './exposure';
import type { ExternalRunner } from './external-runner';
import { historyTools, type NativeTool } from './history-tools';
import { levelAllows } from './levels';
import { createMcpSessionStore } from './sessions';
import { mcpState, type McpSwitch } from './state';

/** How long a call waiting for the person is held before it answers "pending" (under Codex's 60 s default). */
export const MCP_APPROVAL_HOLD_MS = 45_000;
/** Progress items at most this often per call. */
export const MCP_PROGRESS_EVERY_MS = 10_000;

export const MCP_INSTRUCTIONS = [
  "Taalcut is the person's video editor on this Mac.",
  'Find their clips with the library_* tools, break a reference video down with templates_breakdown, edit a timeline with the timeline_* tools (taalcut_undo reverses the last change), and render with render_export, which waits until the person approves it in Taalcut.',
  "Before you render a timeline made from a template, list its empty slots with timeline_gaps and fix each one (timeline_fillGap, timeline_dropSlot or timeline_markForFilming): nothing in Taalcut asks the person about your timeline's gaps for you.",
  'Ids (projects, clips, templates, timelines) come from earlier tool results; never make one up.',
].join(' ');

export type McpGatewaySessions = z.output<typeof mcpGatewaySessionsSchema>;

export interface McpGatewayDeps {
  readonly registry: Pick<ToolRegistry, 'catalogue' | 'resolve'>;
  readonly runner: ExternalRunner;
  readonly bus: Pick<CommandBus, 'undo' | 'redo' | 'history' | 'list' | 'subscribe'>;
  readonly settings: SettingsStore;
  readonly clock: Clock;
  readonly holdMs?: number;
  readonly progressEveryMs?: number;
  readonly telemetry?: Telemetry;
  readonly log?: (message: string) => void;
}

export interface McpGateway {
  /** The MCP_COMMANDS handlers: register them on the bus passed in `deps`. */
  readonly commands: AnyCommand[];
  /**
   * Main's alone (mcpSessions, contract round P3-2): a session with its bearer's hash, or a new hash. The sessions
   * reload right after the write, since no command.changed follows.
   */
  readonly sessionWrites: McpSessionWrites;
  /** Reads the sessions and the switch, and follows MCP commands from now on. */
  start(): AsyncResult<void>;
  dispose(): void;
  listTools(sessionId: McpSessionId): Result<{ tools: McpToolDef[]; instructions: string }>;
  call(input: McpCallInput, signal?: AbortSignal): AsyncGenerator<McpCallItem, void, undefined>;
  sessions(signal?: AbortSignal): AsyncGenerator<McpGatewaySessions>;
  touch(sessionId: McpSessionId): Result<void>;
  reportStatus(status: McpServerStatus): void;
  state(): McpState;
  changed(signal?: AbortSignal): AsyncGenerator<McpState>;
}

const MCP_COMMAND_NAMES: ReadonlySet<string> = new Set(Object.values(MCP_COMMANDS));

export function createMcpGateway(deps: McpGatewayDeps): McpGateway {
  const log = deps.log ?? ((message: string) => console.warn(message));
  const store = createMcpSessionStore({ settings: deps.settings, clock: deps.clock, log });
  const ledger = createCallLedger(deps.clock);
  const natives = new Map<string, NativeTool>(historyTools(deps.bus).map((tool) => [tool.def.name, tool]));
  const { commands, writes } = createMcpCommands({
    settings: deps.settings,
    runner: deps.runner,
    sessions: store,
    ledger,
    clock: deps.clock,
    ...(deps.telemetry ? { telemetry: deps.telemetry } : {}),
    log,
  });
  let switched: McpSwitch = { enabled: false, port: MCP_PORT_SETTING.defaultValue };
  let reported: McpServerStatus | undefined;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const offStore = store.onChange(notify);
  const offLedger = ledger.onChange(notify);

  const readSwitch = async (): AsyncResult<void> => {
    const enabled = await deps.settings.get(MCP_ENABLED_SETTING);
    if (!enabled.ok) return enabled;
    const port = await deps.settings.get(MCP_PORT_SETTING);
    if (!port.ok) return port;
    if (enabled.value !== switched.enabled || port.value !== switched.port) reported = undefined;
    switched = { enabled: enabled.value, port: port.value };
    return ok(undefined);
  };
  const reload = async (): AsyncResult<void> => {
    const read = await readSwitch();
    if (!read.ok) return read;
    const loaded = await store.load();
    notify();
    return loaded;
  };
  const reloaded = async (): Promise<void> => {
    const done = await reload();
    if (!done.ok) log(`[mcp] sessions not reloaded: ${done.error.code}`);
  };
  let offBus: (() => void) | undefined;

  const liveHashes = (): McpGatewaySessions => ({
    sessions: store
      .records()
      .filter((record) => {
        const state = store.state(record);
        return state === 'active' || state === 'idle';
      })
      .map((record) => ({
        id: record.id,
        tokenHash: record.tokenHash,
        level: record.level,
        expiresAt: store.expiresAt(record),
      })),
  });
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return {
    commands,
    sessionWrites: {
      add: async (session) => {
        const added = await writes.add(session);
        if (added.ok) await reloaded();
        return added;
      },
      rotate: async (change) => {
        const rotated = await writes.rotate(change);
        if (rotated.ok) await reloaded();
        return rotated;
      },
    },
    async start() {
      offBus ??= deps.bus.subscribe((change) => {
        if (!MCP_COMMAND_NAMES.has(change.name)) return;
        void reload().then((done) => {
          if (!done.ok) log(`[mcp] sessions not re-read: ${done.error.code}`);
        });
      });
      return reload();
    },
    dispose() {
      offBus?.();
      offStore();
      offLedger();
      listeners.clear();
    },
    listTools(sessionId) {
      const session = liveSession(store, sessionId);
      if (!session.ok) return session;
      const level = session.value.level;
      const own = [...natives.values()]
        .filter((tool) => levelAllows(level, tool.needed))
        .map((tool) => tool.def);
      return ok({ tools: [...exposedTools(deps.registry, level), ...own], instructions: MCP_INSTRUCTIONS });
    },
    call: (input, signal) =>
      runMcpCall(
        {
          sessions: store,
          registry: deps.registry,
          runner: deps.runner,
          natives,
          ledger,
          clock: deps.clock,
          holdMs: deps.holdMs ?? MCP_APPROVAL_HOLD_MS,
          progressEveryMs: deps.progressEveryMs ?? MCP_PROGRESS_EVERY_MS,
        },
        input,
        signal,
      ),
    sessions: (signal) =>
      latestValues(liveHashes, (listener) => subscribe(() => listener(liveHashes())), signal),
    touch(sessionId) {
      const session = liveSession(store, sessionId);
      if (!session.ok) return session;
      store.touch(sessionId);
      return ok(undefined);
    },
    reportStatus(status) {
      reported = status;
      notify();
    },
    state: () => mcpState(switched, reported, store, ledger),
    changed(signal) {
      const current = () => mcpState(switched, reported, store, ledger);
      return latestValues(current, (listener) => subscribe(() => listener(current())), signal);
    },
  };
}
