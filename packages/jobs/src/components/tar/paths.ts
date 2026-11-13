// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Extraction path checks that look at the disk, not only at the string.
 * `path.resolve` does not see links: a link made by an earlier entry can turn
 * a name that looks inside the folder into a place outside it. So folders are
 * made one level at a time and a link on the way is refused, files are opened
 * with O_NOFOLLOW, and every link target is walked the way the kernel will
 * follow it once all the links exist.
 */
import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, readlink, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { isErrnoException } from '../fs-util';
import { TarError } from './byte-reader';

/** Links followed for one target before it counts as a loop (macOS allows 32). */
const MAX_LINK_HOPS = 32;

const WRITE_NO_FOLLOW = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW;

export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel));
}

function throughLink(root: string, path: string): TarError {
  return new TarError(`'${relative(root, path)}' is a link, and nothing is extracted through a link`);
}

/**
 * Makes the folder `dir`, whose parent is already a real folder inside `root`.
 * If something is there already it must be a real folder: a link is refused,
 * never followed.
 */
export async function makeRealDir(root: string, dir: string): Promise<void> {
  if (!isInside(root, dir)) throw new TarError(`'${dir}' is outside the component folder`);
  try {
    await mkdir(dir, { mode: 0o755 });
    return;
  } catch (cause) {
    if (!isErrnoException(cause, 'EEXIST')) throw cause;
  }
  const stat = await lstat(dir);
  if (stat.isSymbolicLink()) throw throughLink(root, dir);
  if (!stat.isDirectory()) throw new TarError(`'${relative(root, dir)}' is a file, not a folder`);
}

/** Opens `path` (in a real folder inside `root`) for writing, refusing a link already at that name. */
export async function openNoFollow(root: string, path: string, mode: number): Promise<FileHandle> {
  try {
    return await open(path, WRITE_NO_FOLLOW, mode);
  } catch (cause) {
    if (isErrnoException(cause, 'ELOOP')) throw throughLink(root, path);
    throw cause;
  }
}

async function lstatOrMissing(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch (cause) {
    if (isErrnoException(cause, 'ENOENT') || isErrnoException(cause, 'ENOTDIR')) return undefined;
    throw cause;
  }
}

/**
 * Follows the link at `link` (in a real folder inside `root`) segment by
 * segment, through any links on the way, and throws if a step leaves `root`.
 * Each step is checked against a path with no links in it, so a lexical
 * check is enough there. Where a segment does not exist the walk goes on by
 * name, so a dangling link is fine only while its whole path stays inside.
 */
export async function checkLinkStaysInside(root: string, link: string): Promise<void> {
  const outside = () => new TarError(`symlink '${relative(root, link)}' points outside the component folder`);
  let at = dirname(link);
  const pending = (await readlink(link)).split('/');
  let hops = 0;
  while (pending.length > 0) {
    const segment = pending.shift()!;
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      at = dirname(at);
      if (!isInside(root, at)) throw outside();
      continue;
    }
    const next = join(at, segment);
    const stat = await lstatOrMissing(next);
    if (stat?.isSymbolicLink()) {
      if (++hops > MAX_LINK_HOPS) throw new TarError(`symlink '${relative(root, link)}' loops`);
      const target = await readlink(next);
      if (isAbsolute(target)) throw outside();
      pending.unshift(...target.split('/')); // relative to the folder holding that link: `at`
      continue;
    }
    at = next;
  }
}
