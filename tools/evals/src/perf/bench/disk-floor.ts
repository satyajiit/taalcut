// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The bench's free-space floor (IX3-B5). Under very low disk macOS purges purgeable caches, Core ML's compiled
 * models among them, and the app compiles again in the middle of a run (round IX2: a 108 s recompile while the Data
 * volume was down to 3 GB, `_orch/ix2/logs/fix2/coreml-cache/findings.txt`). A bench run's footage copies, work
 * files and compiles take tens of GB, so the bench refuses to start, and stops before a later run, when a volume it
 * writes to (the bench root, the helper's compile cache) has less than the floor free (default 50 GB, `--min-free-gb`).
 */
import { existsSync, statfsSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_MIN_FREE_GB = 50;
const GB = 1024 ** 3;

export interface DiskSpace {
  /** Bytes an unprivileged process may still write on the volume that holds `path`. */
  freeBytes(path: string): number;
}

/** The nearest folder of `path` that exists (the bench root may not exist yet). */
function existing(path: string): string {
  let at = path;
  while (!existsSync(at) && dirname(at) !== at) at = dirname(at);
  return at;
}

export function nodeDiskSpace(): DiskSpace {
  return {
    freeBytes(path) {
      const stats = statfsSync(existing(path));
      return stats.bavail * stats.bsize;
    },
  };
}

export interface LowDisk {
  readonly path: string;
  readonly freeGb: number;
  readonly floorGb: number;
}

const gb = (bytes: number) => Math.round((bytes / GB) * 10) / 10;

/** The first of `paths` whose volume has less than `floorGb` free, or null when every one has room. */
export function lowDisk(disk: DiskSpace, paths: readonly string[], floorGb: number): LowDisk | null {
  for (const path of paths) {
    const free = disk.freeBytes(path);
    if (free < floorGb * GB) return { path, freeGb: gb(free), floorGb };
  }
  return null;
}

export const lowDiskMessage = (low: LowDisk): string =>
  `${low.path} has ${low.freeGb} GB free, under the bench's floor of ${low.floorGb} GB (--min-free-gb): macOS ` +
  'purges Core ML compiles under low disk and the app compiles again mid-run; free disk first';
