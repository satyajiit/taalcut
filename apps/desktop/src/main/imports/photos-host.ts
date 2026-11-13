// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdir, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { err, toTaalcutError, type AsyncResult, type Result } from '@taalcut/core';
import { createJsonLineSidecar } from '@taalcut/media';
import { createApplePhotosPort, type ApplePhotosPort } from '../../platform/photos';
import { macHelperResolver } from '../../utility/roots/mac-helper-resolver';

/** Construction is inert; status is read-only and Connect is the sole permission request. */
export function createPhotosHost(options: {
  readonly packaged: boolean;
  readonly resourcesPath: string;
  readonly originalsRoot: () => Promise<string>;
  readonly localOnly: () => boolean;
  /** PhotoKit deliberately hides original paths; its reads conservatively hold every removable volume. */
  readonly readLease?: () => Result<() => void>;
}): ApplePhotosPort {
  const opened = new Map<string, Promise<ApplePhotosPort>>();
  const open = async (staging: string) => {
    await mkdir(staging, { recursive: true });
    const resolved = await macHelperResolver(options).resolve();
    if (!resolved.ok) throw Object.assign(new Error(resolved.error.code), { code: resolved.error.code });
    const sidecar = createJsonLineSidecar({
      command: resolved.value.path,
      args: ['serve', '--services', 'photos', '--allow-root', await realpath(staging), '--idle-exit', '0'],
      readyTimeoutMs: 15000,
    });
    return createApplePhotosPort(sidecar, { localOnly: options.localOnly });
  };
  const call = async <T>(
    action: (port: ApplePhotosPort) => AsyncResult<T>,
    requestedRoot?: string,
  ): AsyncResult<T> => {
    const root = requestedRoot ?? join(await options.originalsRoot(), '.incoming');
    try {
      let host = opened.get(root);
      if (!host) {
        host = open(root);
        opened.set(root, host);
      }
      return await action(await host);
    } catch (cause) {
      opened.delete(root);
      return err(toTaalcutError(cause));
    }
  };
  const reading = async <T>(action: () => AsyncResult<T>): AsyncResult<T> => {
    const lease = options.readLease?.();
    if (lease && !lease.ok) return lease;
    try {
      return await action();
    } finally {
      if (lease?.ok) lease.value();
    }
  };
  return {
    status: (signal) => call((port) => port.status(signal)),
    connect: (signal) => call((port) => port.connect(signal)),
    list: (input) => reading(() => call((port) => port.list(input))),
    thumbnail: (assetId, dest, signal) =>
      reading(() => call((port) => port.thumbnail(assetId, dest, signal), dirname(dest))),
    exportOriginal: (input) => reading(() => call((port) => port.exportOriginal(input), dirname(input.dest))),
    async close() {
      await Promise.all([...opened.values()].map(async (host) => (await host.catch(() => null))?.close()));
      opened.clear();
    },
  };
}
