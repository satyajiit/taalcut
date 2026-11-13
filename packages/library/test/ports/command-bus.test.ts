// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P1-D5: core's command bus over library's unit of work. A command's writes
 * and its audit row commit in one transaction, and so do undo and redo.
 */
import { join } from 'node:path';
import {
  createCommandBus,
  defineCommand,
  defineError,
  err,
  ok,
  systemClock,
  unwrap,
  type CommandOrigin,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createCommandUnitOfWork,
  createRepositories,
  openDatabase,
  withCommandTransaction,
  type LibraryDatabase,
} from '../../src/index';
import { renameCommand, type Around } from '../fixtures/rename-command';
import { openTestDb, tempDir } from '../helpers';

const ui: CommandOrigin = { source: 'ui', actor: 'user' };
const HookFailed = defineError('test.hook_failed');

function setup(db: LibraryDatabase = openTestDb({ file: false }), around?: Around) {
  const repos = createRepositories(db);
  const commands = createCommandUnitOfWork(db);
  const bus = createCommandBus({ store: commands.auditLog, clock: systemClock });
  const rename = renameCommand(repos, commands, around);
  bus.register(rename);
  const project = unwrap(repos.projects.create({ name: 'Trip' }));
  const name = () => unwrap(repos.projects.get(project.id)).name;
  const log = () => unwrap(repos.auditLog.listByProject(project.id));
  return { db, repos, commands, bus, rename, project, name, log };
}

describe('command unit of work', () => {
  it('commits a command’s write with its audit row, and acknowledges after', async () => {
    const { bus, rename, project, name, log } = setup();
    const receipt = unwrap(await bus.dispatch(rename, { projectId: project.id, name: 'Goa' }, ui));
    expect(receipt).toMatchObject({ sequence: 1, undoable: true, result: { name: 'Goa' } });
    expect(name()).toBe('Goa');
    expect(log()).toMatchObject([{ id: receipt.id, name: 'project.rename', result: { name: 'Goa' } }]);
  });

  it('commits undo and redo writes with the audit change', async () => {
    const { bus, rename, project, name, log } = setup();
    unwrap(await bus.dispatch(rename, { projectId: project.id, name: 'Goa' }, ui));
    unwrap(await bus.undo(project.id, ui));
    expect([name(), log()[0]!.undone]).toEqual(['Trip', true]);
    unwrap(await bus.redo(project.id, ui));
    expect([name(), log()[0]!.undone]).toEqual(['Goa', false]);
  });

  it('rolls the audit row back when a staged write fails, and applies nothing for the bus’s rollback', async () => {
    let fail = true;
    const around: Around = (_, phase) => (fail && phase === 'after' ? err(HookFailed()) : undefined);
    const { bus, rename, project, name, log } = setup(undefined, around);
    const failed = await bus.dispatch(rename, { projectId: project.id, name: 'Goa' }, ui);
    expect(!failed.ok && failed.error.code).toBe('test.hook_failed');
    // The rename ran inside the transaction, then rolled back with the audit row.
    expect(name()).toBe('Trip');
    expect(log()).toEqual([]);
    fail = false;
    unwrap(await bus.dispatch(rename, { projectId: project.id, name: 'Pune' }, ui));
    expect([name(), log().length]).toEqual(['Pune', 1]);
  });

  it('applies nothing for a handler that staged a write and then failed', async () => {
    const { bus, repos, commands, project, name, log } = setup();
    const broken = defineCommand({
      name: 'project.renameBroken',
      payload: z.object({ projectId: z.string() }),
      sideEffect: 'write',
      handle: async (_payload, context) => {
        unwrap(commands.stage(context, () => repos.projects.rename(project.id, 'Never')));
        return err(HookFailed());
      },
    });
    bus.register(broken);
    expect((await bus.dispatch(broken, { projectId: project.id }, ui)).ok).toBe(false);
    expect([name(), log()]).toEqual(['Trip', []]);
  });

  it('keeps app-wide commands in the null scope', async () => {
    const { db, bus, repos, commands } = setup();
    const setTheme = defineCommand({
      name: 'settings.setTheme',
      payload: z.object({ theme: z.enum(['light', 'dark']) }),
      sideEffect: 'write',
      handle: async ({ theme }, context) => {
        unwrap(commands.stage(context, () => repos.settings.set('ui.theme', theme)));
        return ok({ result: theme });
      },
    });
    bus.register(setTheme);
    unwrap(await bus.dispatch(setTheme, { theme: 'dark' }, ui));
    expect(repos.settings.all()).toEqual({ 'ui.theme': 'dark' });
    expect(unwrap(repos.auditLog.listByProject(null))).toMatchObject([
      { name: 'settings.setTheme', sequence: 1 },
    ]);
    expect(db.opened.recovery.lastCommands).toEqual([]); // the report is taken at open
  });

  it('returns the original receipt for a repeated idempotency key, across a restart', async () => {
    const path = join(tempDir(), 'library.db');
    const first = setup(unwrap(openDatabase({ path })));
    const projectId = first.project.id;
    const receipt = unwrap(
      await first.bus.dispatch(first.rename, { projectId, name: 'Goa' }, ui, { idempotencyKey: 'press-1' }),
    );
    first.db.close();

    const db = unwrap(openDatabase({ path }));
    const repos = createRepositories(db);
    const commands = createCommandUnitOfWork(db);
    const bus = createCommandBus({ store: commands.auditLog, clock: systemClock });
    const rename = renameCommand(repos, commands);
    bus.register(rename);
    unwrap(repos.projects.rename(projectId, 'Changed since'));
    const again = unwrap(
      await bus.dispatch(rename, { projectId, name: 'Goa' }, ui, { idempotencyKey: 'press-1' }),
    );
    expect(again).toEqual({ ...receipt, deduplicated: true });
    expect(unwrap(repos.projects.get(projectId)).name).toBe('Changed since'); // nothing ran
    db.close();
  });
});

describe('withCommandTransaction', () => {
  it('commits everything or nothing', () => {
    const db = openTestDb({ file: false });
    const repos = createRepositories(db);
    const failed = withCommandTransaction(db, () => {
      unwrap(repos.projects.create({ name: 'Inside' }));
      return err(HookFailed());
    });
    expect(failed.ok).toBe(false);
    const sqlFailure = withCommandTransaction(db, () => {
      unwrap(repos.projects.create({ name: 'Also inside' }));
      db.driver.exec('INSERT INTO projects (id) VALUES (NULL)');
      return ok(undefined);
    });
    expect(sqlFailure.ok).toBe(false);
    expect(repos.projects.list()).toEqual([]);
    unwrap(withCommandTransaction(db, () => repos.projects.create({ name: 'Kept' })));
    expect(repos.projects.list().map((p) => p.name)).toEqual(['Kept']);
  });
});
