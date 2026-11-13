// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { link, lstat, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { err, newId, ok, toTaalcutError, type AsyncResult } from '@taalcut/core';
import type { LibraryDatabase } from '../../db/database';
import { fsyncPath, writeDurably } from '../../files/durable-files';
import type { MediaCapturePlan } from './camera-profiles';
import { ImportSourceChanged, ImportVerificationFailed, ImportVolumeBusy } from './errors';
import { openSelectedOriginal } from './inventory';
import { copySelectedOriginal, hashCopiedFile, type CopyProgress } from './verified-copy';
import type { ImportSpaceCoordinator } from './space';
import { archiveGeneration, safeArchiveName } from './archive-identity';
import type { CaptureArchive } from './archive-types';

export type { ArchiveMember, CaptureArchive } from './archive-types';

/** A sidecar manifest lets a reimport recover a crash after durable files but before the receipt transaction. */
export async function archiveCapture(
  db: LibraryDatabase,
  capture: MediaCapturePlan,
  options: {
    readonly root: string;
    readonly sourceKey: string;
    readonly signal?: AbortSignal;
    readonly progress?: (fileName: string, progress: CopyProgress) => void;
    readonly space?: ImportSpaceCoordinator;
    readonly owner?: string;
    readonly volume?: string;
  },
): AsyncResult<CaptureArchive> {
  const familyKey = `${options.sourceKey}\0${capture.key}`;
  try {
    db.driver
      .prepare('INSERT INTO import_capture_locks (capture_key, pid) VALUES (?, ?)')
      .run(familyKey, process.pid);
  } catch {
    return err(ImportVolumeBusy());
  }
  try {
    const generation = await archiveGeneration(options.root, familyKey, capture, options.signal);
    if (!generation.ok) return generation;
    const { key, directory, previous, hashes } = generation.value;
    const manifestPath = join(directory, 'capture.json');
    await mkdir(directory, { recursive: true });
    const archiveId = previous?.id ?? newId<'CaptureGroup'>();
    const members = new Map((previous?.members ?? []).map((member) => [member.name, member]));
    for (const [name, member] of members) {
      const current = await existingOriginal(join(directory, name), options.signal);
      if (!current.ok) return current;
      if (current.value === null) members.delete(name);
      else if (current.value !== member.sha256) return err(ImportVerificationFailed());
    }
    for (const file of capture.files) {
      if (!safeArchiveName(file.name)) return err(ImportSourceChanged());
      const destination = join(directory, file.name);
      const prior = members.get(file.name);
      if (prior) {
        const original = await openSelectedOriginal(file);
        if (!original.ok) return original;
        await original.value.close();
        const hash = await hashCopiedFile(file.path, options.signal);
        if (!hash.ok) return hash;
        if (hash.value !== prior.sha256) return err(ImportSourceChanged());
        options.progress?.(file.name, { bytes: file.sizeBytes, stage: 'verifying' });
        continue;
      }
      const temp = `${destination}.incoming`;
      await rm(temp, { force: true });
      const reserve =
        options.space && options.owner && options.volume
          ? await options.space.reserve(options.owner, options.volume, directory, file.sizeBytes)
          : undefined;
      if (reserve && !reserve.ok) return reserve;
      const copied = await copySelectedOriginal(file, temp, {
        ...(options.signal ? { signal: options.signal } : {}),
        progress: (progress) => options.progress?.(file.name, progress),
        afterChunk: (bytes) => {
          if (options.owner) options.space?.consume(options.owner, bytes);
        },
      });
      if (!copied.ok) return copied;
      if (copied.value.sha256 !== hashes.get(file.name)) {
        await rm(temp, { force: true });
        return err(ImportSourceChanged());
      }
      const existing = await existingOriginal(destination, options.signal);
      if (!existing.ok) {
        await rm(temp, { force: true });
        return existing;
      }
      if (existing.value !== null && existing.value !== copied.value.sha256) {
        await rm(temp, { force: true });
        return err(ImportSourceChanged());
      }
      if (existing.value === null) await link(temp, destination);
      await rm(temp, { force: true });
      await fsyncPath(directory);
      members.set(file.name, {
        name: file.name,
        sha256: copied.value.sha256,
        sizeBytes: copied.value.bytes,
        required: capture.requiredNames.includes(file.name),
      });
      // Save every member, so a disconnect midway does not lose the capture's durable receipt.
      await saveManifest();
    }
    return ok(await saveManifest());

    async function saveManifest(): Promise<CaptureArchive> {
      const requiredNames = [...new Set([...(previous?.requiredNames ?? []), ...capture.requiredNames])];
      const missingNames = requiredNames.filter((name) => !members.has(name));
      const manifest: CaptureArchive = {
        id: archiveId,
        key,
        familyKey,
        profile: capture.profile,
        directory,
        members: [...members.values()],
        requiredNames,
        missingNames,
        completeness: missingNames.length
          ? 'incomplete'
          : capture.completeness === 'unknown'
            ? 'unknown'
            : 'complete',
        warnings: capture.warnings,
      };
      await writeDurably(manifestPath, JSON.stringify(manifest));
      await fsyncPath(directory);
      db.driver
        .prepare(
          `INSERT INTO capture_archives (id, capture_key, manifest, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(capture_key) DO UPDATE SET manifest = excluded.manifest, updated_at = excluded.updated_at`,
        )
        .run(manifest.id, key, JSON.stringify(manifest), db.clock());
      return manifest;
    }
  } catch (cause) {
    return err(toTaalcutError(cause));
  } finally {
    if (options.owner) options.space?.release(options.owner);
    db.driver
      .prepare('DELETE FROM import_capture_locks WHERE capture_key = ? AND pid = ?')
      .run(familyKey, process.pid);
  }
}

async function existingOriginal(path: string, signal?: AbortSignal): AsyncResult<string | null> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) return err(ImportVerificationFailed());
    return await hashCopiedFile(path, signal);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return ok(null);
    return err(toTaalcutError(cause));
  }
}
