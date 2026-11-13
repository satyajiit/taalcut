// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { CancelledError, err, ok, toTaalcutError, type AsyncResult } from '@taalcut/core';
import type { CaptureArchive } from './archive-types';
import type { CaptureFile, MediaCapturePlan } from './camera-profiles';
import { ImportSourceChanged, ImportVerificationFailed } from './errors';
import { openSelectedOriginal, sameLocalFile } from './inventory';

export const safeArchiveName = (name: string) =>
  name === basename(name) && !name.startsWith('.') && !/[\\\0]/.test(name);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Hash the validated handle, so replacement between validation and reading cannot select a generation. */
async function sourceHash(file: CaptureFile, signal?: AbortSignal): AsyncResult<string> {
  const opened = await openSelectedOriginal(file);
  if (!opened.ok) return opened;
  try {
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let size = 0;
    for (;;) {
      if (signal?.aborted) return err(CancelledError());
      const { bytesRead } = await opened.value.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      hash.update(buffer.subarray(0, bytesRead));
    }
    return size === file.sizeBytes && sameLocalFile(file, await opened.value.stat())
      ? ok(hash.digest('hex'))
      : err(ImportSourceChanged());
  } catch (cause) {
    return err(toTaalcutError(cause));
  } finally {
    await opened.value.close();
  }
}

export interface ArchiveGeneration {
  readonly key: string;
  readonly directory: string;
  readonly previous?: CaptureArchive;
  readonly hashes: ReadonlyMap<string, string>;
}

/** Names locate a capture family; matching content locates a recording within that family. */
export async function archiveGeneration(
  root: string,
  familyKey: string,
  capture: MediaCapturePlan,
  signal?: AbortSignal,
): AsyncResult<ArchiveGeneration> {
  const family = join(root, 'Camera originals', digest(familyKey));
  try {
    const hashes = new Map<string, string>();
    for (const file of capture.files) {
      if (!safeArchiveName(file.name)) return err(ImportSourceChanged());
      const hash = await sourceHash(file, signal);
      if (!hash.ok) return hash;
      hashes.set(file.name, hash.value);
    }
    const entries = await readdir(family, { withFileTypes: true }).catch((cause: unknown) => {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw cause;
    });
    // Include the original layout. Reading manifests also recovers a crash before the SQLite receipt.
    const directories = [
      family,
      ...entries.filter((entry) => entry.isDirectory()).map((entry) => join(family, entry.name)),
    ];
    const compatible: { archive: CaptureArchive; matches: number }[] = [];
    const repairs: CaptureArchive[] = [];
    for (const directory of directories) {
      const saved = await readFile(join(directory, 'capture.json'), 'utf8').catch((cause: unknown) => {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw cause;
      });
      if (saved === null) continue;
      const archive = JSON.parse(saved) as CaptureArchive;
      if (
        (archive.familyKey ?? archive.key) !== familyKey ||
        archive.directory !== directory ||
        !archive.members.every((member) => safeArchiveName(member.name))
      )
        return err(ImportVerificationFailed());
      const shared = archive.members.filter((member) => hashes.has(member.name));
      if (shared.some((member) => hashes.get(member.name) !== member.sha256)) continue;
      if (shared.length) compatible.push({ archive, matches: shared.length });
      else if (
        archive.completeness === 'incomplete' &&
        capture.files.length > 0 &&
        capture.files.every((file) => archive.missingNames.includes(file.name))
      )
        repairs.push(archive);
    }
    const best = Math.max(0, ...compatible.map((candidate) => candidate.matches));
    const matches = compatible.filter((candidate) => candidate.matches === best);
    const generation = digest(JSON.stringify([...hashes].sort(([a], [b]) => a.localeCompare(b))));
    const directory = join(family, generation);
    // Never merge an unidentifiable companion into one of several recordings with reused names.
    const previous =
      compatible.find((candidate) => candidate.archive.directory === directory)?.archive ??
      (matches.length === 1
        ? matches[0]!.archive
        : !matches.length && repairs.length === 1
          ? repairs[0]
          : undefined);
    return ok({
      key: previous?.key ?? `${familyKey}\0${generation}`,
      directory: previous?.directory ?? directory,
      ...(previous ? { previous } : {}),
      hashes,
    });
  } catch (cause) {
    return err(toTaalcutError(cause));
  }
}
