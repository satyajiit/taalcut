// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { CancelledError, err, newId, ok, toTaalcutError, type AsyncResult } from '@taalcut/core';
import { redactText } from '@taalcut/library';
import type { CreationDirectorySnapshot } from '@taalcut/tools';
import { resolveCreationDirectory } from '../../shared/creation-grants';
import { EXCLUDED_SOURCE_ENTRY, sourceEntryCurrent } from '../../shared/source-containment';

const TEXT = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.html',
  '.css',
  '.svg',
  '.toml',
]);
export const creationSnapshotRoot = (userData: string) => join(userData, 'creation', 'snapshots');

/** A bounded copy of regular files. No directory symlink or credential file enters the execution snapshot. */
export async function snapshotCreationDirectory(
  userData: string,
  accessId: string,
  signal: AbortSignal,
): AsyncResult<CreationDirectorySnapshot> {
  const grant = await resolveCreationDirectory(userData, accessId);
  if (!grant.ok) return grant;
  const id = newId<'CreationSnapshot'>();
  const root = join(creationSnapshotRoot(userData), id);
  const files: { path: string; text: string }[] = [];
  const hash = createHash('sha256');
  let bytes = 0;
  let count = 0;
  let textBytes = 0;
  const walk = async (relative: string, depth: number): Promise<void> => {
    if (signal.aborted) throw new Error('cancelled');
    if (depth > 24) return;
    const directory = join(grant.value, relative);
    if (!(await sourceEntryCurrent(grant.value, directory)))
      throw new Error('The source directory changed during capture');
    const entries = await readdir(directory, { withFileTypes: true });
    const priority = (name: string) =>
      /^(?:package\.json|readme(?:\.[a-z]+)?|pnpm-workspace\.yaml)$/i.test(name)
        ? 0
        : /^(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/.test(name)
          ? 1
          : 2;
    entries.sort((a, b) => priority(a.name) - priority(b.name) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (signal.aborted) throw new Error('cancelled');
      if (EXCLUDED_SOURCE_ENTRY.test(entry.name) || entry.isSymbolicLink()) continue;
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (++count > 10_000) throw new Error('The source exceeds the 10,000-file snapshot limit');
      const absolute = join(grant.value, path);
      if (!(await sourceEntryCurrent(grant.value, absolute)))
        throw new Error('The source file moved during capture');
      const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > 16 * 1024 * 1024) continue;
        bytes += info.size;
        if (bytes > 256 * 1024 * 1024) throw new Error('The source exceeds the 256 MiB snapshot limit');
        if (!(await sourceEntryCurrent(grant.value, absolute, info)))
          throw new Error('The source file moved during capture');
        const data = Buffer.alloc(info.size + 1);
        const { bytesRead } = await handle.read(data);
        if (bytesRead !== info.size || !(await sourceEntryCurrent(grant.value, absolute, info)))
          throw new Error('The source file changed during capture');
        const contents = data.subarray(0, bytesRead);
        await mkdir(dirname(join(root, 'source', path)), { recursive: true });
        await writeFile(join(root, 'source', path), contents, { flag: 'wx', mode: 0o600 });
        hash.update(path).update('\0').update(createHash('sha256').update(contents).digest());
        if (/^(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/.test(path)) {
          // The planner needs lockfile presence; execution reads the complete copy, not research text.
          files.push({ path, text: '' });
        } else if (TEXT.has(extname(path)) && info.size <= 256 * 1024 && textBytes < 2 * 1024 * 1024) {
          const text = redactText(contents.toString('utf8'));
          textBytes += Buffer.byteLength(text);
          files.push({ path, text });
        }
      } finally {
        await handle.close();
      }
    }
  };
  try {
    await mkdir(join(root, 'source'), { recursive: true });
    await walk('', 0);
    const snapshot = { id, files, digest: hash.digest('hex') };
    await writeFile(join(root, 'manifest.json'), JSON.stringify(snapshot), { flag: 'wx', mode: 0o600 });
    return ok(snapshot);
  } catch (cause) {
    await rm(root, { recursive: true, force: true });
    return signal.aborted ? err(CancelledError()) : err(toTaalcutError(cause));
  }
}
