// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { lstat, realpath } from 'node:fs/promises';
import { sep } from 'node:path';

/** A source entry must still name the opened inode inside the exact granted tree. */
export async function sourceEntryCurrent(root: string, path: string, opened?: { dev: number; ino: number }) {
  if (path !== root && !path.startsWith(`${root}${sep}`)) return false;
  try {
    if ((await realpath(path)) !== path) return false;
    if (!opened) return true;
    const current = await lstat(path);
    return current.isFile() && current.dev === opened.dev && current.ino === opened.ino;
  } catch {
    return false;
  }
}

export const EXCLUDED_SOURCE_ENTRY =
  /^(?:\.git|\.hg|\.svn|node_modules|\.next|\.nuxt|\.turbo|\.parcel-cache|\.svelte-kit|\.output|dist|build|coverage|\.cache|\.venv|venv|__pycache__|\.DS_Store|\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|\.ssh|\.aws|\.config|\.docker|\.kube|(?:credentials|secrets|service[-_]account)(?:\..*)?|.*\.(?:pem|key|p12|pfx|tfstate))$/i;
