// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { dirname, join } from 'node:path';
import { CancelledError, err, newId, ok, type AsyncResult } from '@taalcut/core';
import {
  createImportReaderRegistry,
  openSelectedOriginal,
  writeDurably,
  type CaptureFile,
  type LibraryDatabase,
  type VolumeProbe,
} from '@taalcut/library';
import { createBinaryResolver, createMediaService, ffmpegBuildTarget } from '@taalcut/media';
import type { ImportPreviewSource } from './preview-source';

/** Existing media paths select GPU decode/tone mapping first and log every CPU fallback. */
export function createImportPreviewMedia(options: {
  readonly packaged: boolean;
  readonly resourcesPath: string;
  readonly db: LibraryDatabase;
  readonly volumes: VolumeProbe;
}) {
  const media = createMediaService({
    resolver: createBinaryResolver(
      options.packaged
        ? {
            sidecarDir: join(options.resourcesPath, ffmpegBuildTarget()?.resourcesFolder ?? 'bin'),
            requireLgpl: true,
            env: {},
          }
        : { development: true },
    ),
  });
  const readers = createImportReaderRegistry(options.db);
  let tail = Promise.resolve();
  async function read<T>(
    file: CaptureFile,
    signal: AbortSignal,
    action: () => AsyncResult<T>,
  ): AsyncResult<T> {
    const prior = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      if (signal.aborted) return err(CancelledError());
      const original = await openSelectedOriginal(file);
      if (!original.ok) return original;
      await original.value.close();
      const volume = await options.volumes.identify(file.path);
      const lease = readers.acquire(newId<'Preview'>(), volume?.uuid ?? dirname(file.path));
      if (!lease.ok) return lease;
      try {
        return await action();
      } finally {
        lease.value();
      }
    } finally {
      release();
    }
  }
  return {
    async inspect(file: CaptureFile): Promise<CaptureFile['evidence']> {
      const result = await read(file, new AbortController().signal, () =>
        media.probe(file.path, { timeoutMs: 10000 }),
      );
      if (!result.ok) return undefined;
      const model = result.value.phone?.model ?? result.value.tags['model'];
      const processingMode = result.value.phone?.captureMode ?? result.value.tags['capture_mode'];
      return {
        videoTracks: result.value.streams.filter((stream) => stream.kind === 'video').length,
        ...(model ? { model } : {}),
        ...(processingMode ? { processingMode } : {}),
      };
    },
    async render(
      source: ImportPreviewSource,
      dest: string,
      signal: AbortSignal,
    ): AsyncResult<{ path: string | null }> {
      const locator = source.locator as { capture?: { files?: readonly CaptureFile[] } };
      const files = locator.capture?.files ?? [];
      const file = files.find((candidate) =>
        /\.(mp4|mov|m4v|mkv|jpg|jpeg|png|heic|heif|webp)$/i.test(candidate.name),
      );
      if (!file) return ok({ path: null });
      return read(file, signal, async () => {
        const frame = await media.extractFrame(
          file.path,
          { value: 0, rate: 1 },
          { signal, format: 'jpeg', maxDimension: 480, timeoutMs: 10000 },
        );
        if (!frame.ok) return frame;
        await writeDurably(dest, frame.value.data);
        return ok({ path: dest });
      });
    },
  };
}
