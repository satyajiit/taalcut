// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtemp, mkdir, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type * as FsPromises from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { grantCreationDirectory } from '../src/shared/creation-grants';
import { snapshotCreationDirectory, creationSnapshotRoot } from '../src/utility/creation/source-snapshots';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return { ...actual, readdir: vi.fn(actual.readdir) };
});
const temporary: string[] = [];
afterEach(async () => {
  vi.mocked(readdir).mockClear();
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'product-snapshot-'));
  temporary.push(root);
  const source = join(root, 'source');
  await mkdir(source);
  const grant = await grantCreationDirectory(join(root, 'data'), source);
  return { root, source, userData: join(root, 'data'), accessId: grant.accessId };
}

describe('product live capture source snapshot', () => {
  it('excludes credentials and directory symlinks from the execution copy', async () => {
    const f = await fixture();
    await writeFile(join(f.source, 'README.md'), 'Public product facts');
    await writeFile(join(f.source, 'secrets.json'), '{"token":"private"}');
    await mkdir(join(f.root, 'private'));
    await writeFile(join(f.root, 'private', 'private.txt'), 'private-canary');
    await symlink(join(f.root, 'private'), join(f.source, 'linked'));
    const captured = await snapshotCreationDirectory(f.userData, f.accessId, new AbortController().signal);
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    expect(captured.value.files.map((item) => item.path)).toEqual(['README.md']);
    expect(await readdir(join(creationSnapshotRoot(f.userData), captured.value.id, 'source'))).toEqual([
      'README.md',
    ]);
  });

  it('rejects a directory replaced with an outside symlink during traversal', async () => {
    const f = await fixture();
    await mkdir(join(f.source, 'child'));
    await writeFile(join(f.source, 'child', 'public.txt'), 'Public facts');
    await mkdir(join(f.root, 'private'));
    await writeFile(join(f.root, 'private', 'private.txt'), 'private-canary');
    const actual = await vi.importActual<typeof FsPromises>('node:fs/promises');
    vi.mocked(readdir).mockImplementationOnce(async (...args: Parameters<typeof readdir>) => {
      const entries = await actual.readdir(...args);
      await rename(join(f.source, 'child'), join(f.source, 'saved'));
      await symlink(join(f.root, 'private'), join(f.source, 'child'));
      return entries;
    });
    const captured = await snapshotCreationDirectory(f.userData, f.accessId, new AbortController().signal);
    expect(captured.ok).toBe(false);
    expect(await readdir(creationSnapshotRoot(f.userData))).toEqual([]);
    expect(await readFile(join(f.root, 'private', 'private.txt'), 'utf8')).toBe('private-canary');
  });
});
