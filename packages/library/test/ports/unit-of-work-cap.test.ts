// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Review 2: the unit of work dropped the oldest staged step once 256 were
 * waiting, so a command still on its way to `append` lost its writes while
 * its audit row committed. A waiting step is never dropped now: the bus tells
 * the store about every step it won't record (Phase 3 review M1: timeline,
 * audio and template handlers are registered without `handle()`), and `stage`
 * refuses at the cap.
 */
import {
  createCommandBus,
  defineCommand,
  idSchema,
  newId,
  systemClock,
  unwrap,
  ValidationError,
  err,
  ok,
  type CommandOrigin,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createCommandUnitOfWork,
  createRepositories,
  MAX_PENDING_STEPS,
  UnitOfWorkFull,
} from '../../src/index';
import { renameCommand } from '../fixtures/rename-command';
import { openTestDb } from '../helpers';

const ui: CommandOrigin = { source: 'ui', actor: 'user' };

function setup() {
  const db = openTestDb({ file: false });
  const repos = createRepositories(db);
  const commands = createCommandUnitOfWork(db);
  const bus = createCommandBus({ store: commands.auditLog, clock: systemClock });
  /** Stages a write, then fails: the bus never records it. `wrapped` uses the unit of work's handle(). */
  const failing = (wrapped: boolean) => {
    const handle = async (
      { projectId }: { projectId: string },
      context: Parameters<typeof commands.stage>[0],
    ) => {
      const staged = commands.stage(context, () => repos.projects.rename(projectId as never, 'Never'));
      return staged.ok ? err(ValidationError({ field: 'spam' })) : staged;
    };
    return defineCommand({
      name: wrapped ? 'test.failWrapped' : 'test.failRaw',
      payload: z.object({ projectId: idSchema<'Project'>() }),
      sideEffect: 'write',
      handle: wrapped ? commands.handle(handle) : handle,
    });
  };
  const raw = failing(false);
  const wrapped = failing(true);
  bus.register(raw, wrapped);
  const project = (name: string) => unwrap(repos.projects.create({ name })).id;
  return { db, repos, commands, bus, raw, wrapped, project };
}

