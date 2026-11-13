// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Command definitions (PRD V2). Every state change, from a button, a shortcut,
 * the agent or (later) an MCP client, is a typed command handled in one place.
 * See packages/core/SPEC.md, "Command bus".
 */
import { z } from 'zod';
import type { ProjectId, CommandId, RunId } from '../basics/ids';
import type { AsyncResult, Result } from '../basics/result';

export const SIDE_EFFECTS = ['read', 'write', 'destructive', 'external'] as const;
/** read: changes nothing (not audited). write: undoable change. destructive: loses data. external: leaves the machine. */
export type SideEffect = (typeof SIDE_EFFECTS)[number];

export const COMMAND_SOURCES = ['ui', 'shortcut', 'agent', 'mcp'] as const;
export type CommandSource = (typeof COMMAND_SOURCES)[number];
/** Sources a person picks commands from (menus, ⌘K, shortcuts, an MCP client): `internal` commands refuse them. */
export const USER_FACING_SOURCES: ReadonlySet<CommandSource> = new Set(['ui', 'shortcut', 'mcp']);
/**
 * The sources that are certainly a person at this Mac. A command declared with `sources: PERSON_SOURCES`
 * (raising a budget, privacy switches) refuses the agent and MCP clients.
 */
export const PERSON_SOURCES = ['ui', 'shortcut'] as const satisfies readonly CommandSource[];

/**
 * A key binding as the renderer writes it: lowercase, '+'-joined modifiers then
 * one key, `mod` meaning ⌘ on macOS and Ctrl elsewhere ('mod+k', 'mod+shift+z', 'mod+,').
 */
