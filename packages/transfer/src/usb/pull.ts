// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** One item into `<uploadId>.part`. Ranged bridges resume; the others start over. */
import { rm, stat } from 'node:fs/promises';
import { err, ok, toTaalcutError, type AsyncResult, type ImportSpacePort } from '@taalcut/core';
import { DiskFull } from '../errors';
import type { BridgeSession } from './bridge';
import { DeviceGone } from './errors';
import { errnoOf } from './ledger';

export async function pullToPart(options: {
  readonly session: BridgeSession;
  readonly itemId: string;
  readonly partPath: string;
  readonly signal: AbortSignal;
  readonly space?: ImportSpacePort;
  readonly owner?: string;
  readonly expectedBytes?: number;
  readonly onBytes?: (received: number) => void;
}): AsyncResult<{ readonly sha256: string; readonly bytes: number }> {
  if (options.signal.aborted) return err(DeviceGone());
  try {
    const offset = await resumeOffset(options.session.rangedReads, options.partPath);
    if (options.space && options.owner) {
      options.space.release(options.owner);
      const reserved = await options.space.reserve(
        options.owner,
        Math.max(0, (options.expectedBytes ?? 0) - offset),
      );
      if (!reserved.ok) return err(DiskFull());
    }
    let consumed = offset;
    const onBytes = (received: number) => {
      if (options.space && options.owner)
        options.space.consume(options.owner, Math.max(0, received - consumed));
      consumed = Math.max(consumed, received);
      options.onBytes?.(received);
    };
    const pulled = await options.session.pull(options.itemId, {
      dest: options.partPath,
      offset,
      signal: options.signal,
      onBytes,
    });
    if (!pulled.ok) return pulled;
    onBytes(pulled.value.bytes);
    await deleteAncillary(pulled.value.ancillary, options.partPath);
    const sha = pulled.value.sha256.toLowerCase();
    return ok({ sha256: sha, bytes: pulled.value.bytes });
  } catch (cause) {
    // A bridge or the disk threw instead of returning a value: a full disk pauses the run, the rest fail the item.
    return err(errnoOf(cause) === 'ENOSPC' ? DiskFull() : toTaalcutError(cause));
  } finally {
    if (options.space && options.owner) options.space.release(options.owner);
  }
}

/**
 * The device's own SHA-256 of the item. `ok(null)` only when the bridge can't
 * hash on the device; a hash it tried and failed to get is an error, so the
 * check is retried rather than skipped.
 */
export async function sourceSha(
  session: BridgeSession,
  itemId: string,
  signal: AbortSignal,
): AsyncResult<string | null> {
  if (!session.sourceHash) return ok(null);
  const result = await session.sourceHash(itemId, signal);
  if (!result.ok) return result;
  return ok(result.value === null ? null : result.value.toLowerCase());
}

async function resumeOffset(ranged: boolean, partPath: string): Promise<number> {
  if (!ranged) {
    await rm(partPath, { force: true });
    return 0;
  }
  try {
    const info = await stat(partPath);
    return info.isFile() ? info.size : 0;
  } catch (cause) {
    // No part yet: the pull starts at 0. Any other failure is the pull's to report.
    if (errnoOf(cause) === 'ENOENT') return 0;
    throw cause;
  }
}

async function deleteAncillary(paths: readonly string[], partPath: string): Promise<void> {
  for (const extra of paths) {
    if (extra === partPath) continue;
    await rm(extra, { force: true });
  }
}