describe('command unit of work under load', () => {
  it('keeps a waiting command’s writes while 256 other commands stage and fail', async () => {
    const { repos, commands, bus, raw, project } = setup();
    let release!: () => void;
    const latch = new Promise<void>((resolve) => (release = resolve));
    const slow = defineCommand({
      name: 'test.slowRename',
      payload: z.object({ projectId: idSchema<'Project'>() }),
      sideEffect: 'write',
      handle: async ({ projectId }, context) => {
        const staged = commands.stage(context, () => repos.projects.rename(projectId, 'Renamed'));
        if (!staged.ok) return staged;
        await latch; // still on its way to append
        return ok({ result: { renamed: true } });
      },
    });
    bus.register(slow);
    const victim = project('Victim');
    const pending = bus.dispatch(slow, { projectId: victim }, ui);
    for (let i = 0; i < MAX_PENDING_STEPS; i++) {
      expect((await bus.dispatch(raw, { projectId: project(`p${i}`) }, ui)).ok).toBe(false);
    }
    release();
    expect(unwrap(await pending)).toMatchObject({ sequence: 1, result: { renamed: true } });
    expect(unwrap(repos.projects.get(victim)).name).toBe('Renamed');
  });

  it('refuses to stage past the cap rather than dropping a step', async () => {
    const { repos, commands, bus, project } = setup();
    // 256 steps still on their way to append (staged straight on the unit of work, as a handler does).
    for (let i = 0; i < MAX_PENDING_STEPS; i++) {
      const context = { ...ui, commandId: newId<'Command'>(), projectId: null };
      unwrap(commands.stage(context, () => ok(undefined)));
    }
    const rename = renameCommand(repos, commands);
    bus.register(rename);
    const target = project('Target');
    const refused = await bus.dispatch(rename, { projectId: target, name: 'New' }, ui);
    expect(!refused.ok && UnitOfWorkFull.is(refused.error)).toBe(true);
    expect(unwrap(repos.projects.get(target)).name).toBe('Target');
    expect(unwrap(repos.auditLog.listByProject(target))).toEqual([]);
  });

  it('discards a raw handler’s writes when it fails through the bus (M1)', async () => {
    const { repos, commands, bus, raw, project } = setup();
    // The finding's shape: batch.applyStyle stages one put, then a later put fails the revision check.
    for (let i = 0; i < MAX_PENDING_STEPS * 2; i++)
      expect((await bus.dispatch(raw, { projectId: project(`p${i}`) }, ui)).ok).toBe(false);
    const rename = renameCommand(repos, commands);
    bus.register(rename);
    const target = project('Target');
    unwrap(await bus.dispatch(rename, { projectId: target, name: 'New' }, ui));
    expect(unwrap(repos.projects.get(target)).name).toBe('New');
    expect(unwrap(repos.auditLog.listByProject(target))).toHaveLength(1);
  });

  it('discards what a read command or a failed undo staged (M1)', async () => {
    const { repos, commands, bus, project } = setup();
    const target = project('Target');
    const stagesNever = (context: Parameters<typeof commands.stage>[0]) =>
      commands.stage(context, () => repos.projects.rename(target, 'Never'));
    const reads = defineCommand({
      name: 'test.readStages',
      payload: z.object({ projectId: idSchema<'Project'>() }),
      sideEffect: 'read',
      handle: async (_payload, context) => {
        const staged = stagesNever(context);
        return staged.ok ? ok({ result: null }) : staged;
      },
    });
    const undoFails = defineCommand({
      name: 'test.undoFails',
      payload: z.object({ projectId: idSchema<'Project'>() }),
      sideEffect: 'write',
      internal: true,
      handle: async (_payload, context) => {
        const staged = stagesNever(context);
        return staged.ok ? err(ValidationError({ field: 'undo' })) : staged;
      },
    });
    const rename = renameCommand(repos, commands);
    bus.register(reads, undoFails, rename);
    for (let i = 0; i < MAX_PENDING_STEPS * 2; i++)
      unwrap(await bus.dispatch(reads, { projectId: target }, ui));
    const undoable = defineCommand({
      name: 'test.undoable',
      payload: z.object({ projectId: idSchema<'Project'>() }),
      sideEffect: 'write',
      handle: async ({ projectId }) =>
        ok({ result: null, inverse: { name: 'test.undoFails', payload: { projectId } } }),
    });
    bus.register(undoable);
    for (let i = 0; i < MAX_PENDING_STEPS * 2; i++) {
      const other = project(`u${i}`);
      unwrap(await bus.dispatch(undoable, { projectId: other }, ui));
      expect((await bus.undo(other, ui)).ok).toBe(false);
    }
    unwrap(await bus.dispatch(rename, { projectId: target, name: 'New' }, ui));
    expect(unwrap(repos.projects.get(target)).name).toBe('New');
  });

  it('discards a failed handler’s writes when it is wrapped with handle()', async () => {
    const { repos, commands, bus, wrapped, project } = setup();
    for (let i = 0; i < MAX_PENDING_STEPS * 2; i++)
      await bus.dispatch(wrapped, { projectId: project(`p${i}`) }, ui);
    const rename = renameCommand(repos, commands);
    bus.register(rename);
    const target = project('Target');
    unwrap(await bus.dispatch(rename, { projectId: target, name: 'New' }, ui));
    expect(unwrap(repos.projects.get(target)).name).toBe('New');
    const throwing = defineCommand({
      name: 'test.throws',
      payload: z.object({ projectId: idSchema<'Project'>() }),
      sideEffect: 'write',
      handle: commands.handle(async ({ projectId }, context) => {
        unwrap(commands.stage(context, () => repos.projects.rename(projectId, 'Never')));
        throw new Error('handler bug');
      }),
    });
    bus.register(throwing);
    const thrown = await bus.dispatch(throwing, { projectId: target }, ui);
    expect(!thrown.ok && thrown.error.code).toBe('core.unknown');
    expect(unwrap(repos.projects.get(target)).name).toBe('New');
  });
});
