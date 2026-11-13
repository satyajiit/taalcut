// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What is on disk under the cache root. Other processes keep caches on the same root (render's subject tracks and
 * grade cubes, the agent's audio), and main's media protocol marks a read by setting the file's mtime, so the disk,
 * not one process's memory, says what the cache holds and what was used last.
 *
 * At start (`scanAtStart`, sync, before the first put): every file with a derived key; `.part` files a writer left
 * more than an hour ago are a crash's leftovers and go. A younger one may be another process's write in progress
 * (each put writes its own `.part`), so it stays. Before an eviction (`scan`, async, so the jobs process keeps
 * serving while it walks): the same files, nothing deleted.
 */
import { readdirSync, statSync, unlinkSync, type Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isDerivedKey } from './layout';

export interface DiskEntry {
  readonly key: string;
  readonly bytes: number;
  readonly mtime: number;
}

/** A `.part` file older than this has no writer left. */
export const STALE_PART_MS = 60 * 60 * 1000;

export function scanAtStart(root: string, now: number): DiskEntry[] {
  const found: DiskEntry[] = [];
  const visit = (dir: string, prefix: string) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return; // No folder yet: nothing cached under it.
    }
    for (const name of names) {
      const abs = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue; // Gone between the listing and the stat: not in the cache.
      }
      if (name.endsWith('.part')) {
        if (now - st.mtimeMs <= STALE_PART_MS) continue;
        try {
          unlinkSync(abs);
        } catch {
          // Still held after all: the next start tries again.
        }
      } else if (st.isDirectory()) visit(abs, rel);
      else if (st.isFile() && isDerivedKey(rel))
        found.push({ key: rel, bytes: st.size, mtime: st.mtimeMs || now });
    }
  };
  visit(root, '');
  return found;
}

export async function scan(root: string): Promise<DiskEntry[]> {
  const found: DiskEntry[] = [];
  const visit = async (dir: string, prefix: string): Promise<void> => {
    let names: Dirent[];
    try {
      names = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // A folder removed meanwhile holds nothing.
    }
    await Promise.all(
      names.map(async (entry) => {
        const abs = join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) return visit(abs, rel);
        if (!entry.isFile() || !isDerivedKey(rel)) return;
        const st = await stat(abs).then(
          (s) => s,
          () => undefined, // Evicted or replaced between the listing and the stat: the next scan sees it.
        );
        if (st) found.push({ key: rel, bytes: st.size, mtime: st.mtimeMs });
      }),
    );
  };
  await visit(root, '');
  return found;
}
