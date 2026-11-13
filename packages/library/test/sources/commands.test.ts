// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * library.addSource on core's command bus with the real SourceRepository:
 * the button and the agent's tool make the same audit entry; undo removes
 * the source and redo puts back the same one.
 */
import { mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import {
  createCommandBus,
  createMemoryAuditLogStore,
  newId,
  toolModuleProblems,
  unwrap,
  type CommandToolContext,
  type SourceId,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createRepositories, createSourceCommands, folderKey, libraryToolModule } from '../../src/index';
import { openTestDb, tempDir } from '../helpers';

function setup() {
  const root = realpathSync(tempDir());
  const home = join(root, 'home');
  const trip = join(home, 'Desktop', 'Trip');
  const data = join(root, 'app-data');
  mkdirSync(trip, { recursive: true });
  mkdirSync(data);
  const db = openTestDb({ file: false });
  const repos = createRepositories(db);
  const audit = createMemoryAuditLogStore();
  const bus = createCommandBus({ store: audit, clock: { now: () => 1 } });
  const commands = createSourceCommands({
    sources: repos.sources,
    folders: { protectedRoots: [data], home },
    db,
  });
  bus.register(commands.addSource, commands.removeSource);
  // Search and indexing status aren't used by the tools under test here (tools.test.ts covers them).
  const tools = libraryToolModule({
    db,
    search: {} as never,
    importStatus: (async () => undefined) as never,
    home,
  });
  return { root, home, trip, data, repos, audit, bus, commands, tools };
}

type Setup = ReturnType<typeof setup>;

/** Runs the library.addSource tool as the executor would, dispatching through the bus as the agent. */
async function runAddSourceTool(s: Setup, input: { path: string; name?: string }) {
  const tool = s.tools.tools.find((t) => t.name === 'library.addSource')!;
  const runId = newId<'AgentRun'>();
  const key = `${runId}:library.addSource:${tool.idempotencyKey!(input)}`;
  const ctx = toolContext(async (payload) => {
    const receipt = await s.bus.dispatch(
      'library.addSource',
      payload,
      { source: 'agent', actor: `agent:${runId}` },
      { idempotencyKey: key },
    );
    return receipt.ok ? { ok: true as const, value: receipt.value.result } : receipt;
  });
  return { result: await tool.run(input, ctx), runId };
}

function toolContext(dispatch: CommandToolContext['dispatch']): CommandToolContext {
  return {
    signal: new AbortController().signal,
    callId: newId<'ToolRun'>(),
    attempt: 1,
    artifacts: {
      put: async () => ({ ok: false, error: missing() }),
      get: async () => ({ ok: false, error: missing() }),
    },
    reportUsage: () => {},
    reportProgress: () => {},
    dispatch,
  };
}

const missing = () => ({ code: 'core.not_found', messageKey: 'errors.core.not_found', retryable: false });

describe('library.addSource', () => {
  it('makes the same audit entry from the Add folder button and from the agent’s tool', async () => {
    const ui = setup();
    const byButton = unwrap(
      await ui.bus.dispatch(ui.commands.addSource, { path: ui.trip }, { source: 'ui', actor: 'user' }),
    );
    const agent = setup();
    const byTool = await runAddSourceTool(agent, { path: '~/Desktop/Trip/' });
    expect(byTool.result).toMatchObject({
      ok: true,
      value: { name: 'Trip', path: agent.trip, kind: 'watched_folder' },
    });

    const [button] = ui.audit.entries();
    const [tool] = agent.audit.entries();
    // Same command, same payload shape, same inverse; only who did it, when and the ids differ.
    const same = (e: typeof button, home: string) => ({
      name: e!.name,
      payload: JSON.parse(JSON.stringify(e!.payload).replaceAll(home, '<home>')),
      inverse: { name: e!.inverse?.name, payload: { sourceId: '<id>' } },
      sideEffect: e!.sideEffect,
      projectId: e!.projectId,
    });
    expect(same(tool, agent.home)).toEqual(same(button, ui.home));
    expect([button!.source, button!.actor]).toEqual(['ui', 'user']);
    expect([tool!.source, tool!.actor]).toEqual(['agent', `agent:${byTool.runId}`]);
    expect(tool!.idempotencyKey).toMatch(/^.+:library\.addSource:[0-9a-f]{32}$/);
    // The source's id is the id of the command that added it.
    expect(byButton.result).toMatchObject({ id: button!.id });
    expect(button!.inverse).toEqual({ name: 'library.removeSource', payload: { sourceId: button!.id } });
  });

  it('is undone by removing the source, and redone with the same id', async () => {
    const s = setup();
    const added = unwrap(
      await s.bus.dispatch(
        s.commands.addSource,
        { path: s.trip, name: 'Trip 2026' },
        { source: 'ui', actor: 'user' },
      ),
    );
    const id = added.result.id;
    expect(unwrap(s.repos.sources.get(id)).displayName).toBe('Trip 2026');
    expect(unwrap(await s.bus.history(null)).undo).toBe('library.addSource');

    unwrap(await s.bus.undo(null, { source: 'ui', actor: 'user' }));
    expect(s.repos.sources.get(id).ok).toBe(false);
    expect(s.repos.sources.list()).toEqual([]);

    unwrap(await s.bus.redo(null, { source: 'shortcut', actor: 'user' }));
    expect(unwrap(s.repos.sources.get(id))).toMatchObject({ id, displayName: 'Trip 2026', rootPath: s.trip });
    expect(s.audit.entries()).toHaveLength(1);
  });

  it('puts a removed source back under its old id on undo of the removal', async () => {
    const s = setup();
    const id = unwrap(
      await s.bus.dispatch(s.commands.addSource, { path: s.trip }, { source: 'ui', actor: 'user' }),
    ).result.id;
    unwrap(await s.bus.dispatch(s.commands.removeSource, { sourceId: id }, { source: 'ui', actor: 'user' }));
    expect(s.repos.sources.list()).toEqual([]);
    unwrap(await s.bus.undo(null, { source: 'ui', actor: 'user' }));
    expect(unwrap(s.repos.sources.get(id))).toMatchObject({ displayName: 'Trip', rootPath: s.trip });
    // Removing a source that isn't there does nothing, and leaves nothing to undo.
    const gone = await s.bus.dispatch(
      s.commands.removeSource,
      { sourceId: newId<'Source'>() },
      { source: 'ui', actor: 'user' },
    );
    expect(gone.ok && gone.value.undoable).toBe(false);
    expect(s.repos.sources.list()).toHaveLength(1);
  });

  it('refuses a folder already in the library, and a symlink into the app’s data, writing nothing', async () => {
    const s = setup();
    unwrap(await s.bus.dispatch(s.commands.addSource, { path: s.trip }, { source: 'ui', actor: 'user' }));
    const twice = await s.bus.dispatch(
      s.commands.addSource,
      { path: `${s.trip}/` },
      { source: 'ui', actor: 'user' },
    );
    expect(!twice.ok && twice.error.code).toBe('library.conflict');
    expect(!twice.ok && twice.error.params).toEqual({ entity: 'source', name: 'Trip' });

    const link = join(s.trip, 'shortcut');
    symlinkSync(s.data, link);
    const sneaky = await runAddSourceTool(s, { path: '~/Desktop/Trip/shortcut/../shortcut' });
    expect(!sneaky.result.ok && sneaky.result.error.code).toBe('library.folder_not_allowed');
    const traversal = await s.bus.dispatch(
      s.commands.addSource,
      { path: `${s.trip}/../../../app-data` },
      { source: 'ui', actor: 'user' },
    );
    expect(!traversal.ok && traversal.error.code).toBe('library.folder_not_allowed');
    expect(s.repos.sources.list()).toHaveLength(1);
    expect(s.audit.entries()).toHaveLength(1);
  });

  it('keys repeats on the folder, however the path is written', () => {
    expect(folderKey('~/Desktop/Trip/', '/Users/me')).toBe(
      folderKey('/Users/me/Desktop/./Trip', '/Users/me'),
    );
    expect(folderKey('/Users/me/Trip')).not.toBe(folderKey('/Users/me/Trip 2'));
    expect(folderKey('relative/path')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('declares tools that pass core’s registration checks', () => {
    const s = setup();
    expect(toolModuleProblems(s.tools)).toEqual([]);
    const declared = s.tools.tools.map((t) => [t.name, t.sideEffect]);
    expect(declared).toEqual(
      expect.arrayContaining([
        ['library.addSource', 'write'],
        ['library.listSources', 'read'],
        ['library.listFiles', 'read'],
      ]),
    );
    const unknown = s.repos.sources.get(newId<'Source'>() as SourceId);
    expect(unknown.ok).toBe(false);
  });
});
