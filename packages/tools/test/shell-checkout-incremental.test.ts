// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Incremental workspace checkout, cache-aware read-back, binary `assets/<sha256>` support,
 * fast shell folder caching, and process-watch signal fast paths.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { newId, ok, type ProjectId, type WorkspaceStore } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkoutHead, readBack } from '../src/shell/checkout';
import { workspaceExecTool } from '../src/shell/exec-tool';
import { ensureShellFolder } from '../src/shell/folder';
import { trackTree, type ProcessRow } from '../src/shell/process-watch';
import { tempRoot } from './helpers/sandbox';
import { memoryWorkspace, toolContext, type MemoryWorkspace } from './helpers/workspace-store';

let temp: { root: string; cleanup: () => void };
let ws: MemoryWorkspace;
let projectId: ProjectId;

beforeEach(() => {
  temp = tempRoot('taalcut-shell-inc-');
  ws = memoryWorkspace();
  projectId = newId<'Project'>();
});

afterEach(() => temp.cleanup());

function countingStore(base: WorkspaceStore) {
  const reads: string[] = [];
  const store: WorkspaceStore = {
    ...base,
    async readBlob(id, sha256) {
      reads.push(sha256);
      return base.readBlob(id, sha256);
    },
  };
  return { store, reads };
}

describe('incremental checkoutHead and cache-aware readBack', () => {
  it('skips reading blobs from the store when files on disk are unchanged', async () => {
    const workDir = join(temp.root, 'work');
    await ws.write(projectId, {
      'index.html': '<h1>Hello</h1>',
      'styles/main.css': 'body { margin: 0; }',
      '_taalcut/brief.md': '# Brief',
    });
    const { store, reads } = countingStore(ws.store);

    const first = await checkoutHead(store, projectId, workDir);
    expect(first.ok).toBe(true);
    expect(reads).toHaveLength(3);

    reads.length = 0;
    const second = await checkoutHead(store, projectId, workDir);
    expect(second.ok).toBe(true);
    expect(reads).toHaveLength(0);
  });

  it('restores modified and deleted files and removes extraneous files, directories and symlinks', async () => {
    const workDir = join(temp.root, 'work');
    await ws.write(projectId, {
      'index.html': '<h1>Original</h1>',
      'keep/nested.txt': 'nested-content',
    });
    const { store, reads } = countingStore(ws.store);

    const first = await checkoutHead(store, projectId, workDir);
    expect(first.ok).toBe(true);
    reads.length = 0;

    // Modify index.html on disk, delete keep/nested.txt, and add extraneous file, dir, and symlink
    await writeFile(join(workDir, 'index.html'), '<h1>Tampered</h1>');
    await rm(join(workDir, 'keep', 'nested.txt'));
    await writeFile(join(workDir, 'stray.txt'), 'remove me');
    await mkdir(join(workDir, 'extra-dir', 'sub'), { recursive: true });
    await writeFile(join(workDir, 'extra-dir', 'sub', 'junk.txt'), 'junk');
    await symlink('/etc/hosts', join(workDir, 'bad-link'));

    const second = await checkoutHead(store, projectId, workDir);
    expect(second.ok).toBe(true);
    expect(reads).toHaveLength(2);
    expect(await readFile(join(workDir, 'index.html'), 'utf8')).toBe('<h1>Original</h1>');
    expect(await readFile(join(workDir, 'keep', 'nested.txt'), 'utf8')).toBe('nested-content');
    expect(existsSync(join(workDir, 'stray.txt'))).toBe(false);
    expect(existsSync(join(workDir, 'extra-dir'))).toBe(false);
    expect(existsSync(join(workDir, 'bad-link'))).toBe(false);
  });

  it('reads back binary assets/<sha256> files and caches them so the next checkout skips readBlob', async () => {
    const shellRoot = join(temp.root, 'shell');
    await ws.write(projectId, { 'index.html': '<p>start</p>' });
    const { store, reads } = countingStore(ws.store);

    // Non-UTF-8 binary payload (e.g. PNG header + invalid UTF-8 sequences)
    const binaryBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0xfd, 0x00, 0x80, 0xc0]);
    const assetSha = createHash('sha256').update(binaryBytes).digest('hex');
    const assetPath = `assets/${assetSha}`;

    const tool = workspaceExecTool({
      store,
      root: shellRoot,
      runner: {
        async run(id) {
          const work = join(shellRoot, id, 'work');
          await mkdir(join(work, 'assets'), { recursive: true });
          await writeFile(join(work, assetPath), binaryBytes);
          return ok({
            exitCode: 0,
            stdout: 'ok',
            stderr: '',
            durationMs: 2,
            stopped: null,
            peakMemoryBytes: 0,
          });
        },
      },
      resolveInput: async () => ok('/nowhere'),
    });

    const firstRun = await tool.run({ projectId, command: 'make-asset' }, toolContext(ws.dispatch));
    expect(firstRun.ok).toBe(true);
    if (firstRun.ok) {
      expect(firstRun.value.changed).toEqual([{ path: assetPath, change: 'added' }]);
      expect(firstRun.value.revision).toBe(2);
    }

    // Because readBack updated the cache for work/, the next workspace.exec does not re-read blobs
    reads.length = 0;
    const secondRun = await tool.run({ projectId, command: 'noop' }, toolContext(ws.dispatch));
    expect(secondRun.ok).toBe(true);
    expect(reads).toHaveLength(0);

    // Direct readBack check on binary asset
    const work = join(shellRoot, projectId, 'work');
    const checked = await checkoutHead(store, projectId, work);
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      const back = await readBack(work, checked.value);
      expect(back.changes).toEqual([]);
      expect(back.notKept).toEqual([]);
    }
  });
});

describe('ensureShellFolder caching and process-watch signal fast paths', () => {
  it('caches ensureShellFolder in memory and invalidates when the directory is removed', async () => {
    const root = join(temp.root, 'shell-cache');
    const first = await ensureShellFolder(root, projectId, 1000);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const manifestPath = join(first.value.folder, 'shell.json');
    const firstStat = await stat(manifestPath);

    // Within 60s window: updates usedAt in memory without rewriting shell.json
    const second = await ensureShellFolder(root, projectId, 2000);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.manifest.usedAt).toBe(2000);
    const secondStat = await stat(manifestPath);
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);

    // If the folder is deleted on disk, ensureShellFolder recreates it seamlessly
    await rm(first.value.folder, { recursive: true, force: true });
    const third = await ensureShellFolder(root, projectId, 3000);
    expect(third.ok).toBe(true);
    expect(existsSync(manifestPath)).toBe(true);
  });

  it('skips listing before a poll, then rechecks observed processes when signalling', async () => {
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    let listCalls = 0;
    const rows: ProcessRow[] = [
      { pid: 999991, ppid: 1, pgid: 999991, rssKiB: 512, started: 'Mon Nov  3 10:00:01 2026' },
      { pid: 999992, ppid: 999991, pgid: 999991, rssKiB: 512, started: 'Mon Nov  3 10:00:02 2026' },
    ];
    const tree = trackTree(999991, async () => {
      listCalls += 1;
      return rows;
    });

    try {
      // Before any poll: there are no tracked identities to recheck.
      await tree.signal('SIGTERM');
      expect(listCalls).toBe(0);

      // A child may have left the group since the poll, so signalling must refresh the observed identities.
      await tree.poll();
      expect(listCalls).toBe(1);
      await tree.signal('SIGTERM');
      expect(listCalls).toBe(2);
    } finally {
      kill.mockRestore();
    }
  });
});
