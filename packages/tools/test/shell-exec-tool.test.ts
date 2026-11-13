// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `workspace.exec` over HFW1's workspace (AGT2 sbx), with a stand-in runner that edits the folder the way a
 * command would: the head is checked out to work/, what changed comes back as revisions through
 * workspace.writeFiles, and what can't be kept is named. The real confined run is in integration/.
 */
import { link, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { newId, ok, type ProjectId } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { workspaceExecTool } from '../src/shell/exec-tool';
import type { ShellRunResult } from '../src/shell/run-shell';
import type { ShellRunner } from '../src/shell/shell-runner';
import { tempRoot } from './helpers/sandbox';
import { memoryWorkspace, toolContext, type MemoryWorkspace } from './helpers/workspace-store';

let temp: { root: string; cleanup: () => void };
let ws: MemoryWorkspace;
let projectId: ProjectId;
beforeEach(() => {
  temp = tempRoot('taalcut-shell-tools-');
  ws = memoryWorkspace();
  projectId = newId<'Project'>();
});
afterEach(() => temp.cleanup());

const finished: ShellRunResult = {
  exitCode: 0,
  stdout: 'ok',
  stderr: '',
  durationMs: 5,
  stopped: null,
  peakMemoryBytes: 0,
};

/** A runner that runs `act(folder)` instead of a command. */
function runner(act: (folder: string) => Promise<void>, result: Partial<ShellRunResult> = {}): ShellRunner {
  return {
    async run(id) {
      await act(join(temp.root, 'shell', id));
      return ok({ ...finished, ...result });
    },
  };
}

function exec(act: (folder: string) => Promise<void>, result: Partial<ShellRunResult> = {}) {
  const tool = workspaceExecTool({
    store: ws.store,
    root: join(temp.root, 'shell'),
    runner: runner(act, result),
    resolveInput: async () => ok('/nowhere'),
  });
  return tool.run({ projectId, command: 'stand-in' }, toolContext(ws.dispatch));
}

describe('workspace.exec', () => {
  it('checks the head out to work/ and writes what changed back as a revision', async () => {
    await ws.write(projectId, {
      'index.html': '<p>one</p>',
      'old.css': 'a{}',
      '_taalcut/brief.md': '# brief',
    });
    let seen = '';
    const result = await exec(async (folder) => {
      seen = await readFile(join(folder, 'work', 'index.html'), 'utf8');
      await writeFile(join(folder, 'work', 'index.html'), '<p>two</p>');
      await mkdir(join(folder, 'work', 'bubble'));
      await writeFile(join(folder, 'work', 'bubble', 'style.css'), 'b{}');
      await writeFile(join(folder, 'work', 'old.css'), '').then(() => undefined);
      await import('node:fs/promises').then((fs) => fs.rm(join(folder, 'work', 'old.css')));
      // Taalcut's brief is read-only to the model: an edit is never written back.
      await writeFile(join(folder, 'work', '_taalcut', 'brief.md'), 'changed');
      await writeFile(join(folder, 'out', 'final.mp4'), 'video');
    });
    expect(seen).toBe('<p>one</p>');
    expect(result.ok && result.value.revision).toBe(2);
    expect(result.ok && result.value.changed).toEqual([
      { path: 'bubble/style.css', change: 'added' },
      { path: 'index.html', change: 'changed' },
      { path: 'old.css', change: 'deleted' },
    ]);
    expect(result.ok && result.value.outputs).toEqual([{ path: 'out/final.mp4', bytes: 5 }]);
    expect(await ws.text(projectId, 'index.html')).toBe('<p>two</p>');
    expect(await ws.text(projectId, 'old.css')).toBeUndefined();
    expect(await ws.text(projectId, '_taalcut/brief.md')).toBe('# brief');
  });

  it("names what it can't keep: media, links, hidden and unsafe names, hard links", async () => {
    await ws.write(projectId, { 'index.html': 'x', 'keep.txt': 'kept' });
    const result = await exec(async (folder) => {
      const work = join(folder, 'work');
      await writeFile(join(work, 'big.bin'), Buffer.alloc(70 * 1024));
      await symlink('/etc/hosts', join(work, 'hosts'));
      await writeFile(join(work, '.env'), 'X=1');
      await writeFile(join(work, 'a b.txt'), 'space');
      await writeFile(join(folder, 'out', 'secret.txt'), 'outside work');
      await link(join(folder, 'out', 'secret.txt'), join(work, 'linked.txt'));
      // A file replaced by one it can't keep keeps its old version.
      await writeFile(join(work, 'keep.txt'), Buffer.alloc(70 * 1024));
    });
    const reasons = result.ok ? Object.fromEntries(result.value.notKept.map((n) => [n.path, n.reason])) : {};
    expect(reasons['big.bin']).toMatch(/over 64 KB/);
    expect(reasons.hosts).toMatch(/a link/);
    expect(reasons['.env']).toMatch(/hidden/);
    expect(reasons['a b.txt']).toMatch(/not a workspace path/);
    expect(reasons['linked.txt']).toMatch(/hard link/);
    expect(reasons['keep.txt']).toMatch(/over 64 KB/);
    expect(result.ok && result.value.changed).toEqual([]);
    expect(await ws.text(projectId, 'keep.txt')).toBe('kept');
  });

  it('writes more than one write takes as several, each over the last', async () => {
    const result = await exec(async (folder) => {
      for (let i = 0; i < 70; i++) await writeFile(join(folder, 'work', `f${i}.txt`), String(i));
    });
    expect(result.ok && result.value.changed).toHaveLength(70);
    expect(ws.dispatched).toHaveLength(3);
    expect(result.ok && result.value.revision).toBe(3);
    expect(await ws.text(projectId, 'f69.txt')).toBe('69');
  });

  it('writes over a head another tool moved when its files are untouched, and refuses when they are', async () => {
    await ws.write(projectId, { 'a.txt': 'a', 'b.txt': 'b' });
    const apart = await exec(async (folder) => {
      await ws.write(projectId, { 'b.txt': 'b2' });
      await writeFile(join(folder, 'work', 'a.txt'), 'a2');
    });
    expect(apart.ok && apart.value.revision).toBe(3);
    expect(await ws.text(projectId, 'b.txt')).toBe('b2');
    const same = await exec(async (folder) => {
      await ws.write(projectId, { 'a.txt': 'theirs' });
      await writeFile(join(folder, 'work', 'a.txt'), 'mine');
    });
    expect(same.ok ? 'ok' : same.error.code).toBe('core.conflict');
    expect(await ws.text(projectId, 'a.txt')).toBe('theirs');
  });

  it('writes nothing back when a limit stopped the command', async () => {
    await ws.write(projectId, { 'a.txt': 'a' });
    const result = await exec(async (folder) => writeFile(join(folder, 'work', 'a.txt'), 'half'), {
      stopped: 'time',
      exitCode: 143,
    });
    expect(result.ok && result.value.stopped).toBe('time');
    expect(result.ok && result.value.revision).toBe(1);
    expect(ws.dispatched).toEqual([]);
    expect(await ws.text(projectId, 'a.txt')).toBe('a');
  });

  it('declares a write through workspace.writeFiles, offline, with a fresh key per call', () => {
    const tool = workspaceExecTool({
      store: ws.store,
      root: temp.root,
      runner: runner(async () => undefined),
      resolveInput: async () => ok('/nowhere'),
    });
    expect(tool.command).toBe('workspace.writeFiles');
    expect(tool.sideEffect).toBe('write');
    expect(tool.permission?.network).toBe('none');
    const input = { projectId, command: 'ls' };
    expect(tool.idempotencyKey!(input)).not.toBe(tool.idempotencyKey!(input));
  });
});

describe('the shell tools in a registry', () => {
  it('register as one workspace module with every check passing', async () => {
    const { createToolRegistry } = await import('../src/registry');
    const { defineToolModule } = await import('@taalcut/core');
    const { workspaceShellTools, WORKSPACE_SHELL_TOOLS } = await import('../src/shell');
    const tools = workspaceShellTools({
      store: ws.store,
      root: temp.root,
      runner: runner(async () => undefined),
      resolveInput: async () => ok('/nowhere'),
    });
    const registry = createToolRegistry([defineToolModule({ id: 'workspace', tools })]);
    expect(registry.ok ? 'ok' : registry.error.detail).toBe('ok');
    expect(tools.map((tool) => tool.name)).toEqual([...WORKSPACE_SHELL_TOOLS]);
  });
});
