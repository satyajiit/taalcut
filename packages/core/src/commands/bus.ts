// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The command bus: validate → run the handler → append to the audit log →
 * acknowledge. Commands for one project run one at a time, in order; undo and
 * redo stacks are per project and rebuilt from the log on first use. A
 * dispatch with an idempotency key also holds that key, whatever the project,
 * so a key runs its handler once. Types are in bus-types.ts, stateless helpers
 * in bus-parts.ts.
 */
import { ConflictError, type TaalcutError } from '../basics/errors';
import { newId, type ProjectId, type RunId } from '../basics/ids';
import { err, ok, type AsyncResult, type Result } from '../basics/result';
import type { NewAuditEntry } from './audit-log';
import { keyOf, parse, refuseSource, replay, run, unrecorded } from './bus-parts';
import {
  CommandRollbackFailed,
  InternalCommand,
  type CommandBus,
  type CommandBusDeps,
  type CommandListener,
  type DispatchReceipt,
  type HistoryReceipt,
  type HistoryStepOptions,
} from './bus-types';
import {
  USER_FACING_SOURCES,
  type AnyCommand,
  type CommandContext,
  type CommandInvocation,
  type CommandOrigin,
  type DispatchOptions,
} from './definition';
import { createKeyedQueue } from '../basics/serial-queue';
import { ProjectHistory, type HistoryItem } from './history';
import { createEditingOwnership } from './editing-ownership';
import { createCommandRegistry } from './command-registry';
import { HISTORY_COMMANDS, dispatchHistory } from './history-commands';
import { admitLifecycle } from './lifecycle-admission';

