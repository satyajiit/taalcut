// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's GeneratedAssetSink (P3-B6, P3-B7, P3-V6) for the agent and jobs processes: voice lines, music, sound
 * effects and stills a provider made, and bundled-pack items, enter the library unchanged.
 *
 * The bytes are hashed (BLAKE3, the library's identity) and de-duplicated first: the same bytes again are the
 * same asset (`duplicate: true`), and an asset the library had without a readable copy gains this one. New bytes
 * are written content-addressed under the originals root (generated-paths.ts), then the asset, its provenance and
 * its managed location commit in one transaction. The indexing pipeline seeds every new asset on its next poll,
 * so the file is probed and analysed like an import. A file this call wrote is removed again if its row didn't
 * commit and nothing else points at it. A file whose words the generator knows (a voice line) lands with them as
 * the asset's transcript, and indexing doesn't transcribe it (generated-transcript.ts).
 */
import { stat, rm } from 'node:fs/promises';
import { relative, sep } from 'node:path';
import {
  CancelledError,
  err,
  ok,
  toTaalcutError,
  type AssetId,
  type AsyncResult,
  type EventBus,
  type GeneratedAssetSink,
  type GeneratedFile,
  type RecordedFile,
  type Result,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { exists } from '../files/file-presence';
import { createWasmContentHasher, hashBytes, type ContentHasher } from '../hashing/content-hasher';
import { inTransaction } from '../repositories/shared';
import { assetKindOf, checkGeneratedFile, extensionOf } from './generated-file';
import { probeGeneratedMedia } from './generated-media';
import { generatedPath, rootOnline, writeInPlace } from './generated-paths';
import { keepTranscript } from './generated-transcript';
import {
  addKeptCopy,
  keptCopyOf,
  recordGenerated,
  retainRecording,
  touchGenerated,
  type GeneratedRecord,
} from './generated-record';

export interface GeneratedAssetSinkOptions {
  /** The managed originals root: a path, or a function reading the setting each time. */
  readonly originalsRoot: string | (() => string | Promise<string>);
  readonly hasher?: ContentHasher;
  readonly events?: Pick<EventBus, 'emit'>;
}

type Outcome = { readonly assetId: AssetId; readonly contentHash: string; readonly duplicate: boolean };

const cancelled = (signal: AbortSignal | undefined) => signal?.aborted === true;

export function createGeneratedAssetSink(
  db: LibraryDatabase,
  options: GeneratedAssetSinkOptions,
): GeneratedAssetSink {
  const hasher = options.hasher ?? createWasmContentHasher();
  const rootOf = async () =>
    typeof options.originalsRoot === 'string' ? options.originalsRoot : options.originalsRoot();

  /** Whether any location still names the file (another process kept the same bytes at the same path). */
  const named = (path: string) =>
    db.driver
      .prepare('SELECT 1 AS hit FROM asset_locations WHERE absolute_path_cached = ? LIMIT 1')
      .get(path) !== undefined;

  /** Writes the file and commits its rows; returns the asset, new or the one the bytes already were. */
  async function keep(
    file: GeneratedFile | RecordedFile,
    root: string,
    contentHash: string,
  ): AsyncResult<Outcome> {
    const target = generatedPath(root, contentHash, extensionOf(file.mediaType));
    const existed = await exists(target);
    await writeInPlace(target, file.bytes);
    const partial = await hasher.partial(target);
    if (!partial.ok) return partial;
    const facts = await stat(target);
    const probe = probeGeneratedMedia(file.bytes, file.mediaType);
    const record: GeneratedRecord = {
      root,
      relativePath: relative(root, target).split(sep).join('/'),
      absolutePath: target,
      kind: assetKindOf(file.mediaType),
      fileName: file.fileName,
      sizeBytes: facts.size,
      mtimeMs: Math.trunc(facts.mtimeMs),
      contentHash,
      partialHash: partial.value,
      provenance: file.provenance,
      projectId: file.projectId,
      width: probe.width,
      height: probe.height,
      orientation: probe.orientation,
      duration: 'duration' in file ? file.duration : probe.duration,
    };
    const committed = inTransaction(db, 'asset', (): Result<Outcome> => {
      // Again inside the transaction: the agent and jobs processes may keep the same bytes at once.
      const kept = keptCopyOf(db, contentHash);
      const assetId = kept?.readable
        ? ok(kept.assetId)
        : kept
          ? addKeptCopy(db, kept.assetId, record)
          : recordGenerated(db, record);
      if (!assetId.ok) return assetId;
      if ('duration' in file) retainRecording(db, assetId.value, file.duration);
      const words = keepTranscript(db, assetId.value, file.transcript);
      return words.ok ? ok({ assetId: assetId.value, contentHash, duplicate: kept !== undefined }) : words;
    });
    if (!committed.ok && !existed && !named(target)) await rm(target, { force: true });
    return committed;
  }

  async function put(
    file: GeneratedFile | RecordedFile,
    signal: AbortSignal | undefined,
    recorded = false,
  ): AsyncResult<Outcome> {
    const checked = checkGeneratedFile(file, recorded);
    if (!checked.ok) return checked;
    if (cancelled(signal)) return err(CancelledError());
    const { blake3: contentHash } = await hashBytes(file.bytes);
    const known = keptCopyOf(db, contentHash);
    if (known?.readable) {
      const words = inTransaction(db, 'asset', () => {
        if ('duration' in file) retainRecording(db, known.assetId, file.duration);
        else touchGenerated(db, known.assetId);
        return keepTranscript(db, known.assetId, file.transcript);
      });
      return words.ok ? ok({ assetId: known.assetId, contentHash, duplicate: true }) : words;
    }
    const root = await rootOf();
    const online = await rootOnline(root);
    if (!online.ok) return online;
    if (cancelled(signal)) return err(CancelledError());
    const kept = await keep(file, root, contentHash);
    if (kept.ok && !kept.value.duplicate) {
      options.events?.emit('library.changed', {
        projectId: null,
        entity: 'asset',
        change: 'created',
        ids: [kept.value.assetId],
      });
    }
    return kept;
  }

  return {
    async putRecording(file) {
      try {
        return await put(file, undefined, true);
      } catch (cause) {
        return err(toTaalcutError(cause));
      }
    },
    async put(file, putOptions = {}) {
      try {
        return await put(file, putOptions.signal);
      } catch (cause) {
        return err(toTaalcutError(cause));
      }
    },
  };
}
