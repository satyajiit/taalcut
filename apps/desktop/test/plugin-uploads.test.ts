// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { err, newId, NotFoundError, ok, type RenderRecord } from '@taalcut/core';
import { createPluginMediaPathResolver, createPluginUploadReader } from '../src/main/plugins/plugin-uploads';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'taalcut-plugin-upload-'));
  directories.push(directory);
  const path = join(directory, 'output.mp4');
  await writeFile(path, 'known-media-content');
  const assetId = newId<'Asset'>();
  const renderId = newId<'Render'>();
  const record = { status: 'ready', deletedAt: null, filePath: path } as RenderRecord;
  const media = {
    assetPath: (id: typeof assetId) => (id === assetId ? path : undefined),
    renders: { get: async (id: typeof renderId) => (id === renderId ? ok(record) : err(NotFoundError({ entity: 'render' }))) },
  };
  const read = createPluginUploadReader(media);
  const resolvePath = createPluginMediaPathResolver(media);
  return { directory, path, assetId, renderId, record, read, resolvePath, signal: new AbortController().signal };
}

describe('plugin uploads', () => {
  it('streams only a known library asset or completed render', async () => {
    const { read, assetId, renderId, signal } = await fixture();
    for (const input of [{ assetId }, { renderId }]) {
      const result = await read(input, signal);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.name).toBe('output.mp4');
      expect(result.value.file.type).toBe('video/mp4');
      expect(await result.value.file.text()).toBe('known-media-content');
    }
  });

  it('rejects ambiguous ids, arbitrary paths, absent records and cancelled reads', async () => {
    const { read, assetId, renderId, signal, path } = await fixture();
    expect((await read({ assetId, renderId }, signal)).ok).toBe(false);
    expect((await read({ assetId: path }, signal)).ok).toBe(false);
    expect((await read({ assetId: newId<'Asset'>() }, signal)).ok).toBe(false);
    expect((await read({}, signal)).ok).toBe(false);
    expect((await read({ assetId }, AbortSignal.abort())).ok).toBe(false);
  });

  it('refuses symlinks, unsupported files and unfinished or deleted renders', async () => {
    const { read, assetId, renderId, path, directory, signal, record } = await fixture();
    Object.assign(record, { status: 'rendering' });
    expect((await read({ renderId }, signal)).ok).toBe(false);
    Object.assign(record, { status: 'ready', deletedAt: 123 });
    expect((await read({ renderId }, signal)).ok).toBe(false);
    await rm(path);
    const other = join(directory, 'other.mp4');
    await writeFile(other, 'other');
    await symlink(other, path);
    expect((await read({ assetId }, signal)).ok).toBe(false);
    const unsupported = createPluginUploadReader({
      assetPath: () => join(directory, 'private.txt'),
      renders: { get: async () => ok(record) },
    });
    expect((await unsupported({ assetId }, signal)).ok).toBe(false);
  });
  it('binds the streamed upload blob to the approved digest and refuses later file changes', async () => {
    const { read, renderId, signal, path } = await fixture();
    const expectedSha256 = createHash('sha256').update('known-media-content').digest('hex');
    expect((await read({ renderId, expectedSha256: '0'.repeat(64) }, signal)).ok).toBe(false);
    const result = await read({ renderId, expectedSha256 }, signal);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await writeFile(path, 'other-media-content');
    await expect(result.value.file.arrayBuffer()).rejects.toThrow();
  });

  it('resolves verified local media paths for local-only plugins and rejects invalid or tampered files', async () => {
    const { resolvePath, assetId, renderId, path, directory, signal, record } = await fixture();
    const expectedSha256 = createHash('sha256').update('known-media-content').digest('hex');

    const assetResolved = await resolvePath({ assetId }, signal);
    expect(assetResolved).toEqual(ok(path));

    const renderResolved = await resolvePath({ renderId, expectedSha256 }, signal);
    expect(renderResolved).toEqual(ok(path));

    expect((await resolvePath({ renderId, expectedSha256: '0'.repeat(64) }, signal)).ok).toBe(false);
    expect((await resolvePath({ assetId }, AbortSignal.abort())).ok).toBe(false);

    Object.assign(record, { status: 'rendering' });
    expect((await resolvePath({ renderId }, signal)).ok).toBe(false);
    Object.assign(record, { status: 'ready', deletedAt: 123 });
    expect((await resolvePath({ renderId }, signal)).ok).toBe(false);

    await rm(path);
    const other = join(directory, 'other.mp4');
    await writeFile(other, 'other');
    await symlink(other, path);
    expect((await resolvePath({ assetId }, signal)).ok).toBe(false);
  });
});
