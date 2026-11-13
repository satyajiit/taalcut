// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '@taalcut/core';
import {
  MediaCancelled,
  SidecarRejected,
  type JsonLineEvent,
  type JsonLineEventSidecar,
  type JsonValue,
} from '@taalcut/media';
import {
  createApplePhotosPort,
  PhotosInvalidResponse,
  PhotosLocalOnly,
  type PhotosResource,
} from '../src/platform/photos';

const resource: PhotosResource = {
  index: 0,
  type: 2,
  originalFilename: 'IMG_0123.MOV',
  uti: 'com.apple.quicktime-movie',
  sizeBytes: null,
  required: true,
  role: 'original',
};
const ready = { protocol: 2, services: ['photos'], serviceVersions: { photos: 1 } };

function fixture(localOnly = false) {
  const listeners = new Set<(event: JsonLineEvent) => void>();
  const helper = {
    ready: vi.fn(async () => ok(ready)),
    request: vi.fn<JsonLineEventSidecar['request']>(async (method) => {
      if (method === 'photos.list') return ok({ items: [], nextCursor: null, total: 0 });
      if (method === 'photos.thumbnail') return ok({ path: null });
      if (method === 'photos.export') return ok({ path: '/staging/original', bytesWritten: 30 });
      return ok({ authorization: 'authorized' });
    }),
    onEvent: (listener: (event: JsonLineEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close: vi.fn(async () => {}),
  } satisfies JsonLineEventSidecar;
  return { helper, listeners, port: createApplePhotosPort(helper, { localOnly: () => localOnly }) };
}

describe('Apple Photos adapter', () => {
  it('is lazy and queries do not request permission', async () => {
    const { port, helper } = fixture();
    expect(helper.ready).not.toHaveBeenCalled();
    await port.status();
    await port.list();
    await port.thumbnail('asset', '/staging/preview.jpg');
    expect(helper.request.mock.calls.map(([method]) => method)).toEqual([
      'photos.status',
      'photos.list',
      'photos.thumbnail',
    ]);
    await port.connect();
    expect(helper.request.mock.lastCall?.[0]).toBe('photos.connect');
  });

  it('exports only the selected resource, without network, using the reserved byte limit', async () => {
    const { port, helper } = fixture();
    const signal = new AbortController().signal;
    expect(
      (
        await port.exportOriginal({
          assetId: 'chosen',
          resource,
          dest: '/staging/original',
          byteLimit: 50,
          signal,
        })
      ).ok,
    ).toBe(true);
    expect(helper.request.mock.lastCall).toEqual([
      'photos.export',
      expect.objectContaining({
        assetId: 'chosen',
        resourceIndex: 0,
        resourceType: 2,
        originalFilename: 'IMG_0123.MOV',
        allowNetwork: false,
        localOnly: false,
        byteLimit: 50,
      }),
      expect.objectContaining({ signal, settleOnReply: true }),
    ]);
  });

  it('requires explicit download opt-in and refuses it in Local only mode', async () => {
    const selected = {
      assetId: 'chosen',
      resource,
      dest: '/staging/original',
      signal: new AbortController().signal,
      allowNetwork: true,
    };
    const denied = fixture(true);
    expect(await denied.port.exportOriginal(selected)).toEqual(err(PhotosLocalOnly()));
    expect(denied.helper.request).not.toHaveBeenCalled();
    const allowed = fixture();
    await allowed.port.exportOriginal(selected);
    expect(allowed.helper.request.mock.lastCall?.[1]).toMatchObject({ allowNetwork: true });
    await allowed.port.thumbnail('chosen', '/staging/thumb.jpg');
    expect(allowed.helper.request.mock.lastCall?.[1]).toEqual({
      assetId: 'chosen',
      dest: '/staging/thumb.jpg',
    });
  });

  it('filters progress by resource request and ignores late or regressing byte events', async () => {
    const { port, helper, listeners } = fixture();
    helper.request.mockImplementationOnce(async (_, params: JsonValue) => {
      const operationId = (params as Record<string, JsonValue>)['operationId'];
      for (const [id, bytesWritten, terminal] of [
        ['other', 100, false],
        [operationId, 10, false],
        [operationId, 4, false],
        [operationId, 30, true],
        [operationId, 50, false],
      ]) {
        for (const listener of listeners)
          listener({
            service: 'photos',
            name: 'bytes',
            data: { operationId: id, bytesWritten, terminal } as JsonValue,
          });
      }
      return ok({ path: '/staging/original', bytesWritten: 30 });
    });
    const onBytes = vi.fn();
    await port.exportOriginal({
      assetId: 'chosen',
      resource,
      dest: '/staging/original',
      signal: new AbortController().signal,
      onBytes,
    });
    expect(onBytes.mock.calls).toEqual([[10], [30]]);
    expect(listeners.size).toBe(0);
  });

  it('propagates permission loss and never hides a failed export as an empty success', async () => {
    const { port, helper, listeners } = fixture();
    const failure = SidecarRejected({ helperCode: 'photos.permission_denied' });
    helper.request.mockResolvedValueOnce(err(failure));
    expect(
      await port.exportOriginal({
        assetId: 'chosen',
        resource,
        dest: '/staging/original',
        signal: new AbortController().signal,
      }),
    ).toEqual(err(failure));
    expect(listeners.size).toBe(0);
    helper.request.mockResolvedValueOnce(ok({ items: [], total: 0 }));
    expect(await port.list()).toEqual(err(PhotosInvalidResponse()));
  });

  it('does not contact Photos when an operation was already cancelled', async () => {
    const { port, helper } = fixture();
    const controller = new AbortController();
    controller.abort();
    expect(await port.connect(controller.signal)).toEqual(err(MediaCancelled()));
    expect(helper.ready).not.toHaveBeenCalled();
  });
});
