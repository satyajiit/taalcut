// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The corresponding sources hosted beside a component (`<id>/<version>/source/…`): the exact source of every
 * copyleft piece in it, and Taalcut's own build scripts when Taalcut built it. A plan source is
 * { file, what, pin } (an upstream file, by its pin) or { file, what, repo: { paths, exclude? } } (files from this
 * repository, packed with the components' archive recipe so the same files always make the same bytes). A key
 * never changes, so once a repo source is hosted, plan/hosted.mjs records its size and sha256 by key, and a later
 * release of that version fetches the hosted bytes instead of packing scripts that may have moved on; a new
 * version (a new key) packs them afresh.
 */
import { execFile } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { packTarZst } from './archive.mjs';
import { byteOrder } from './files.mjs';
import { addToCache, pinned } from './pinned.mjs';

const exec = promisify(execFile);

/** The repository's files under `paths` (tracked, or new and not ignored), minus `exclude`, in byte order. */
export async function repoFiles(repo, { paths, exclude }) {
  const { stdout } = await exec('git', ['ls-files', '-z', '-co', '--exclude-standard', '--', ...paths], {
    cwd: repo,
  });
  const skip = exclude ? new RegExp(exclude) : undefined;
  const files = [];
  for (const file of new Set(stdout.split('\0').filter(Boolean))) {
    if (skip?.test(file)) continue;
    const info = await stat(join(repo, file)).catch(() => undefined);
    if (info?.isFile()) files.push(file);
  }
  if (files.length === 0) throw new Error(`no files under ${paths.join(', ')}`);
  return files.sort(byteOrder);
}

/** Packs the repo source `spec` into `<into>/source.tar.zst` at the files' repository paths; returns the path. */
export async function packRepoSource(repo, spec, into) {
  const files = await repoFiles(repo, spec);
  const root = join(into, 'root');
  for (const file of files) {
    const target = join(root, file);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(repo, file), target);
    await chmod(target, (await stat(join(repo, file))).mode & 0o111 ? 0o755 : 0o644);
  }
  const out = join(into, 'source.tar.zst');
  await packTarZst({ root, out, layout: 'stream', entries: files });
  return out;
}

/**
 * The local path of a plan source's bytes: its pin's (cached or downloaded); for a repo source, the hosted bytes
 * when `hosted` (plan/hosted.mjs) records its key, else packed from the repository.
 */
export async function sourcePath(source, { key, base, hosted = {}, repo, pinOptions, scratch }) {
  if (source.pin) return pinned(source.pin, pinOptions);
  if (!source.repo) throw new Error(`${source.file}: a source needs a pin or repo paths`);
  if (hosted[key]) return pinned({ url: `${base}/${key}`, ...hosted[key] }, pinOptions);
  const packed = await packRepoSource(repo, source.repo, await mkdtemp(join(scratch, 'source-')));
  return addToCache(pinOptions.cacheDir, packed);
}
