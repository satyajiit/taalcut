// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The disk-space check that runs before a download starts, and the
 * reservations that keep concurrent installs from counting the same free
 * space. `statfs` is injected so tests can simulate a full disk.
 */
import { statfs } from 'node:fs/promises';
import { createSerialQueue, err, ok, type AsyncResult } from '@taalcut/core';
import { DiskSpaceLow, DownloadsSpaceLow } from './errors';

/** The subset of fs.statfs the check uses. Numbers or bigints, as Node returns either. */
export type StatfsLike = (path: string) => Promise<{ bavail: number | bigint; bsize: number | bigint }>;

export const nodeStatfs: StatfsLike = (path) => statfs(path);

/**
 * Space left free after an install, so a model download never fills the disk
 * the user's library and renders live on.
 */
export const DEFAULT_HEADROOM_BYTES = 512 * 1024 * 1024;

export interface DiskCheck {
  /** Free bytes, or undefined when the filesystem would not say. */
  readonly availableBytes: number | undefined;
  readonly requiredBytes: number;
}

/** Free bytes for unprivileged users on the volume holding `path`. */
export async function availableBytes(path: string, statfsFn: StatfsLike): Promise<number> {
  const stats = await statfsFn(path);
  return Number(BigInt(stats.bavail) * BigInt(stats.bsize));
}

/**
 * Fails with `jobs.disk_space_low` when `needBytes + headroomBytes` is more
 * than the volume has free, less `reservedBytes` that other installs will
 * still write. If statfs itself fails (some network volumes), the check
 * passes: a full disk mid-download still ends in the same error.
 */
export async function checkDiskSpace(options: {
  readonly path: string;
  readonly component: string;
  readonly needBytes: number;
  readonly headroomBytes: number;
  readonly statfs: StatfsLike;
  readonly reservedBytes?: number;
}): AsyncResult<DiskCheck> {
  const requiredBytes = Math.max(0, options.needBytes) + options.headroomBytes;
  const reserved = options.reservedBytes ?? 0;
  let free: number;
  try {
    free = await availableBytes(options.path, options.statfs);
  } catch {
    return ok({ availableBytes: undefined, requiredBytes });
  }
  const available = Math.max(0, free - reserved);
  if (available < requiredBytes) {
    const detail = `statfs(${options.path}): ${free} bytes free, ${reserved} reserved by running installs, ${requiredBytes} needed`;
    return err(
      DiskSpaceLow({ component: options.component, requiredBytes, availableBytes: available }, { detail }),
    );
  }
  return ok({ availableBytes: available, requiredBytes });
}

/**
 * Whether the disk has room for what an install plan still needs (its downloads, unpacked, plus the headroom):
 * `jobs.downloads_space_low` when it hasn't. Some volumes won't say; a full disk mid-download still ends in a plain
 * error.
 */
export async function checkPlanSpace(
  plan: { readonly components: readonly unknown[]; readonly requiredBytes: number },
  path: string,
  statfsFn: StatfsLike,
): AsyncResult<{ requiredBytes: number; availableBytes: number | undefined }> {
  const { requiredBytes } = plan;
  let free: number;
  try {
    free = await availableBytes(path, statfsFn);
  } catch {
    return ok({ requiredBytes, availableBytes: undefined });
  }
  if (plan.components.length > 0 && free < requiredBytes) {
    const detail = `statfs(${path}): ${free} bytes free, ${requiredBytes} needed`;
    return err(DownloadsSpaceLow({ requiredBytes, availableBytes: free }, { detail }));
  }
  return ok({ requiredBytes, availableBytes: free });
}

/** A reservation from DiskBudget.reserve. */
export interface DiskHold {
  /** Gives back one component's share (its bytes are on disk now, or it failed), or with no id all of it. */
  release(id?: string): Promise<void>;
}

/**
 * Free space shared by the installs of one manager. statfs only sees bytes
 * already written, so each install reserves what it will still write, and a
 * check subtracts what other running installs have reserved. Checks and
 * releases run one at a time, so two installs never both count the same free
 * bytes. A component held by two installs (one shares the other's download)
 * counts once.
 */
export class DiskBudget {
  private readonly held = new Map<string, { bytes: number; holders: number }>();
  private readonly turns = createSerialQueue();

  constructor(private readonly statfs: StatfsLike) {}

  reserve(options: {
    readonly path: string;
    readonly component: string;
    readonly needs: readonly { readonly id: string; readonly bytes: number }[];
    readonly headroomBytes: number;
  }): AsyncResult<DiskHold> {
    if (options.needs.length === 0) return Promise.resolve(ok({ release: async () => undefined }));
    return this.turns.run(async () => {
      const mine = new Set(options.needs.map((need) => need.id));
      let reservedBytes = 0;
      for (const [id, share] of this.held) if (!mine.has(id)) reservedBytes += share.bytes;
      const space = await checkDiskSpace({
        path: options.path,
        component: options.component,
        needBytes: options.needs.reduce((sum, need) => sum + need.bytes, 0),
        headroomBytes: options.headroomBytes,
        statfs: this.statfs,
        reservedBytes,
      });
      if (!space.ok) return space;
      for (const need of options.needs) {
        const share = this.held.get(need.id);
        if (share) share.holders += 1;
        else this.held.set(need.id, { bytes: Math.max(0, need.bytes), holders: 1 });
      }
      return ok(this.holdOf(mine));
    });
  }

  private holdOf(ids: Set<string>): DiskHold {
    return {
      release: (id) =>
        this.turns.run(async () => {
          for (const each of id === undefined ? [...ids] : [id]) {
            if (!ids.delete(each)) continue;
            const share = this.held.get(each);
            if (share && --share.holders === 0) this.held.delete(each);
          }
        }),
    };
  }
}
