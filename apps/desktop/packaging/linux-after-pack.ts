// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * afterPack on Linux, before fpm makes the .deb from the unpacked app:
 *
 * 1. Every mode is normalised the way Debian packages have them, whatever the builder's umask left: folders and
 *    executables 0755, every other file (shared libraries included: the loader maps them without the x bit)
 *    0644. chrome-sandbox becomes 4755 at install time (the postinst), as only root can make it so.
 * 2. The packed FFmpeg is checked against media's pin (linux-ffmpeg.ts).
 *
 * Links are left alone: their own mode means nothing.
 */
import { chmodSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AfterPackContext } from 'electron-builder';
import { checkPackedFfmpeg } from './linux-ffmpeg';

const SHARED_LIBRARY = /\.so(\.\d+)*$/;

/** The mode a file or folder gets in the package. */
export function debMode(name: string, mode: number, directory: boolean): number {
  if (directory) return 0o755;
  if (SHARED_LIBRARY.test(name)) return 0o644;
  return mode & 0o111 ? 0o755 : 0o644;
}

/** Sets debMode on everything under `dir`; returns how many modes changed. */
export function normaliseModes(dir: string): number {
  let changed = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) continue;
    const wanted = debMode(name, stat.mode, stat.isDirectory());
    if ((stat.mode & 0o7777) !== wanted) {
      chmodSync(path, wanted);
      changed += 1;
    }
    if (stat.isDirectory()) changed += normaliseModes(path);
  }
  return changed;
}

export async function linuxAfterPack(
  context: Pick<AfterPackContext, 'electronPlatformName' | 'appOutDir'>,
  log: (message: string) => void = console.warn,
): Promise<void> {
  if (context.electronPlatformName !== 'linux') return;
  log(`normalised ${normaliseModes(context.appOutDir)} file modes for the package`);
  await checkPackedFfmpeg(context, { log });
}
