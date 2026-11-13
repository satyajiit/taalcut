// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The content-addressed asset half of the memory Template and Style stores: bytes by sha256, each with what
 * its store keeps beside them (when it was put, its media type). `putAsset` and `assetPath` behave as the
 * library's stores do; a second put of the same bytes keeps the first entry.
 */
import { err, NotFoundError, ok, type AsyncResult } from '@taalcut/core';
import { sha256Hex } from '../store/change-key';

export type MemoryAsset<Extra> = { readonly bytes: Uint8Array } & Extra;

export interface MemoryAssets<Extra> {
  put(bytes: Uint8Array, extra: Extra): AsyncResult<{ readonly sha256: string; readonly bytes: number }>;
  path(sha256: string): AsyncResult<string>;
  bytes(sha256: string): Uint8Array | undefined;
  remove(sha256: string): void;
  entries(): [string, MemoryAsset<Extra>][];
}

/** `scheme` names the store in the `memory://<scheme>/<sha256>` path. */
export function createMemoryAssets<Extra>(
  scheme: string,
  restored: Iterable<readonly [string, MemoryAsset<Extra>]> = [],
): MemoryAssets<Extra> {
  const assets = new Map<string, MemoryAsset<Extra>>();
  for (const [sha256, asset] of restored)
    assets.set(sha256, { ...asset, bytes: Uint8Array.from(asset.bytes) });
  return {
    async put(bytes, extra) {
      const sha256 = sha256Hex(bytes);
      if (!assets.has(sha256)) assets.set(sha256, { ...extra, bytes: new Uint8Array(bytes) });
      return ok({ sha256, bytes: bytes.byteLength });
    },
    async path(sha256) {
      return assets.has(sha256)
        ? ok(`memory://${scheme}/${sha256}`)
        : err(NotFoundError({ entity: 'asset' }));
    },
    bytes: (sha256) => assets.get(sha256)?.bytes,
    remove(sha256) {
      assets.delete(sha256);
    },
    entries: () => [...assets.entries()],
  };
}
