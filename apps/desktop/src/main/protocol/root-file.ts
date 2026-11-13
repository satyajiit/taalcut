// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The file check app:// uses (planAppRequest's `isFile`). resolve.ts keeps the
 * request path inside the root, but a symlink inside the root can still point
 * anywhere. So the check follows every link with realpath and accepts a
 * regular file only if its real path is under the root's real path. A link to
 * another file inside the build is fine.
 */
import { realpathSync, statSync } from 'node:fs';
import { sep } from 'node:path';

export function fileSizeUnderRoot(rootDir: string): (path: string) => number | undefined {
  let realRoot: string | undefined;
  return (path) => {
    try {
      realRoot ??= realpathSync(rootDir);
      const real = realpathSync(path);
      if (!real.startsWith(realRoot.endsWith(sep) ? realRoot : realRoot + sep)) return undefined;
      const stat = statSync(real);
      return stat.isFile() ? stat.size : undefined;
    } catch {
      return undefined;
    }
  };
}

export function fileUnderRoot(rootDir: string): (path: string) => boolean {
  const sizeOf = fileSizeUnderRoot(rootDir);
  return (path) => sizeOf(path) !== undefined;
}
