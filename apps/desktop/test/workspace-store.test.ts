// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-WS in the utility processes (workspace-store.ts), over a real library database: the store is
 * WorkspaceStoreToken with its blobs where core's workspaceBlobPath says, WORKSPACE_COMMANDS go on the bus, the
 * files viewer's namespace (agent-workspace.ts) lists and reads through it and its Restore is a person's undoable
 * command, and only the trusted writer reaches `_taalcut/`.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AuditLogStoreToken,
  ClockToken,
  CommandBusToken,
  createCommandBus,
  createContainer,
  createManualClock,
  newId,
  unwrap,
  WORKSPACE_COMMANDS,
  workspaceBlobPath,
  workspaceFilesOver,
  WorkspaceStoreToken,
  type CommandOrigin,
} from '@taalcut/core';
import { createRepositories, openDatabase } from '@taalcut/library';
import { registerLibraryPorts } from '../src/shared/library-ports';
import { LibraryDatabaseToken } from '../src/shared/tokens';
import { agentWorkspaceRouter } from '../src/utility/roots/agent-workspace';
import { composeRender } from '../src/utility/roots/render-root';
import {
  registerWorkspaceStore,
  workspaceCommands,
  workspaceReservedWriter,
} from '../src/utility/roots/workspace-store';
import { testAgent, testConfig } from './helpers/roots';

const UI: CommandOrigin = { source: 'ui', actor: 'user' };
const TOOL: CommandOrigin = { source: 'agent', actor: 'agent:run' };
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function agentProcess() {
  const userData = mkdtempSync(join(tmpdir(), 'taalcut-workspace-'));
  dirs.push(userData);
  const clock = createManualClock(Date.UTC(2026, 10, 2));
  const db = unwrap(openDatabase({ path: join(userData, 'library.db'), clock: () => clock.now() }));
  const container = createContainer().value(ClockToken, clock).value(LibraryDatabaseToken, db);
  registerLibraryPorts(container);
  container.factory(CommandBusToken, ({ store }) => createCommandBus({ store, clock }), {
    deps: { store: AuditLogStoreToken },
  });
  registerWorkspaceStore(container, { userData });
  const bus = container.resolve(CommandBusToken);
  bus.register(...workspaceCommands(container));
  const projectId = unwrap(createRepositories(db).projects.create({ name: 'Made-up trip' })).id;
  return { container, userData, bus, projectId, close: () => db.close() };
}

describe('the workspace store in the agent process', () => {
  it('keeps blobs where core says, writes through the bus and serves the files viewer', async () => {
    const { container, userData, bus, projectId, close } = agentProcess();
    const store = container.resolve(WorkspaceStoreToken);
    const put = unwrap(await store.putBlob(projectId, new TextEncoder().encode('.card{}')));
    expect(readFileSync(join(userData, workspaceBlobPath(projectId, put.sha256)), 'utf8')).toBe('.card{}');
    const files = [{ path: 'card/style.css', sha256: put.sha256 }];
    unwrap(await bus.dispatch(WORKSPACE_COMMANDS.writeFiles, { projectId, baseRevision: 0, files }, TOOL));
    unwrap(
      await bus.dispatch(
        WORKSPACE_COMMANDS.writeFiles,
        { projectId, baseRevision: 1, files: [{ path: 'card/style.css', delete: true }] },
        TOOL,
      ),
    );

    const viewer = workspaceFilesOver(store);
    const listed = unwrap(await viewer.list({ projectId }));
    expect(listed.head).toBe(2);
    expect(listed.revisions.map((revision) => revision.revision)).toEqual([2, 1]);
    expect(unwrap(await viewer.read({ projectId, sha256: put.sha256 }))).toMatchObject({ text: '.card{}' });
    expect(agentWorkspaceRouter(container)).toBeDefined();

    // The viewer's Restore: a person's command, undone with ⌘Z.
    const restored = unwrap(await bus.dispatch(WORKSPACE_COMMANDS.restore, { projectId, revision: 1 }, UI));
    expect(restored.undoable).toBe(true);
    expect(unwrap(await store.head(projectId))?.files.map((file) => file.path)).toEqual(['card/style.css']);
    unwrap(await bus.undo(projectId, UI));
    expect(unwrap(await store.head(projectId))?.files).toEqual([]);
    close();
  });

  it('lets only the trusted writer put the brief in _taalcut/', async () => {
    const { container, bus, projectId, close } = agentProcess();
    const store = container.resolve(WorkspaceStoreToken);
    const brief = unwrap(await store.putBlob(projectId, new TextEncoder().encode('# Brief')));
    const asTool = await bus.dispatch(
      WORKSPACE_COMMANDS.writeFiles,
      { projectId, baseRevision: 0, files: [{ path: '_taalcut/brief.md', sha256: brief.sha256 }] },
      TOOL,
    );
    expect(asTool.ok ? 'ok' : asTool.error.code).toBe('core.validation');
    const write = workspaceReservedWriter(container)!;
    unwrap(
      await write(projectId, [{ path: '_taalcut/brief.md', data: new TextEncoder().encode('# Brief') }]),
    );
    expect(unwrap(await store.head(projectId))?.files.map((file) => file.path)).toEqual([
      '_taalcut/brief.md',
    ]);
    close();
  });

  it(
    'is in the agent and render roots, with the commands on the agent’s bus',
    { timeout: 60_000 },
    async () => {
      const agent = testAgent(testConfig('agent'));
      try {
        expect(agent.container.has(WorkspaceStoreToken)).toBe(true);
        const names = agent.container
          .resolve(CommandBusToken)
          .list()
          .map((command) => command.name);
        expect(names).toEqual(expect.arrayContaining(Object.values(WORKSPACE_COMMANDS)));
      } finally {
        await agent.container.dispose();
      }
      const render = await composeRender(testConfig('render'), 21);
      try {
        expect(render.container.has(WorkspaceStoreToken)).toBe(true);
        const head = await render.container.resolve(WorkspaceStoreToken).head(newId<'Project'>());
        expect(unwrap(head)).toBeNull();
      } finally {
        await render.container.dispose();
      }
    },
  );

  it('registers nothing where the process has no library', () => {
    const container = createContainer();
    registerWorkspaceStore(container, { userData: '/nowhere' });
    expect(container.has(WorkspaceStoreToken)).toBe(false);
    expect(workspaceCommands(container)).toEqual([]);
    expect(workspaceReservedWriter(container)).toBeUndefined();
    expect(existsSync('/nowhere')).toBe(false);
  });
});
