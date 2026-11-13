// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { err, ok, unwrap, type ImportSessionId } from '@taalcut/core';
import {
  createImportSessionService,
  createImportSink,
  createImportSpaceCoordinator,
  openDatabase,
} from '@taalcut/library';
import { SidecarRejected } from '@taalcut/media';
import { createPhotosImportAdapter } from '../src/main/imports/photos-adapter';
import { renderPhotosImportPreview, resolveImportPreview } from '../src/main/imports/preview-source';
import { PhotosSelectionChanged } from '../src/main/imports/photos-state';
import type {
  ApplePhotosPort,
  PhotosAsset,
  PhotosAuthorization,
  PhotosExportOptions,
} from '../src/platform/photos';

const asset: PhotosAsset = {
  id: 'native-id-never-in-route',
  kind: 'photo',
  livePhoto: true,
  resources: [
    {
      index: 0,
      type: 1,
      originalFilename: 'IMG_1001.HEIC',
      uti: 'public.heic',
      sizeBytes: null,
      required: true,
      role: 'original',
    },
    {
      index: 1,
      type: 9,
      originalFilename: 'IMG_1001.MOV',
      uti: 'com.apple.quicktime-movie',
      sizeBytes: null,
      required: true,
      role: 'paired_video',
    },
  ],
  photosMetadata: {
    createdAt: 1000,
    modifiedAt: 2000,
    width: 1080,
    height: 1920,
    favorite: true,
    latitude: 12,
    longitude: 77,
  },
};
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const clean of cleanups.splice(0)) await clean();
});

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'taalcut-photos-import-')));
  const db = unwrap(openDatabase({ path: ':memory:' }));
  const sink = createImportSink(db, { originalsRoot: root });
  let authorization: PhotosAuthorization['authorization'] = 'authorized';
  let current = [structuredClone(asset)];
  let localOnly = false;
  let failIndex: number | null = null;
  let sinkFailure: 'missing-destination' | 'after-commit' | null = null;
  const exports: number[] = [];
  const photos: ApplePhotosPort = {
    status: vi.fn(async () => ok({ authorization })),
    connect: vi.fn(async () => ok({ authorization })),
    list: vi.fn(async () => ok({ items: current, nextCursor: null, total: current.length })),
    thumbnail: vi.fn(async () => ok({ path: null })),
    exportOriginal: vi.fn(async (options: PhotosExportOptions) => {
      exports.push(options.resource.index);
      if (options.resource.index === failIndex)
        return err(SidecarRejected({ helperCode: 'photos.cloud_required' }));
      const bytes = Buffer.from(options.resource.originalFilename.repeat(10));
      await writeFile(options.dest, bytes, { flag: 'wx' });
      options.onBytes?.(bytes.byteLength);
      return ok({ path: options.dest, bytesWritten: bytes.byteLength });
    }),
    close: vi.fn(async () => {}),
  };
  const space = createImportSpaceCoordinator(db, { freeBytes: () => 2 ** 40 });
  const adapter = createPhotosImportAdapter({
    db,
    photos,
    originalsRoot: async () => root,
    sink: () => ({
      ...sink,
      async importStaged(file, options) {
        if (sinkFailure === 'missing-destination') {
          await writeFile(`${file.path}.dest`, join(root, 'missing-original.MOV'));
          await rm(file.path);
          return err(PhotosSelectionChanged());
        }
        const imported = await sink.importStaged(file, options);
        return imported.ok && sinkFailure === 'after-commit' ? err(PhotosSelectionChanged()) : imported;
      },
    }),
    space,
    volumes: { identify: async () => null, mountedUuids: async () => new Set() },
    localOnly: () => localOnly,
  });
  const create = () => createImportSessionService({ db, adapters: { photos: adapter } });
  const service = create();
  cleanups.push(async () => {
    await service.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  });
  const draft = async () => {
    const { draftId } = unwrap(await service.createDraft({ method: 'photos', watch: false }));
    unwrap(await service.updateDraft({ draftId, selectAll: true }));
    return draftId;
  };
  return {
    db,
    root,
    service,
    create,
    adapter,
    photos,
    exports,
    draft,
    permission: (value: PhotosAuthorization['authorization']) => {
      authorization = value;
    },
    cloudFailure: (index: number | null) => {
      failIndex = index;
    },
    sinkFailure: (value: typeof sinkFailure) => {
      sinkFailure = value;
    },
    setAssets: (items: PhotosAsset[]) => {
      current = items;
    },
    localOnly: (value: boolean) => {
      localOnly = value;
    },
  };
}

async function terminal(service: ReturnType<typeof createImportSessionService>, sessionId: ImportSessionId) {
  await vi.waitFor(() => expect(service.session({ sessionId })?.session.status).not.toBe('running'));
  return service.session({ sessionId })!;
}

