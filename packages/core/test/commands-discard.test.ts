// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Phase 3 review M1: a store that stages a handler's writes until the audit change commits (the library's unit
 * of work) must hear when the bus won't record a step, or a handler registered without the store's own wrapper
 * leaves its staged writes waiting until they fill the store's cap. The bus calls `discard` for every step it
 * won't record, and only for those.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  defineCommand,
  defineError,
  err,
  idSchema,
  ok,
  unwrap,
  type AuditLogStore,
  type CommandContext,
} from '@taalcut/core';
import { setupBus, UI } from './helpers/bus';

const Refused = defineError('test.refused', { retryable: false });
const StoreDown = defineError('test.store_down', { retryable: true });

const payload = z.object({ projectId: idSchema<'Project'>() });

function setup(options: { failAppend?: boolean; failMarkRedone?: boolean } = {}) {
  const discarded: CommandContext[] = [];
  const seen: CommandContext[] = [];
  const store = (memory: AuditLogStore): AuditLogStore => ({
    ...memory,
    append: async (entry) => (options.failAppend ? err(StoreDown()) : memory.append(entry)),
    markRedone: async (change) => (options.failMarkRedone ? err(StoreDown()) : memory.markRedone(change)),
    discard: (context) => discarded.push(context),
  });
  const world = setupBus({ store });
  const define = (
    name: string,
    handle: (context: CommandContext) => ReturnType<Parameters<typeof defineCommand>[0]['handle']>,
    sideEffect: 'read' | 'write' = 'write',
  ) =>
    defineCommand({
      name,
      payload,
      sideEffect,
      internal: name.startsWith('test.inverse'),
      handle: (_payload, context) => {
        seen.push(context);
        return handle(context);
      },
    });
  return { ...world, discarded, seen, define };
}

describe('command bus: discard for every step it won’t record (M1)', () => {
  it('discards a dispatch whose handler returns an error or throws, and a read', async () => {
    const { bus, projectId, discarded, seen, define } = setup();
    const refused = define('test.refuses', () => err(Refused()));
    const throws = define('test.throws', () => {
      throw new Error('handler bug');
    });
    const reads = define('test.reads', () => ok({ result: 'read' }), 'read');
    bus.register(refused, throws, reads);

    expect((await bus.dispatch(refused, { projectId }, UI)).ok).toBe(false);
    expect((await bus.dispatch(throws, { projectId }, UI)).ok).toBe(false);
    expect(unwrap(await bus.dispatch(reads, { projectId }, UI)).sequence).toBeNull();
    expect(discarded).toEqual(seen);
    expect(discarded).toHaveLength(3);
  });

  it('never discards a step it records', async () => {
    const { bus, projectId, discarded, store, define } = setup();
    const writes = define('test.writes', () => ok({ result: 'done' }));
    bus.register(writes);
    unwrap(await bus.dispatch(writes, { projectId }, UI));
    expect(store.entries()).toHaveLength(1);
    expect(discarded).toEqual([]);
  });

  it('discards an undo whose inverse fails and a redo whose re-run fails', async () => {
    const { bus, projectId, discarded, seen, define } = setup();
    const inverseFails = define('test.inverseFails', () => err(Refused()));
    const inverseOk = define('test.inverseOk', () => ok({ result: null }));
    const undoFails = define('test.undoFails', () =>
      ok({ result: null, inverse: { name: 'test.inverseFails', payload: { projectId } } }),
    );
    const redoFails = define('test.redoFails', (context) =>
      context.replay === 'redo'
        ? err(Refused())
        : ok({ result: null, inverse: { name: 'test.inverseOk', payload: { projectId } } }),
    );
    bus.register(inverseFails, inverseOk, undoFails, redoFails);

    unwrap(await bus.dispatch(undoFails, { projectId }, UI));
    expect((await bus.undo(projectId, UI)).ok).toBe(false);
    expect(discarded).toEqual([seen[1]]);

    unwrap(await bus.dispatch(redoFails, { projectId }, UI));
    unwrap(await bus.undo(projectId, UI));
    expect((await bus.redo(projectId, UI)).ok).toBe(false);
    expect(seen.at(-1)?.replay).toBe('redo');
    expect(discarded).toEqual([seen[1], seen.at(-1)]);
  });

  it('discards the rollback that runs when the store refuses a dispatch', async () => {
    const { bus, projectId, discarded, seen, define } = setup({ failAppend: true });
    const inverse = define('test.inverseUndo', () => ok({ result: null }));
    const forward = define('test.rolledBack', () =>
      ok({ result: null, inverse: { name: 'test.inverseUndo', payload: { projectId } } }),
    );
    bus.register(inverse, forward);
    const refused = await bus.dispatch(forward, { projectId }, UI);
    expect(!refused.ok && StoreDown.is(refused.error)).toBe(true);
    // The rollback ran the inverse with the refused step's context; that run is never recorded either.
    expect(seen.map((context) => context.commandId)).toEqual([seen[0]?.commandId, seen[0]?.commandId]);
    expect(discarded).toEqual([seen[1]]);
  });

  it('discards the rollback of a redo the store refused', async () => {
    const { bus, projectId, discarded, seen, define } = setup({ failMarkRedone: true });
    const inverse = define('test.inverseRedo', () => ok({ result: null }));
    const forward = define('test.redone', () =>
      ok({ result: null, inverse: { name: 'test.inverseRedo', payload: { projectId } } }),
    );
    bus.register(inverse, forward);
    unwrap(await bus.dispatch(forward, { projectId }, UI));
    unwrap(await bus.undo(projectId, UI));
    expect((await bus.redo(projectId, UI)).ok).toBe(false);
    // dispatch, undo, the redo's re-run (recorded until the store refused), then its rollback.
    expect(seen).toHaveLength(4);
    expect(discarded).toEqual([seen[3]]);
    expect(seen[3]?.replay).toBeUndefined();
  });
});
