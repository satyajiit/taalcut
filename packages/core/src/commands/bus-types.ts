// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The command bus's public shape. The implementation is in bus.ts. */
import type { Clock } from '../basics/clock';
import { defineError } from '../basics/errors';
import type { CommandId, ProjectId, RunId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import type { AuditLogStore } from './audit-log';
import type { EditingOwnership } from './editing-ownership';
import type {
  AnyCommand,
  CommandOrigin,
  CommandPayload,
  CommandResult,
  DispatchOptions,
  SideEffect,
} from './definition';

/** The store failed and putting the state back failed too: the project may need recovery (P1-D5). */
export const CommandRollbackFailed = defineError('core.command_rollback_failed');
/** An `internal` command (an inverse only undo and redo run) was dispatched from a menu, ⌘K, a shortcut or MCP. */
export const InternalCommand = defineError<{ name: string }>('core.internal_command');
/**
 * The command doesn't accept this source (its `sources`): only a person may raise what Taalcut may spend
 * or change what leaves the Mac. Undo and redo keep the rule.
 */
export const CommandSourceRefused = defineError<{ name: string; source: string }>(
  'core.command_source_refused',
);

export interface DispatchReceipt<R = unknown> {
  readonly id: CommandId;
  readonly name: string;
  readonly projectId: ProjectId | null;
  /** The audit-log sequence; null for read commands, which aren't audited. */
  readonly sequence: number | null;
  readonly result: R;
  readonly undoable: boolean;
  /** True when the idempotency key was already committed: this is the original receipt and nothing ran. */
  readonly deduplicated: boolean;
}

export interface HistoryReceipt {
  /** The original command that was undone or redone. */
  readonly id: CommandId;
  readonly name: string;
  readonly projectId: ProjectId | null;
  /**
   * What the inverse (undo) or the re-run command (redo) returned, e.g. `batch.restoreStyles`' skipped
   * videos; absent when it returned nothing. Parse it with that command's result schema (round P3-3).
   * A group's step has no result.
   */
  readonly result?: unknown;
  /**
   * EDT1: set when the step was a group (DispatchOptions.group): `id` and `name` are then its first command's (the
   * newest on undo, the oldest on redo), and `steps` how many commands it took back or ran again.
   */
  readonly group?: string;
  readonly steps?: number;
}

export interface HistoryState {
  readonly token?: CommandId;
  readonly undoId?: CommandId | null;
  readonly redoId?: CommandId | null;
  /** Name of the command the next undo reverses ("Undo Rename project"); a group's newest. */
  readonly undo: string | null;
  readonly redo: string | null;
  /** EDT1: the group the next undo takes back whole, when it is one ("Undo the AI's change"). */
  readonly undoGroup?: string | null;
  readonly redoGroup?: string | null;
}

/** EDT1: what an undo or redo must be. */
export interface HistoryStepOptions {
  readonly expectedHistoryToken?: CommandId;
  readonly expectedCommandId?: CommandId;
  /**
   * Run the step only when it is this group, else fail with a conflict: the changes card's "Undo this change"
   * takes back its own turn or nothing, never a later edit.
   */
  readonly group?: string;
}

export interface CommandInfo {
  readonly name: string;
  readonly sideEffect: SideEffect;
  readonly labelKey: string;
  /** Set when the command has a key binding, e.g. 'mod+shift+z'. */
  readonly shortcut?: string;
  /** Set when a PC (Linux, Windows) binds it otherwise (shortcutOn). */
  readonly pcShortcut?: string;
  /** Present (true) for commands people don't pick: ⌘K hides them. */
  readonly internal?: true;
  /**
   * Present (true) when the command's payload schema refuses an empty payload: it needs what its page supplies (a
   * project, a clip, a template), so ⌘K, which runs commands as they are, leaves it to that page.
   */
  readonly needsPayload?: true;
}

/** Called after a command is acknowledged, undone or redone (the event bus listens here). */
export type CommandListener = (change: {
  readonly kind: 'executed' | 'undone' | 'redone';
  readonly id: CommandId;
  readonly name: string;
  readonly projectId: ProjectId | null;
  readonly origin: CommandOrigin;
}) => void;

export interface CommandBus {
  readonly editing: EditingOwnership;
  /** Server-only cleanup for a stopped run; never exposed by IPC or tool adapters. */
  lifecycle(name: string, payload: unknown, runId: RunId): AsyncResult<DispatchReceipt>;
  /** Adds commands. A name registered twice throws (a wiring bug). */
  register(...commands: AnyCommand[]): void;
  /** Typed dispatch by definition. Resolves after the audit entry is durable. */
  dispatch<C extends AnyCommand>(
    command: C,
    payload: CommandPayload<C>,
    origin: CommandOrigin,
    options?: DispatchOptions,
  ): AsyncResult<DispatchReceipt<CommandResult<C>>>;
  /** Dispatch by name, for untyped callers (agent tools, IPC, MCP). The payload is validated the same way. */
  dispatch(
    name: string,
    payload: unknown,
    origin: CommandOrigin,
    options?: DispatchOptions,
  ): AsyncResult<DispatchReceipt>;
  /**
   * Reverses the project's latest undoable command, or its latest group whole. Ok(null) when there is nothing to
   * undo.
   */
  undo(
    projectId: ProjectId | null,
    origin: CommandOrigin,
    options?: HistoryStepOptions,
  ): AsyncResult<HistoryReceipt | null>;
  redo(
    projectId: ProjectId | null,
    origin: CommandOrigin,
    options?: HistoryStepOptions,
  ): AsyncResult<HistoryReceipt | null>;
  history(
    projectId: ProjectId | null,
    options?: { readonly includeIds?: boolean },
  ): AsyncResult<HistoryState>;
  /** Every registered command, by name, for the ⌘K palette (which hides those marked `internal`). */
  list(): CommandInfo[];
  subscribe(listener: CommandListener): () => void;
}

export interface CommandBusDeps {
  readonly store: AuditLogStore;
  readonly clock: Clock;
  /** Undo depth per project. Default 200. */
  readonly maxHistory?: number;
}

export const CommandBusToken = createToken<CommandBus>('core.commandBus');
