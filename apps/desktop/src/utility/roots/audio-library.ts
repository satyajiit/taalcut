// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Audio's Phase 3 ports over the library and the media cache, for the agent and jobs processes (packages/audio
 * SPEC P3.5, P3.7): an asset's file, content hash and stored transcript (the speech cleanup analysis reads them),
 * derived JSON (the analyses) and derived files (warped music) in media's cache under core's derived keys, and the
 * folder of an installed component.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DERIVED_KEY_PATTERN,
  err,
  NotFoundError,
  ok,
  ValidationError,
  type AssetId,
  type Container,
} from '@taalcut/core';
import type { AssetHashes, DerivedFileWriter, DerivedJson, SpeechAssetReader } from '@taalcut/audio';
import { installedComponentDirSync } from '@taalcut/jobs';
import {
  createAssetLocationRepository,
  createAssetRepository,
  createTranscriptRepository,
} from '@taalcut/library';
import type { DerivedCache } from '@taalcut/media';
import { LibraryDatabaseToken } from '../../shared/tokens';

/** `<components root>/<id>/<file>` when the component is installed, else undefined. */
export function installedComponentFile(userData: string, id: string, file?: string): string | undefined {
  const dir = installedComponentDirSync(join(userData, 'components'), id);
  return dir ? (file ? join(dir, file) : dir) : undefined;
}

/** A BLAKE3 content hash, once the library has hashed the asset's bytes. */
function contentHashOf(container: Container, assetId: AssetId): string | null {
  const asset = createAssetRepository(container.resolve(LibraryDatabaseToken)).get(assetId);
  return asset.ok ? asset.value.contentHash : null;
}

export function libraryAssetHashes(container: Container): AssetHashes {
  return {
    contentHash: async (assetId) => {
      if (!container.has(LibraryDatabaseToken)) return ok(null);
      return ok(contentHashOf(container, assetId));
    },
  };
}

/** The asset's present file, content hash and stored transcript, for `audio.analyzeSpeech` in the jobs process. */
export function librarySpeechAssets(container: Container): SpeechAssetReader {
  return {
    async facts(assetId) {
      const db = container.resolve(LibraryDatabaseToken);
      const location = createAssetLocationRepository(db)
        .listByAsset(assetId)
        .find((found) => found.state === 'present' && found.absolutePathCached);
      if (!location?.absolutePathCached) return err(NotFoundError({ entity: 'asset file', id: assetId }));
      const contentHash = contentHashOf(container, assetId);
      // The analysis is keyed by the content hash: one is made once the background hash has run.
      if (!contentHash) return err(NotFoundError({ entity: 'asset content hash', id: assetId }));
      const transcript = createTranscriptRepository(db).get(assetId);
      return ok({ path: location.absolutePathCached, contentHash, transcript });
    },
  };
}

const checkedKey = (key: string) =>
  DERIVED_KEY_PATTERN.test(key) ? ok(key) : err(ValidationError({ field: 'key' }, { detail: key }));

/** Derived JSON in media's cache (speech cleanup analyses). A missing file reads as not found. */
export function cacheJson(cache: () => DerivedCache): DerivedJson {
  return {
    async read(key) {
      const valid = checkedKey(key);
      if (!valid.ok) return valid;
      const path = cache().absPath(key);
      if (!path) return err(NotFoundError({ entity: 'derived file', id: key }));
      try {
        return ok(JSON.parse(await readFile(path, 'utf8')) as unknown);
      } catch {
        return err(NotFoundError({ entity: 'derived file', id: key }));
      }
    },
    async write(key, json) {
      const valid = checkedKey(key);
      if (!valid.ok) return valid;
      const put = await cache().put(key, JSON.stringify(json));
      return put.ok ? ok(undefined) : put;
    },
  };
}

/** Derived files in media's cache (warped music). */
export function cacheFiles(cache: () => DerivedCache): DerivedFileWriter {
  return {
    async put(key, bytes) {
      const valid = checkedKey(key);
      if (!valid.ok) return valid;
      const put = await cache().put(key, Buffer.from(bytes));
      return put.ok ? ok(undefined) : put;
    },
  };
}
