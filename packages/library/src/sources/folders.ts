// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which folders may become watched-folder sources (ADR 0001: referenced in
 * place, never copied). A folder is resolved with realpath, so `..` segments
 * and symlinks can't smuggle in a path the checks would refuse.
 */
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, normalize, resolve, sep } from 'node:path';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { FolderMissing, FolderNotAllowed, folderParams, NotAFolder } from './errors';

export interface FolderPolicy {
  /** Taalcut's own data, cache and library folders: never a source, nor anything inside them. */
  readonly protectedRoots: readonly string[];
  /** What `~` means in a path. Without it, `~` paths are refused. */
  readonly home?: string;
}

/**
 * The path as the user meant it, without touching the disk: `~` expanded,
 * `.`/`..` and doubled or trailing slashes removed, Unicode in NFC (macOS
 * file names arrive in either form). Undefined if it isn't absolute.
 */
export function normaliseFolderPath(path: string, home?: string): string | undefined {
  const text = path.trim().normalize('NFC');
  const expanded = text === '~' || text.startsWith('~/') ? (home ? home + text.slice(1) : undefined) : text;
  if (expanded === undefined || !isAbsolute(expanded)) return undefined;
  const clean = normalize(resolve(expanded));
  return clean.length > 1 && clean.endsWith(sep) ? clean.slice(0, -1) : clean;
}

/** The real, absolute folder behind `path`, or why it can't be a source. */
export async function resolveFolder(path: string, policy: FolderPolicy): AsyncResult<string> {
  const lexical = normaliseFolderPath(path, policy.home);
  if (lexical === undefined)
    return err(
      FolderNotAllowed(folderParams(path), { detail: 'Use an absolute path or one starting with ~/.' }),
    );
  let real: string;
  try {
    real = (await realpath(lexical)).normalize('NFC');
  } catch {
    return err(FolderMissing(folderParams(lexical)));
  }
  const info = await stat(real).catch(() => undefined);
  if (!info) return err(FolderMissing(folderParams(lexical)));
  if (!info.isDirectory()) return err(NotAFolder(folderParams(lexical)));
  if (real === sep)
    return err(FolderNotAllowed(folderParams(lexical), { detail: 'The whole disk is too broad.' }));
  for (const root of await realRoots(policy.protectedRoots)) {
    if (real === root || real.startsWith(root + sep)) {
      return err(FolderNotAllowed(folderParams(lexical), { detail: "Inside Taalcut's own data." }));
    }
  }
  return ok(real);
}

/** Protected roots as realpaths (on macOS /var is /private/var), or as written if they don't exist yet. */
async function realRoots(roots: readonly string[]): Promise<string[]> {
  return Promise.all(
    roots.map(async (root) => {
      const clean = normalize(resolve(root));
      return (await realpath(clean).catch(() => clean)).normalize('NFC');
    }),
  );
}
