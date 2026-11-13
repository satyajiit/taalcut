// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Whether something is at a path. Only "no such file" means absent; any other failure throws. */
import type { Stats } from 'node:fs';
import { stat } from 'node:fs/promises';

async function statIfPresent(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return null;
    throw cause;
  }
}

/** A file or folder is there. */
export async function exists(path: string): Promise<boolean> {
  return (await statIfPresent(path)) !== null;
}

/** A regular file is there. */
export async function isFile(path: string): Promise<boolean> {
  return (await statIfPresent(path))?.isFile() ?? false;
}
