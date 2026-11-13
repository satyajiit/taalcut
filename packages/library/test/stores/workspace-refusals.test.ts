// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-WS: what the workspace refuses. Paths that leave the folder (`..`, absolute, backslashes, dot names,
 * encoded dots), names that are one file on a case-insensitive disk, writes into `_taalcut/` from anyone but
 * Taalcut's own writer (in any case), links planted in the blob folder, and the limits: 32 changes a write, 64 KB a
 * file, 2 MB a workspace.
 */
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentTurnGroup, newId, unwrap, WORKSPACE_LIMITS } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../helpers';
import {
  agent,
  bytes,
  code,
  filesAtHead,
  mcp,
  person,
  setup,
  W,
  withProject,
  writeFiles,
} from './workspace-setup';

const ESCAPES = [
  '../outside.css',
  'card/../../outside.css',
  '/etc/hosts',
  '/Users/someone/file.css',
  'C:/Windows/file.css',
  'card\\..\\outside.css',
  '.hidden.css',
  'card/.git/config',
  './card.css',
  'card/./style.css',
  '%2e%2e/outside.css',
  'card//style.css',
  'card/',
  '',
  'card/style.css\u0000.html',
  'caf\u00e9.css',
];

describe('workspace refusals (HFW1-WS)', () => {
  it.each(ESCAPES)('refuse the path %j before anything is written', async (path) => {
    const world = await setup();
    const { projectId } = await withProject(world);
    const blob = unwrap(await world.store.putBlob(projectId, bytes('.a{}')));
    const write = await world.bus.dispatch(
      W.writeFiles,
      { projectId, baseRevision: 0, files: [{ path, sha256: blob.sha256 }] },
      agent,
    );
    expect(code(write)).toBe('core.validation');
    expect(unwrap(await world.store.head(projectId))).toBeNull();
  });

  it('refuse names that are one file on a case-insensitive disk, and a file that is also a folder', async () => {
    const world = await setup();
    const { projectId } = await withProject(world);
    unwrap(await writeFiles(world, projectId, { 'card/Style.css': '.a{}' }));
    expect(code(await writeFiles(world, projectId, { 'card/style.css': '.b{}' }))).toBe('core.validation');
    expect(code(await writeFiles(world, projectId, { 'CARD/style.css': '.b{}' }))).toBe('core.validation');
    expect(code(await writeFiles(world, projectId, { 'card/Style.css/x.css': '.b{}' }))).toBe(
      'core.validation',
    );
    expect(code(await writeFiles(world, projectId, { card: 'a file' }))).toBe('core.validation');
    // Renaming by case is a delete and a write in one change.
    unwrap(await writeFiles(world, projectId, { 'card/Style.css': null, 'card/style.css': '.a{}' }));
    expect(Object.keys(await filesAtHead(world, projectId))).toEqual(['card/style.css']);
  });

  it('refuse writes and deletes in _taalcut/, in any case, from a tool, a client or a person', async () => {
    const world = await setup();
    const { projectId } = await withProject(world);
    for (const origin of [agent, mcp, person])
      for (const path of ['_taalcut/brief.md', '_TAALCUT/brief.md', '_Taalcut/notes.md', '_taalcut'])
        expect(code(await writeFiles(world, projectId, { [path]: 'x' }, { origin }))).toBe('core.validation');
    expect(unwrap(await world.store.head(projectId))).toBeNull();
    // Taalcut's own writer may, in the run's turn; then a tool can't change or delete it.
    const group = agentTurnGroup(newId<'AgentRun'>());
    const brief = unwrap(
      await world.commands.writeReserved(
        world.bus,
        projectId,
        [{ path: '_taalcut/brief.md', data: bytes('# Brief') }],
        {
          group,
        },
      ),
    );
    expect(brief.revision).toBeGreaterThan(0);
    expect((await filesAtHead(world, projectId))['_taalcut/brief.md']).toBe('# Brief');
    expect(code(await writeFiles(world, projectId, { '_taalcut/brief.md': '# Mine' }))).toBe(
      'core.validation',
    );
    expect(code(await writeFiles(world, projectId, { '_taalcut/brief.md': null }))).toBe('core.validation');
    // A tool's file beside it keeps it.
    unwrap(await writeFiles(world, projectId, { 'card/index.html': '<p>a</p>' }));
    expect(Object.keys(await filesAtHead(world, projectId))).toEqual([
      '_taalcut/brief.md',
      'card/index.html',
    ]);
    // The writer only writes there.
    const elsewhere = [{ path: 'card/index.html', data: bytes('<p>b</p>') }];
    expect(code(await world.commands.writeReserved(world.bus, projectId, elsewhere))).toBe('core.validation');
  });

  // 33 puts of 64 KB, each one fsynced: slow on a busy disk.
  it('keep to the limits: 32 changes a write, 64 KB a file, 2 MB a workspace', async () => {
    const world = await setup();
    const { projectId } = await withProject(world);
    const many = Object.fromEntries(
      Array.from({ length: WORKSPACE_LIMITS.files + 1 }, (_, n) => [`f${n}.css`, `.f${n}{}`]),
    );
    expect(code(await writeFiles(world, projectId, many))).toBe('core.validation');
    const big = new Uint8Array(WORKSPACE_LIMITS.fileBytes + 1);
    expect(code(await world.store.putBlob(projectId, big))).toBe('core.validation');
    unwrap(await world.store.putBlob(projectId, new Uint8Array(WORKSPACE_LIMITS.fileBytes)));

    // 32 files of 64 KB each is the whole 2 MB; one byte more is refused.
    const full = (n: number, size: number) => 'x'.repeat(size - String(n).length) + n;
    const files = Object.fromEntries(
      Array.from({ length: WORKSPACE_LIMITS.files }, (_, n) => [
        `big/f${n}.txt`,
        full(n, WORKSPACE_LIMITS.fileBytes),
      ]),
    );
    unwrap(await writeFiles(world, projectId, files));
    expect(unwrap(await world.store.head(projectId))!.files).toHaveLength(32);
    const over = await writeFiles(world, projectId, { 'one.txt': 'x' });
    expect(over.ok ? null : over.error).toMatchObject({
      code: 'core.validation',
      params: { field: 'files' },
    });
    unwrap(await writeFiles(world, projectId, { 'big/f0.txt': null, 'one.txt': 'x' }));
  }, 60_000);

  it('never follow a link planted in the blob folder', async () => {
    const world = await setup();
    const { projectId } = await withProject(world);
    const outside = tempDir();
    const target = join(outside, 'target.css');
    writeFileSync(target, '.outside{}');
    const blob = unwrap(await world.store.putBlob(projectId, bytes('.a{}')));
    const bucket = join(world.dataRoot, 'workspaces', projectId, 'blobs', blob.sha256.slice(0, 2));

    // A blob that is a link to another file reads as missing, and a write naming it is refused.
    const linkedBlob = unwrap(await world.store.putBlob(projectId, bytes('.outside{}')));
    const linkedPath = join(
      world.dataRoot,
      'workspaces',
      projectId,
      'blobs',
      linkedBlob.sha256.slice(0, 2),
      linkedBlob.sha256,
    );
    rmSync(linkedPath);
    symlinkSync(target, linkedPath);
    expect(code(await world.store.readBlob(projectId, linkedBlob.sha256))).toBe('core.not_found');
    expect(
      code(
        await world.bus.dispatch(
          W.writeFiles,
          { projectId, baseRevision: 0, files: [{ path: 'o.css', sha256: linkedBlob.sha256 }] },
          agent,
        ),
      ),
    ).toBe('core.not_found');
    // A put over the link refuses to write through it.
    expect(code(await world.store.putBlob(projectId, bytes('.outside{}')))).toBe('core.validation');
    expect(readFileSync(target, 'utf8')).toBe('.outside{}');

    // A bucket folder that is a link: neither a put nor a read goes through it.
    rmSync(bucket, { recursive: true });
    mkdirSync(join(outside, 'bucket'));
    symlinkSync(join(outside, 'bucket'), bucket);
    expect(code(await world.store.putBlob(projectId, bytes('.a{}')))).toBe('core.validation');
    expect(code(await world.store.readBlob(projectId, blob.sha256))).toBe('core.not_found');

    // The workspaces folder itself.
    const other = await withProject(world);
    rmSync(join(world.dataRoot, 'workspaces'), { recursive: true });
    symlinkSync(outside, join(world.dataRoot, 'workspaces'));
    expect(code(await world.store.putBlob(other.projectId, bytes('.b{}')))).toBe('core.validation');
  });

  it('refuse a project id in lower case, which names the same folder on a Mac', async () => {
    const world = await setup();
    const { projectId } = await withProject(world);
    const lower = projectId.toLowerCase() as typeof projectId;
    expect(code(await world.store.putBlob(lower, bytes('.a{}')))).toBe('core.not_found');
    expect(code(await world.store.blobs.put(lower, bytes('.a{}')))).toBe('core.validation');
    expect(code(await world.store.readBlob(lower, 'a'.repeat(64)))).toBe('core.validation');
    expect(code(await world.store.readBlob(projectId, 'A'.repeat(64)))).toBe('core.validation');
  });

  it('read a blob changed on disk as missing, and a put of the same bytes mends it', async () => {
    const world = await setup();
    const { projectId } = await withProject(world);
    const blob = unwrap(await world.store.putBlob(projectId, bytes('.a{}')));
    const path = join(world.dataRoot, 'workspaces', projectId, 'blobs', blob.sha256.slice(0, 2), blob.sha256);
    writeFileSync(path, '.changed{}');
    expect(code(await world.store.readBlob(projectId, blob.sha256))).toBe('core.not_found');
    unwrap(await world.store.putBlob(projectId, bytes('.a{}')));
    expect(new TextDecoder().decode(unwrap(await world.store.readBlob(projectId, blob.sha256)))).toBe('.a{}');
  });
});