const SHORTCUT_PATTERN =
  /^(?:(?:mod|ctrl|alt|shift)\+)*(?:[a-z0-9]|[,./;'[\]\\=`-]|f(?:[1-9]|1\d|2[0-4])|enter|escape|space|tab|backspace|delete|up|down|left|right)$/;
export const shortcutSchema = z.string().regex(SHORTCUT_PATTERN);

/** Whose keyboard a binding is for: a Mac's, or a PC's (Linux and Windows), where `mod` is Ctrl. */
export type Keyboard = 'mac' | 'pc';

/** A command's binding on this keyboard: its `pcShortcut` on a PC when it has one, otherwise its `shortcut`. */
export function shortcutOn(
  command: { readonly shortcut?: string | undefined; readonly pcShortcut?: string | undefined },
  keyboard: Keyboard,
): string | undefined {
  return keyboard === 'pc' ? (command.pcShortcut ?? command.shortcut) : command.shortcut;
}

/** Who dispatched a command. */
export interface CommandOrigin {
  readonly source: CommandSource;
  /** 'user', 'agent:<runId>' or 'mcp:<client>'. */
  readonly actor: string;
}

export interface DispatchOptions {
  /**
   * What makes two dispatches the same action (an agent tool's idempotency
   * key, a double-clicked button). A key already in the audit log returns the
   * original receipt instead of running the command again.
   */
  readonly idempotencyKey?: string;
  /**
   * EDT1: the step of history this command joins. Commands with one group that follow each other in a project's
   * history undo and redo together, as one step: the agent gives every command of one turn its turn's group.
   */
  readonly group?: CommandGroup;
}

/** A history step's id (DispatchOptions.group): the agent's is its turn's (agentTurnGroup). */
export type CommandGroup = string;
export const commandGroupSchema = z.string().min(1).max(200);

export const AGENT_TURN_GROUP_PREFIX = 'turn:';
/** The group of every command one agent run (one turn: the answer to one message) dispatches. */
export const agentTurnGroup = (runId: RunId): CommandGroup => `${AGENT_TURN_GROUP_PREFIX}${runId}`;

/** A command by name with its payload: how inverses are stored in the audit log. */
export interface CommandInvocation {
  readonly name: string;
  readonly payload: unknown;
}

/** How a handler is being run when it isn't a fresh dispatch (round P3-3). */
export const COMMAND_REPLAYS = ['redo'] as const;
export type CommandReplay = (typeof COMMAND_REPLAYS)[number];

export interface CommandContext extends CommandOrigin {
  /** The audit-log id of this execution (the original command's id during undo and redo). */
  readonly commandId: CommandId;
  readonly projectId: ProjectId | null;
  /**
   * 'redo' when the bus runs the original payload again (also after a restart, from the log). The payload's
   * preconditions (its `revision`) held when it first ran, and undo put that state back, only at a newer
   * revision, so a handler may skip its stale-revision check. Any audited command in the same history clears
   * the redo stack first; app-wide commands that write into a project (`batch.applyStyle`) don't, so check
   * what you still rely on. Absent on a dispatch, on undo and on a rollback.
   */
  readonly replay?: CommandReplay;
}

export interface CommandOutcome<R> {
  /** Validated payload to replay after undo, e.g. a fingerprint of the original source for a copy. */
  readonly replayPayload?: unknown;
  readonly result: R;
  /**
   * The command that reverses this one, computed from the state before the
   * change (e.g. rename back to the old name). Omit it and the command can't be
   * undone.
   */
  readonly inverse?: CommandInvocation;
}

export type CommandHandler<P, R> = (
  payload: P,
  context: CommandContext,
) => AsyncResult<CommandOutcome<R>> | Result<CommandOutcome<R>>;

export interface CommandDefinition<N extends string = string, S extends z.ZodType = z.ZodType, R = unknown> {
  /** '<domain>.<camelCase>', e.g. 'project.rename', 'timeline.swapClip'. */
  readonly name: N;
  /** Validates every dispatch, whatever its source. Its output is what the handler gets and the log stores (JSON). */
  readonly payload: S;
  readonly sideEffect: SideEffect;
  /** i18n key for menus and the ⌘K palette. Default 'commands.<name>'. */
  readonly labelKey: string;
  /** The key binding menus and ⌘K show, e.g. 'mod+shift+z'. */
  readonly shortcut?: string;
  /**
   * The binding on a PC (Linux, Windows) where `shortcut`'s would clash there: ⌃⌘S is Ctrl+S on a PC, which is
   * Save. Absent: `shortcut` on every OS (shortcutOn).
   */
  readonly pcShortcut?: string;
  /**
   * Not for people: an inverse that only undo and redo run (e.g. `models.restore`). ⌘K hides it, and the
   * bus refuses it from user-facing sources (`internal_command`).
   */
  readonly internal: boolean;
  /** The project whose history this command joins; null for app-wide commands (theme, settings). */
  readonly project: (payload: z.output<S>) => ProjectId | null;
  /** Additional projects mutated by an app-wide batch; checked atomically by command admission. */
  /** Only the server lifecycle dispatcher may invoke this cleanup; never tools or renderer IPC. */
  readonly lifecycle?: true;
  readonly affectedProjects?: (payload: z.output<S>) => readonly ProjectId[];
  /**
   * Who may dispatch it (e.g. PERSON_SOURCES). Absent: every source. The bus refuses any other source
   * with `core.command_source_refused`, also for undo and redo of it.
   */
  readonly sources?: readonly CommandSource[];
  readonly handle: CommandHandler<z.output<S>, R>;
}

export type AnyCommand = CommandDefinition<string, z.ZodType, unknown>;
export type CommandPayload<C extends AnyCommand> = z.input<C['payload']>;
export type CommandResult<C> = C extends CommandDefinition<string, z.ZodType, infer R> ? R : never;

const NAME_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;
export const commandNameSchema = z.string().regex(NAME_PATTERN);

/** By default a command belongs to `payload.projectId` when there is one. */
function projectFromPayload(payload: unknown): ProjectId | null {
  const projectId = (payload as { projectId?: unknown } | null)?.projectId;
  return typeof projectId === 'string' ? (projectId as ProjectId) : null;
}

export function defineCommand<N extends string, S extends z.ZodType, R>(spec: {
  readonly name: N;
  readonly payload: S;
  readonly sideEffect: SideEffect;
  readonly labelKey?: string;
  readonly shortcut?: string;
  readonly pcShortcut?: string;
  readonly internal?: boolean;
  readonly project?: (payload: z.output<S>) => ProjectId | null;
  /** Only the server lifecycle dispatcher may invoke this cleanup; never tools or renderer IPC. */
  readonly lifecycle?: true;
  readonly affectedProjects?: (payload: z.output<S>) => readonly ProjectId[];
  readonly sources?: readonly CommandSource[];
  readonly handle: CommandHandler<z.output<S>, R>;
}): CommandDefinition<N, S, R> {
  if (!NAME_PATTERN.test(spec.name))
    throw new Error(`Invalid command name '${spec.name}': use '<domain>.<camelCase>'.`);
  if (spec.shortcut !== undefined && !SHORTCUT_PATTERN.test(spec.shortcut))
    throw new Error(`Invalid shortcut '${spec.shortcut}' for ${spec.name}: use e.g. 'mod+shift+z'.`);
  if (
    spec.pcShortcut !== undefined &&
    (spec.shortcut === undefined || !SHORTCUT_PATTERN.test(spec.pcShortcut))
  )
    throw new Error(
      `Invalid PC shortcut '${spec.pcShortcut}' for ${spec.name}: it replaces a shortcut on a PC.`,
    );
  if (spec.internal && spec.shortcut !== undefined)
    throw new Error(`Command ${spec.name} is internal: it can't have a shortcut.`);
  if (spec.sources !== undefined && spec.sources.length === 0)
    throw new Error(`Command ${spec.name} accepts no source: leave 'sources' out to accept every source.`);
  return {
    name: spec.name,
    payload: spec.payload,
    sideEffect: spec.sideEffect,
    labelKey: spec.labelKey ?? `commands.${spec.name}`,
    ...(spec.shortcut !== undefined ? { shortcut: spec.shortcut } : {}),
    ...(spec.pcShortcut !== undefined ? { pcShortcut: spec.pcShortcut } : {}),
    internal: spec.lifecycle || spec.internal || false,
    ...(spec.lifecycle ? { lifecycle: true as const } : {}),
    project: spec.project ?? projectFromPayload,
    ...(spec.affectedProjects ? { affectedProjects: spec.affectedProjects } : {}),
    ...(spec.sources !== undefined ? { sources: [...spec.sources] } : {}),
    handle: spec.handle,
  };
}
