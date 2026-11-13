// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { randomUUID } from 'node:crypto';
import { defineError, err, ok, type AsyncResult } from '@taalcut/core';
import { MediaCancelled, type JsonLineEventSidecar, type JsonValue } from '@taalcut/media';
import { z } from 'zod';
import {
  photosAuthorizationSchema,
  photosPageSchema,
  type ApplePhotosPort,
  type PhotosExportOptions,
} from './types';

export const PhotosInvalidResponse = defineError('desktop.photos_invalid_response', { retryable: true });
export const PhotosLocalOnly = defineError('desktop.photos_local_only');
const readySchema = z.object({
  protocol: z.literal(2),
  services: z.array(z.string()).refine((services) => services.includes('photos')),
  serviceVersions: z.object({ photos: z.literal(1) }),
});
const exportSchema = z.object({ path: z.string().min(1), bytesWritten: z.number().int().nonnegative() });
const thumbnailSchema = z.object({ path: z.string().nullable() });
const bytesSchema = z.object({
  operationId: z.string(),
  bytesWritten: z.number().int().nonnegative(),
  terminal: z.boolean(),
});

/** The helper is lazy and dedicated to Photos; navigation never owns or closes it. */
export function createApplePhotosPort(
  helper: JsonLineEventSidecar,
  policy: { readonly localOnly: () => boolean },
): ApplePhotosPort {
  async function request<T>(
    method: string,
    params: JsonValue,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): AsyncResult<T> {
    if (signal?.aborted) return err(MediaCancelled());
    const ready = await helper.ready();
    if (!ready.ok) return ready;
    if (!readySchema.safeParse(ready.value).success) return err(PhotosInvalidResponse());
    const response = await helper.request(method, params, {
      ...(signal ? { signal } : {}),
      // Keep staging files alive until PhotoKit acknowledges cancellation and has closed them.
      settleOnReply: true,
      ...(method === 'photos.export' || method === 'photos.connect' ? {} : { timeoutMs: 60_000 }),
    });
    if (!response.ok) return response;
    const parsed = schema.safeParse(response.value);
    return parsed.success ? ok(parsed.data) : err(PhotosInvalidResponse());
  }

  async function exportOriginal(options: PhotosExportOptions): AsyncResult<z.output<typeof exportSchema>> {
    const localOnly = policy.localOnly();
    if (options.allowNetwork === true && localOnly) return err(PhotosLocalOnly());
    const operationId = randomUUID();
    let lastBytes = -1;
    let terminal = false;
    const unsubscribe = helper.onEvent((event) => {
      if (event.service !== 'photos' || event.name !== 'bytes' || terminal) return;
      const parsed = bytesSchema.safeParse(event.data);
      if (!parsed.success || parsed.data.operationId !== operationId) return;
      const next = parsed.data;
      if (next.bytesWritten < lastBytes) return;
      terminal = next.terminal;
      if (next.bytesWritten > lastBytes) options.onBytes?.(next.bytesWritten);
      lastBytes = next.bytesWritten;
    });
    try {
      return await request(
        'photos.export',
        {
          assetId: options.assetId,
          resourceIndex: options.resource.index,
          resourceType: options.resource.type,
          originalFilename: options.resource.originalFilename,
          dest: options.dest,
          operationId,
          allowNetwork: options.allowNetwork === true,
          localOnly,
          byteLimit: options.byteLimit ?? null,
        },
        exportSchema,
        options.signal,
      );
    } finally {
      unsubscribe();
    }
  }

  return {
    status: (signal) => request('photos.status', {}, photosAuthorizationSchema, signal),
    connect: (signal) => request('photos.connect', {}, photosAuthorizationSchema, signal),
    list: (options = {}) =>
      request(
        'photos.list',
        {
          cursor: options.cursor ?? 0,
          limit: options.limit ?? 100,
        },
        photosPageSchema,
        options.signal,
      ),
    thumbnail: (assetId, dest, signal) =>
      request('photos.thumbnail', { assetId, dest }, thumbnailSchema, signal),
    exportOriginal,
    close: () => helper.close(),
  };
}
