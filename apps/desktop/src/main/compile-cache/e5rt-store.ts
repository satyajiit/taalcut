// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where Core ML keeps the mac helper's compiles, and how a part of it is let go (IX3-B6). Found by listing, never by
 * reading Apple's files (desktop SPEC, "Core ML compile cache"): Core ML's on-device compiles for a process live in
 * `~/Library/Caches/<process name>/com.apple.e5rt.e5bundlecache/<OS build>/<key>` (every Taalcut helper, packaged or
 * not, is `taalcut-mac-helper`); one folder per OS build (`kern.osversion`), and macOS keeps an older build's folder
 * after an update; inside, opaque digest-named entries whose link to a model path is only inside Apple's own files.
 * So this store works at the build-folder grain. A folder is let go in two steps: renamed beside the cache at once
 * (Core ML never looks there), then deleted in the background, so a start never waits on gigabytes of deletes. A
 * rename left by an interrupted delete is deleted at the next start. Only real folders are listed and moved: a
 * symbolic link in the cache, or a cache that is one, is never followed (IX3-F5, M6).
 */
import { lstatSync, readdirSync, renameSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const E5RT_FOLDER = 'com.apple.e5rt.e5bundlecache';
const HELPER_PROCESS = 'taalcut-mac-helper';
const DISCARDED = '.taalcut-discarded-';

/** The helper's Core ML compile cache under the user's home. */
export const helperCompileCache = (home: string): string =>
  join(home, 'Library', 'Caches', HELPER_PROCESS, E5RT_FOLDER);

export interface CompileStore {
  readonly root: string;
  /** The OS build folders in the cache; empty without one. */
  builds(): string[];
  /** Takes a build folder out of Core ML's sight now; the promise is its deletion. */
  discard(build: string): Promise<void>;
  /** Deletes what an earlier start renamed and did not finish deleting. */
  discardLeftovers(): Promise<void>;
}

/** A real folder: not a symbolic link, not missing. */
const realFolder = (path: string) => lstatSync(path, { throwIfNoEntry: false })?.isDirectory() === true;

export function e5rtStore(root: string, now: () => number = Date.now): CompileStore {
  const parent = dirname(root);
  // A Dirent never follows a link, and a dangling one is no folder.
  const folders = (dir: string) =>
    realFolder(dir)
      ? readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      : [];
  return {
    root,
    builds: () => (realFolder(parent) ? folders(root) : []),
    discard(build) {
      const from = join(root, build);
      if (!realFolder(parent) || !realFolder(root) || !realFolder(from))
        return Promise.reject(new Error(`${from} is not a folder of the compile cache`));
      const moved = join(parent, `${DISCARDED}${build}-${now()}`);
      renameSync(from, moved);
      return rm(moved, { recursive: true, force: true });
    },
    async discardLeftovers() {
      const left = folders(parent).filter((name) => name.startsWith(DISCARDED));
      await Promise.all(left.map((name) => rm(join(parent, name), { recursive: true, force: true })));
    },
  };
}
