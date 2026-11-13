// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MEDIA_HOST, newId, ok } from '@taalcut/core';
import { createImportPreviewHandler, type ImportPreviewOptions } from '../src/main/protocol/import-previews';

const roots: string[] = [];
const origin = `app://${MEDIA_HOST}`;
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 0xff, 0xd9]);
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(render?: ImportPreviewOptions<string>['render']) {
  const rootDir = await mkdtemp(join(tmpdir(), 'taalcut-import-preview-'));
  roots.push(rootDir);
  const id = newId<'ImportItem'>();
  const resolve = vi.fn(async () => ok<string | null>('private-native-id'));
  const make = vi.fn<ImportPreviewOptions<string>['render']>(
    render ??
      (async (_, dest) => {
        await writeFile(dest, jpeg, { flag: 'wx' });
        return ok({ path: dest });
      }),
  );
  const handler = createImportPreviewHandler({ rootDir, resolve, render: make });
  const url = `${origin}/import-preview/${id}.jpg`;
  return { rootDir, id, resolve, make, handler, url };
}

describe('lazy import previews', () => {
  it('uses opaque ids, generates once for concurrent views and answers HEAD from cache only', async () => {
    const fx = await fixture();
    expect((await fx.handler({ url: fx.url, method: 'HEAD' }))?.status).toBe(404);
    expect(fx.make).not.toHaveBeenCalled();
    const responses = await Promise.all([
      fx.handler({ url: fx.url, method: 'GET' }),
      fx.handler({ url: fx.url, method: 'GET' }),
    ]);
    expect(responses.map((response) => response?.status)).toEqual([200, 200]);
    expect(fx.make).toHaveBeenCalledTimes(1);
    expect(fx.resolve.mock.lastCall).toEqual([fx.id]);
    expect(fx.make.mock.calls[0]?.[0]).toBe('private-native-id');
    expect(Buffer.from(await responses[0]!.arrayBuffer())).toEqual(jpeg);
    const head = await fx.handler({ url: fx.url, method: 'HEAD' });
    expect(head?.headers.get('Content-Type')).toBe('image/jpeg');
    expect(head?.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await head?.text()).toBe('');
    expect(fx.make).toHaveBeenCalledTimes(1);
  });

  it('does not accept paths, other hosts, mutations or deleted selections', async () => {
    const fx = await fixture();
    expect(
      await fx.handler({ url: `https://media/import-preview/${fx.id}.jpg`, method: 'GET' }),
    ).toBeUndefined();
    expect(
      (await fx.handler({ url: `${origin}/import-preview/%2Fetc%2Fpasswd`, method: 'GET' }))?.status,
    ).toBe(404);
    expect((await fx.handler({ url: fx.url + '?file=/etc/passwd', method: 'GET' }))?.status).toBe(404);
    expect((await fx.handler({ url: fx.url, method: 'POST' }))?.status).toBe(405);
    expect(fx.make).not.toHaveBeenCalled();
    await fx.handler({ url: fx.url, method: 'GET' });
    fx.resolve.mockResolvedValue(ok(null));
    expect((await fx.handler({ url: fx.url, method: 'GET' }))?.status).toBe(404);
  });

  it('never serves a generated symlink or a renderer-selected path outside the cache', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'taalcut-preview-outside-'));
    roots.push(outside);
    const secret = join(outside, 'photo.jpg');
    await writeFile(secret, jpeg);
    const fx = await fixture(async (_, dest) => {
      await symlink(secret, dest);
      return ok({ path: dest });
    });
    expect((await fx.handler({ url: fx.url, method: 'GET' }))?.status).toBe(404);
    expect(await readdir(fx.rootDir)).toEqual([]);
    fx.make.mockResolvedValue(ok({ path: secret }));
    expect((await fx.handler({ url: fx.url, method: 'GET' }))?.status).toBe(404);
  });

  it('cancels a preview only after its last viewer leaves and cleans incomplete cache files', async () => {
    let started: (() => void) | undefined;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    let renderSignal: AbortSignal | undefined;
    const fx = await fixture(async (_, dest, signal) => {
      renderSignal = signal;
      await writeFile(dest, jpeg);
      started?.();
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      return ok({ path: dest });
    });
    const first = new AbortController();
    const second = new AbortController();
    const requests = [
      fx.handler({ url: fx.url, method: 'GET', signal: first.signal }),
      fx.handler({ url: fx.url, method: 'GET', signal: second.signal }),
    ];
    await began;
    first.abort();
    expect(renderSignal?.aborted).toBe(false);
    second.abort();
    expect((await Promise.all(requests)).map((response) => response?.status)).toEqual([404, 404]);
    expect(renderSignal?.aborted).toBe(true);
    expect(await readdir(fx.rootDir)).toEqual([]);
  });
});