export function createCommandBus({ store, clock, maxHistory = 200 }: CommandBusDeps): CommandBus {
  const registry = createCommandRegistry();
  const lookup = registry.lookup;
  const histories = new Map<string, ProjectHistory>();
  const listeners = new Set<CommandListener>();
  /** Per project: dispatch, undo, redo and history() run one at a time. */
  const queue = createKeyedQueue();
  /** Per idempotency key, across projects: the second dispatch waits, then replays the first. */
  const keys = createKeyedQueue();
  const editing = createEditingOwnership(async () => {
    await Promise.all([queue.settled(), keys.settled()]);
  });
  const admit = (command: AnyCommand, payload: unknown, origin: CommandOrigin) => {
    const project = command.project(payload);
    return command.sideEffect === 'read'
      ? ok(undefined)
      : editing.check(
          [...(project ? [project] : []), ...(command.affectedProjects?.(payload) ?? [])],
          origin,
        );
  };
  /** Projects whose undo and redo are off until restart: a rollback failed, so state and log may disagree. */
  const frozen = new Set<string>();

  /**
   * Rebuilds a project's stacks from the log. Rows without an inverse don't count toward the window, so
   * this reads further back (doubling) until it has `maxHistory` undoable rows, the start of the log, or
   * all the store will return in one page.
   */
  const loadHistory = async (projectId: ProjectId | null): AsyncResult<ProjectHistory> => {
    let read = -1;
    for (let limit = Math.max(1, maxHistory * 2); ; limit *= 2) {
      const entries = await store.listByProject(projectId, { limit });
      if (!entries.ok) return entries;
      const undoable = entries.value.filter((entry) => !entry.undone && entry.inverse).length;
      if (undoable >= maxHistory || entries.value.length < limit || entries.value.length <= read) {
        return ok(ProjectHistory.fromEntries(entries.value, maxHistory));
      }
      read = entries.value.length;
    }
  };

  /** Runs on the project's queue. A history cached while the log was being read wins over the read. */
  const historyOf = async (projectId: ProjectId | null): AsyncResult<ProjectHistory> => {
    const key = keyOf(projectId);
    const cached = histories.get(key);
    if (cached) return ok(cached);
    const loaded = await loadHistory(projectId);
    if (!loaded.ok) return loaded;
    const newer = histories.get(key);
    if (newer) return ok(newer);
    histories.set(key, loaded.value);
    return loaded;
  };

  /** A failed rollback leaves the project's state unknown: undo and redo stop rather than apply twice. */
  const freezeOnRollbackFailure = <T>(projectId: ProjectId | null, result: Result<T>): Result<T> => {
    if (!result.ok && CommandRollbackFailed.is(result.error)) frozen.add(keyOf(projectId));
    return result;
  };

  /** Runs an invocation to put state back after the store failed. */
  const rollback = async (
    failure: TaalcutError,
    invocation: CommandInvocation | null,
    context: CommandContext,
  ): AsyncResult<never> => {
    if (!invocation) return err(failure);
    const command = lookup(invocation.name);
    const payload = command.ok ? parse(command.value, invocation.payload) : command;
    const undone = command.ok && payload.ok ? await run(command.value, payload.value, context) : payload;
    // A rollback is never recorded: the refused step's writes never committed, so its own have nothing to undo.
    store.discard?.(context);
    if (undone.ok) return err(failure);
    return err(
      CommandRollbackFailed(undefined, { detail: `${failure.code}; rollback: ${undone.error.code}` }),
    );
  };

  const notify: CommandListener = (change) => {
    for (const listener of listeners) listener(change);
  };

  /**
   * The store refused the entry: put state back. If the key was committed meanwhile (another bus on
   * the same store), that commit is the command's result: replay it rather than report a failure.
   */
  const appendFailed = async (
    failure: TaalcutError,
    command: AnyCommand,
    inverse: CommandInvocation | null,
    context: CommandContext,
    idempotencyKey: string | undefined,
  ): AsyncResult<DispatchReceipt> => {
    const rolledBack = freezeOnRollbackFailure(context.projectId, await rollback(failure, inverse, context));
    if (!idempotencyKey || (!rolledBack.ok && CommandRollbackFailed.is(rolledBack.error))) return rolledBack;
    const winner = await store.findByIdempotencyKey(idempotencyKey);
    return winner.ok && winner.value ? replay(command, winner.value, idempotencyKey) : rolledBack;
  };

  function execute(
    command: AnyCommand,
    payload: unknown,
    origin: CommandOrigin,
    { idempotencyKey, group }: DispatchOptions,
  ): AsyncResult<DispatchReceipt> {
    const parsed = parse(command, payload);
    if (!parsed.ok) return Promise.resolve(parsed);
    const allowed = admit(command, parsed.value, origin);
    if (!allowed.ok) return Promise.resolve(allowed);
    const projectId = command.project(parsed.value);
    const audited = command.sideEffect !== 'read';
    const task = () =>
      perform(command, parsed.value, projectId, origin, audited ? idempotencyKey : undefined, group);
    // Key first, then project: nothing on a project queue waits for a key, so this order can't deadlock.
    return audited && idempotencyKey ? keys.run(idempotencyKey, task) : task();
  }

  function perform(
    command: AnyCommand,
    payload: unknown,
    projectId: ProjectId | null,
    origin: CommandOrigin,
    idempotencyKey: string | undefined,
    group: string | undefined,
    lifecycleRun?: RunId,
  ): AsyncResult<DispatchReceipt> {
    return queue.run(keyOf(projectId), async () => {
      const allowed = lifecycleRun
        ? admitLifecycle(editing, command, payload, lifecycleRun)
        : admit(command, payload, origin);
      if (!allowed.ok) return allowed;
      if (idempotencyKey) {
        const earlier = await store.findByIdempotencyKey(idempotencyKey);
        if (!earlier.ok) return earlier;
        if (earlier.value) return replay(command, earlier.value, idempotencyKey);
      }
      const history = await historyOf(projectId);
      if (!history.ok) return history;
      const context: CommandContext = { ...origin, commandId: newId<'Command'>(), projectId };
      const outcome = await run(command, payload, context);
      // Not recorded, so nothing the handler staged may wait for an append that never comes.
      if (!outcome.ok) return unrecorded(store, context, outcome);
      const { result } = outcome.value;
      const inverse = outcome.value.inverse ?? null;
      const receipt = { id: context.commandId, name: command.name, projectId, result, deduplicated: false };
      if (command.sideEffect === 'read')
        return unrecorded(store, context, ok({ ...receipt, sequence: null, undoable: false }));

      const storedPayload =
        outcome.value.replayPayload === undefined ? ok(payload) : parse(command, outcome.value.replayPayload);
      if (!storedPayload.ok)
        return appendFailed(storedPayload.error, command, inverse, context, idempotencyKey);
      const entry: NewAuditEntry = {
        id: context.commandId,
        projectId,
        name: command.name,
        payload: storedPayload.value,
        inverse,
        source: origin.source,
        actor: origin.actor,
        sideEffect: command.sideEffect,
        createdAt: clock.now(),
        idempotencyKey: idempotencyKey ?? null,
        result,
        ...(group !== undefined ? { group } : {}),
      };
      // Commit before acknowledge: nothing resolves until the store says the entry is durable.
      const stored = await store.append(entry);
      if (!stored.ok) return appendFailed(stored.error, command, inverse, context, idempotencyKey);
      history.value.executed(stored.value);
      editing.committed(origin, result);
      notify({ kind: 'executed', id: entry.id, name: entry.name, projectId, origin });
      return ok({ ...receipt, sequence: stored.value.sequence, undoable: inverse !== null });
    });
  }

  /** Undoes or redoes one history item; on the project's queue. */
  async function stepItem(
    direction: 'undo' | 'redo',
    item: HistoryItem,
    history: ProjectHistory,
    projectId: ProjectId | null,
    origin: CommandOrigin,
  ): AsyncResult<HistoryReceipt> {
    // Undo runs the stored inverse (only commands with one are on the undo stack); redo runs the original.
    const invocation = direction === 'undo' ? item.inverse! : { name: item.name, payload: item.payload };
    const command = lookup(invocation.name);
    if (!command.ok) return command;
    const allowed = refuseSource(command.value, origin);
    if (!allowed.ok) return allowed;
    const payload = parse(command.value, invocation.payload);
    if (!payload.ok) return payload;
    // A rollback runs as a plain execution: only the re-run original is a replay.
    const plain: CommandContext = { ...origin, commandId: item.id, projectId };
    const context: CommandContext = direction === 'redo' ? { ...plain, replay: 'redo' } : plain;
    const outcome = await run(command.value, payload.value, context);
    if (!outcome.ok) return unrecorded(store, context, outcome);

    const at = clock.now();
    if (direction === 'undo') {
      const marked = await store.markUndone({ id: item.id, at });
      if (!marked.ok) {
        const original = { name: item.name, payload: item.payload };
        return freezeOnRollbackFailure(projectId, await rollback(marked.error, original, plain));
      }
      history.undone();
    } else {
      const inverse = outcome.value.inverse ?? null;
      const marked = await store.markRedone({ id: item.id, at, inverse });
      if (!marked.ok) return freezeOnRollbackFailure(projectId, await rollback(marked.error, inverse, plain));
      history.redone(inverse);
    }
    const receipt = { id: item.id, name: item.name, projectId };
    notify({ kind: direction === 'undo' ? 'undone' : 'redone', ...receipt, origin });
    const { result } = outcome.value;
    editing.committed(origin, result);
    return ok(result === undefined ? receipt : { ...receipt, result });
  }

  /**
   * One undo or redo: the top command, or its whole group (EDT1). A group stops at its first failure; what it had
   * already taken back stays taken back, each step durable, and the next undo goes on with the rest.
   */
  function step(direction: 'undo' | 'redo') {
    return (
      projectId: ProjectId | null,
      origin: CommandOrigin,
      options: HistoryStepOptions = {},
    ): AsyncResult<HistoryReceipt | null> => {
      const allowed = editing.check(projectId ? [projectId] : [], origin);
      if (!allowed.ok) return Promise.resolve(allowed);
      return queue.run(keyOf(projectId), async () => {
        const admitted = editing.check(projectId ? [projectId] : [], origin);
        if (!admitted.ok) return admitted;
        if (frozen.has(keyOf(projectId))) {
          return err(
            CommandRollbackFailed(undefined, {
              detail: `${direction} is off until restart: a rollback failed`,
            }),
          );
        }
        const history = await historyOf(projectId);
        if (!history.ok) return history;
        if (
          options.expectedHistoryToken !== undefined &&
          history.value.token !== options.expectedHistoryToken
        )
          return err(ConflictError({ entity: 'history', id: options.expectedHistoryToken }));
        const items = [...(direction === 'undo' ? history.value.undoStep : history.value.redoStep)];
        if (options.expectedCommandId !== undefined && items[0]?.id !== options.expectedCommandId)
          return err(ConflictError({ entity: 'history', id: options.expectedCommandId }));
        if (options.group !== undefined && items[0]?.group !== options.group)
          return err(
            ConflictError(
              { entity: 'commandGroup', id: options.group },
              { detail: `not next to ${direction}` },
            ),
          );
        if (items.length === 0) return ok(null);
        for (const item of items) {
          const invocation = direction === 'undo' ? item.inverse! : item;
          const command = lookup(invocation.name);
          if (!command.ok) return command;
          const allowed = admit(command.value, invocation.payload, origin);
          if (!allowed.ok) return allowed;
        }
        let first: HistoryReceipt | undefined;
        for (const item of items) {
          const done = await stepItem(direction, item, history.value, projectId, origin);
          if (!done.ok) return done;
          first ??= done.value;
        }
        const group = items[0]!.group;
        if (group === null) return ok(first!);
        const { result: _result, ...receipt } = first!;
        return ok({ ...receipt, group, steps: items.length });
      });
    };
  }

  // Both overloads share one implementation; a typed definition is looked up by name like any other.
  const dispatch = (
    commandOrName: AnyCommand | string,
    payload: unknown,
    origin: CommandOrigin,
    options: DispatchOptions = {},
  ) => {
    const name = typeof commandOrName === 'string' ? commandOrName : commandOrName.name;
    if (name === HISTORY_COMMANDS.undo || name === HISTORY_COMMANDS.redo)
      return dispatchHistory(name, payload, origin, step(name === HISTORY_COMMANDS.undo ? 'undo' : 'redo'));
    const command = lookup(name);
    if (!command.ok) return Promise.resolve(command);
    // Undo, redo and rollback run internal commands directly; only a dispatch from a person is refused.
    if (command.value.lifecycle || (command.value.internal && USER_FACING_SOURCES.has(origin.source))) {
      return Promise.resolve(err(InternalCommand({ name: command.value.name })));
    }
    const allowed = refuseSource(command.value, origin);
    if (!allowed.ok) return Promise.resolve(allowed);
    return execute(command.value, payload, origin, options);
  };

  return {
    editing,
    async lifecycle(name, payload, runId) {
      const command = lookup(name);
      if (!command.ok) return command;
      const parsed = parse(command.value, payload);
      if (!parsed.ok) return parsed;
      return perform(
        command.value,
        parsed.value,
        command.value.project(parsed.value),
        { source: 'agent', actor: `agent:${runId}` },
        undefined,
        undefined,
        runId,
      );
    },
    register: registry.register,

    dispatch: dispatch as CommandBus['dispatch'],

    undo: step('undo'),
    redo: step('redo'),

    history(projectId, options = {}) {
      // On the queue: a read racing a dispatch could otherwise cache a stack from before it.
      return queue.run(keyOf(projectId), async () => {
        if (frozen.has(keyOf(projectId))) return ok({ undo: null, redo: null });
        const history = await historyOf(projectId);
        if (!history.ok) return history;
        const { nextUndo, nextRedo } = history.value;
        // The groups only when there are some, so a history without any reads as it did before EDT1.
        return ok({
          undo: nextUndo?.name ?? null,
          ...(options.includeIds
            ? { undoId: nextUndo?.id ?? null, redoId: nextRedo?.id ?? null, token: history.value.token }
            : {}),
          redo: nextRedo?.name ?? null,
          ...(nextUndo?.group ? { undoGroup: nextUndo.group } : {}),
          ...(nextRedo?.group ? { redoGroup: nextRedo.group } : {}),
        });
      });
    },

    list: registry.list,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
