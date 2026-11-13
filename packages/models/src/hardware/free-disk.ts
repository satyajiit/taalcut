// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Free space on the volume that holds a path (statfs works on macOS and Windows alike). */
import { statfs } from 'node:fs/promises';

export async function statfsFreeBytes(path: string): Promise<number> {
  const stats = await statfs(path);
  return Number(stats.bavail) * Number(stats.bsize);
}