describe('Photos import sessions', () => {
  it('persists opaque captures without auto-connect and preserves Photos metadata separately', async () => {
    const fx = await fixture();
    const draftId = await fx.draft();
    const items = fx.service.items({ draftId });
    expect(items.items).toHaveLength(1);
    expect(items.items[0]).toMatchObject({ name: 'IMG_1001.HEIC', sizeBytes: null });
    expect(JSON.stringify(items)).not.toContain(asset.id);
    expect(items.items[0]?.thumbnailUrl).toContain(`/import-preview/${items.items[0]?.id}.jpg`);
    const preview = unwrap(await resolveImportPreview(fx.db, items.items[0]!.id));
    expect(preview?.method).toBe('photos');
    await renderPhotosImportPreview(
      fx.photos,
      preview!.locator,
      '/cache/preview.jpg',
      new AbortController().signal,
    );
    expect(fx.photos.thumbnail).toHaveBeenCalledWith(asset.id, '/cache/preview.jpg', expect.any(AbortSignal));
    expect(fx.photos.connect).toHaveBeenCalledTimes(1);
    expect(unwrap(await fx.service.preflight(draftId))).toMatchObject({
      selectedItems: 2,
      selectedCaptures: 1,
      knownBytes: 0,
      unknownSizeItems: 2,
    });
    await fx.service.close();
    const restored = fx.create();
    expect(restored.draft(draftId)?.method).toBe('photos');
    await restored.preflight(draftId);
    expect(fx.photos.connect).toHaveBeenCalledTimes(1);
    const { sessionId } = unwrap(await restored.start(draftId));
    expect((await terminal(restored, sessionId)).session.status).toBe('completed');
    expect(fx.exports).toEqual([0, 1]);
    const row = fx.db.driver.prepare('SELECT manifest FROM photos_imports').get();
    expect(JSON.parse(String(row?.['manifest']))).toMatchObject({
      complete: true,
      asset: { photosMetadata: asset.photosMetadata },
    });
    const source = fx.db.driver.prepare('SELECT kind FROM sources').get();
    expect(source?.['kind']).toBe('photos_import');
    await restored.close();
  });

  it('keeps successful Live Photo members and retries only the unfinished original', async () => {
    const fx = await fixture();
    const draftId = await fx.draft();
    fx.cloudFailure(1);
    const { sessionId } = unwrap(await fx.service.start(draftId));
    const failed = await terminal(fx.service, sessionId);
    expect(failed.session.status).toBe('failed');
    expect(failed.session.safeToDisconnect).toBe(false);
    expect(failed.items[0]?.receivedBytes).toBeGreaterThan(0);
    fx.cloudFailure(null);
    unwrap(await fx.service.retryFailed(sessionId));
    expect((await terminal(fx.service, sessionId)).session.status).toBe('completed');
    expect(fx.exports).toEqual([0, 1, 1]);
    const second = await fx.draft();
    expect(fx.service.items({ draftId: second }).items[0]?.duplicate).toBe(true);
    unwrap(await fx.service.updateDraft({ draftId: second, onlyNew: true }));
    expect(unwrap(await fx.service.preflight(second)).canStart).toBe(false);
  });

  it('revalidates restored originals and rejects missing companions or Local only downloads', async () => {
    const fx = await fixture();
    const draftId = await fx.draft();
    fx.setAssets([{ ...asset, resources: asset.resources.slice(0, 1) }]);
    expect(unwrap(await fx.service.preflight(draftId))).toMatchObject({
      canStart: false,
      warnings: expect.arrayContaining(['source-changed']),
    });
    fx.setAssets([asset]);
    fx.localOnly(true);
    unwrap(await fx.service.updateDraft({ draftId, allowNetwork: true }));
    expect(unwrap(await fx.service.preflight(draftId))).toMatchObject({
      canStart: false,
      warnings: expect.arrayContaining(['photos-local-only']),
    });
    expect(fx.exports).toEqual([]);
  });

  it('re-exports a missing journalled original rather than retrying stale staging forever', async () => {
    const fx = await fixture();
    const draftId = await fx.draft();
    fx.sinkFailure('missing-destination');
    const { sessionId } = unwrap(await fx.service.start(draftId));
    expect((await terminal(fx.service, sessionId)).session.status).toBe('failed');
    fx.sinkFailure(null);
    unwrap(await fx.service.retryFailed(sessionId));
    expect((await terminal(fx.service, sessionId)).session.status).toBe('completed');
    expect(fx.exports).toEqual([0, 0, 1]);
  });

  it('checks a crash-left completion marker before restoring a removed library asset', async () => {
    const fx = await fixture();
    const draftId = await fx.draft();
    fx.sinkFailure('after-commit');
    const { sessionId } = unwrap(await fx.service.start(draftId));
    expect((await terminal(fx.service, sessionId)).session.status).toBe('failed');
    fx.db.driver.prepare('DELETE FROM assets').run();
    fx.sinkFailure(null);
    unwrap(await fx.service.retryFailed(sessionId));
    expect((await terminal(fx.service, sessionId)).session.status).toBe('completed');
    expect(fx.exports).toEqual([0, 0, 1]);
    expect(fx.db.driver.prepare('SELECT COUNT(*) AS n FROM assets').get()?.['n']).toBe(2);
  });

  it('fails closed on corrupt private inventory instead of starting a different source', async () => {
    const fx = await fixture();
    const draftId = await fx.draft();
    const draft = fx.service.draft(draftId)!;
    expect(await fx.adapter.preflight!(draft, [], { root: '/somewhere-else' })).toEqual(
      err(PhotosSelectionChanged()),
    );
    expect(fx.exports).toEqual([]);
  });
});
