// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Writes a compiled composition into a folder: text files written, media,
 * fonts and audio hard-linked (copied across volumes or from virtual archives),
 * because the producer's file server and main's app://preview handler both
 * serve exactly one folder and refuse links that point outside it.
 */
import { copyFile, link, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { CompositionBundle } from '../compile/composition';

function inside(dir: string, path: string): string {
  const root = resolve(dir);
  const target = resolve(root, path);
  if (!target.startsWith(root + sep)) throw new Error(`Bundle path escapes its folder: ${path}`);
  return target;
}

async function linkOrCopy(source: string, target: string): Promise<'link' | 'copy'> {
  await rm(target, { force: true });
  try {
    await link(source, target);
    return 'link';
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    // Packaged runtimes are readable inside app.asar, but cannot be native hard links. Electron's
    // archive-aware copy reads them; a genuinely missing source still fails at the copy.
    if (!['EXDEV', 'EPERM', 'EMLINK', 'ENOTDIR', 'ENOENT'].includes(code ?? '')) throw cause;
    await copyFile(source, target);
    return 'copy';
  }
}

/** Writes `bundle` into `dir` (created if needed); returns how many links had to be copies. */
export async function writeBundle(
  bundle: Pick<CompositionBundle, 'files' | 'links'>,
  dir: string,
): Promise<{ copies: number }> {
  await mkdir(dir, { recursive: true });
  for (const [path, content] of Object.entries(bundle.files)) {
    const target = inside(dir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  let copies = 0;
  for (const [path, entry] of Object.entries(bundle.links)) {
    const target = inside(dir, path);
    await mkdir(dirname(target), { recursive: true });
    if ((await linkOrCopy(entry.source, target)) === 'copy') copies += 1;
  }
  return { copies };
}

/** A bundle path joined onto a folder (for tests and the preview manifest). */
export const bundlePath = (dir: string, path: string) => join(dir, ...path.split('/'));
