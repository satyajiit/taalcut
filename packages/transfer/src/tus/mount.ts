// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * tus 1.0 on @tus/server 2.4.6 and @tus/file-store 2.1.1 (both MIT).
 * Checksums are not implemented by the file store: the finish hook checks
 * the size, and tests hash the bytes. Expiration is advertised and swept
 * at the next session, not on a timer that could cut a long upload.
 */
import { FileStore } from '@tus/file-store';
import { EVENTS, MemoryLocker, Server, type Upload } from '@tus/server';
import { isId, newId } from '@taalcut/core';
import { TRANSFER_LIMITS } from '../limits';

export interface TusCallbacks {
  onCreate(upload: Upload, rawMetadata: string): Promise<void>;
  onReceive(id: string, offset: number): void;
  onFinish(upload: Upload): Promise<void>;
  /** PATCH/HEAD/DELETE of an id this device does not own, and the media sniff. */
  onIncoming(method: string, uploadId: string): Promise<void>;
}

export function createTus(directory: string, callbacks: TusCallbacks): { server: Server; store: FileStore } {
  const store = new FileStore({
    directory,
    expirationPeriodInMilliseconds: TRANSFER_LIMITS.partialTtlMs,
  });
  const server = new Server({
    path: '/files',
    datastore: store,
    locker: new MemoryLocker(),
    maxSize: TRANSFER_LIMITS.maxFileBytes,
    relativeLocation: true,
    respectForwardedHeaders: false,
    allowedOrigins: [],
    postReceiveInterval: TRANSFER_LIMITS.postReceiveIntervalMs,
    disableTerminationForFinishedUploads: true,
    namingFunction: () => newId<'TransferUpload'>(),
    getFileIdFromRequest: (_req, lastPath) => (isId(lastPath) ? lastPath : undefined),
    onIncomingRequest: async (req, uploadId) => {
      await callbacks.onIncoming(req.method ?? 'GET', uploadId);
    },
    onUploadCreate: async (req, upload) => {
      await callbacks.onCreate(upload, req.headers.get('upload-metadata') ?? '');
      return {};
    },
    onUploadFinish: async (_req, upload) => {
      await callbacks.onFinish(upload);
      return {};
    },
  });
  server.on(EVENTS.POST_RECEIVE, (_req, upload) => {
    callbacks.onReceive(String(upload.id), Number(upload.offset));
  });
  return { server, store };
}

export function tusError(status: number, body: string): Error & { status_code: number; body: string } {
  const error = new Error(body) as Error & { status_code: number; body: string };
  error.status_code = status;
  error.body = body;
  return error;
}
