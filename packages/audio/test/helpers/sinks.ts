// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** In-memory GeneratedAssetSink and derived-file writer for audio's tests. */
import { createHash } from 'node:crypto';
import { newId, ok, type AssetId, type GeneratedAssetSink, type GeneratedFile } from '@taalcut/core';
import type { DerivedFileWriter } from '../../src/music/warp-track';

export function memorySink(): GeneratedAssetSink & {
  readonly files: Map<AssetId, GeneratedFile & { contentHash: string }>;
} {
  const files = new Map<AssetId, GeneratedFile & { contentHash: string }>();
  return {
    files,
    async put(file) {
      const contentHash = createHash('sha256').update(file.bytes).digest('hex');
      for (const [assetId, stored] of files)
        if (stored.contentHash === contentHash) return ok({ assetId, contentHash, duplicate: true });
      const assetId = newId<'Asset'>();
      files.set(assetId, { ...file, contentHash });
      return ok({ assetId, contentHash, duplicate: false });
    },
  };
}

export function memoryDerived(): DerivedFileWriter & { readonly files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async put(key, bytes) {
      files.set(key, bytes);
      return ok(undefined);
    },
  };
}
