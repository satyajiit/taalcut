// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What `render.purge` removes (SPEC section 9): the conform cache over its
 * cap (least recently used first: conform touches a segment on every hit),
 * work folders nobody is using, preview sessions left behind by a crash, and
 * the files of renders soft-deleted more than a week ago. The plan is pure;
 * purgeRenderCache lists the folders and carries it out.
 */
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ok, type AsyncResult, type RenderStore } from '@taalcut/core';
import type { RenderFolders } from '../engine/deps';

export const CONFORM_CACHE_MAX_BYTES = 5 * 1024 ** 3;
export const STALE_FOLDER_MS = 24 * 3_600_000;
export const DELETED_RENDER_KEEP_MS = 7 * 24 * 3_600_000;
/** An interrupted write (`*.part`, `*.tmp`) this old is abandoned. */
const PARTIAL_MS = 3_600_000;

export interface PurgeEntry {
  readonly path: string;
  readonly name: string;
  readonly bytes: number;
  readonly mtimeMs: number;
}

export interface PurgeListing {
  readonly conform: readonly PurgeEntry[];
  /** Folders named by render id. */
  readonly work: readonly PurgeEntry[];
  /** Folders named by session token. */
  readonly preview: readonly PurgeEntry[];
}

export interface PurgeOptions {
  readonly now: number;
  /** Default 5 GB. */
  readonly conformMaxBytes?: number;
  /** Default 24 h. */
  readonly workMaxAgeMs?: number;
  /** Default 24 h (the engine closes idle sessions after 30 min; this catches a crash's leftovers). */
  readonly previewMaxAgeMs?: number;
  /** Work folders kept whatever their age: running renders, and needsAttention ones awaiting "Export anyway". */
  readonly keepWork?: ReadonlySet<string>;
}

export interface PurgePlan {
  readonly remove: readonly string[];
  readonly freedBytes: number;
}

const partial = (name: string) => name.endsWith('.part') || name.endsWith('.tmp') || name.includes('.part.');

/** Which paths to remove. Segments of one clip (`<key>.mp4`, `<key>.wav`) go together. */
export function planRenderPurge(listing: PurgeListing, options: PurgeOptions): PurgePlan {
  const remove: string[] = [];
  let freedBytes = 0;
  const drop = (entry: PurgeEntry) => {
    remove.push(entry.path);
    freedBytes += entry.bytes;
  };

  const groups = new Map<string, { entries: PurgeEntry[]; bytes: number; usedAt: number }>();
  for (const entry of listing.conform) {
    if (partial(entry.name)) {
      if (options.now - entry.mtimeMs > PARTIAL_MS) drop(entry);
      continue;
    }
    const key = entry.name.split('.')[0] ?? entry.name;
    const group = groups.get(key) ?? { entries: [], bytes: 0, usedAt: 0 };
    group.entries.push(entry);
    group.bytes += entry.bytes;
    group.usedAt = Math.max(group.usedAt, entry.mtimeMs);
    groups.set(key, group);
  }
  let total = [...groups.values()].reduce((sum, group) => sum + group.bytes, 0);
  const cap = options.conformMaxBytes ?? CONFORM_CACHE_MAX_BYTES;
  const oldestFirst = [...groups.entries()].sort(
    (a, b) => a[1].usedAt - b[1].usedAt || (a[0] < b[0] ? -1 : 1),
  );
  for (const [, group] of oldestFirst) {
    if (total <= cap) break;
    group.entries.forEach(drop);
    total -= group.bytes;
  }

  const workAge = options.workMaxAgeMs ?? STALE_FOLDER_MS;
  for (const entry of listing.work) {
    if (options.keepWork?.has(entry.name)) continue;
    if (options.now - entry.mtimeMs > workAge) drop(entry);
  }
  const previewAge = options.previewMaxAgeMs ?? STALE_FOLDER_MS;
  for (const entry of listing.preview) if (options.now - entry.mtimeMs > previewAge) drop(entry);
  return { remove, freedBytes };
}

async function bytesOf(path: string): Promise<number> {
  const info = await stat(path).catch(() => undefined);
  if (!info) return 0;
  if (!info.isDirectory()) return info.size;
  const names = await readdir(path).catch(() => [] as string[]);
  let total = 0;
  for (const name of names) total += await bytesOf(join(path, name));
  return total;
}

async function listEntries(dir: string, folders: boolean): Promise<PurgeEntry[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const entries: PurgeEntry[] = [];
  for (const name of names) {
    const path = join(dir, name);
    const info = await stat(path).catch(() => undefined);
    if (!info || info.isDirectory() !== folders) continue;
    entries.push({ path, name, bytes: folders ? await bytesOf(path) : info.size, mtimeMs: info.mtimeMs });
  }
  return entries;
}

/** Lists the cache folders, plans, removes. A path that vanished meanwhile counts as removed. */
export async function purgeRenderCache(
  folders: Pick<RenderFolders, 'conform' | 'work' | 'preview'>,
  options: PurgeOptions,
): Promise<{ readonly removed: number; readonly freedBytes: number }> {
  const listing: PurgeListing = {
    conform: await listEntries(folders.conform, false),
    work: await listEntries(folders.work, true),
    preview: await listEntries(folders.preview, true),
  };
  const plan = planRenderPurge(listing, options);
  for (const path of plan.remove) await rm(path, { recursive: true, force: true });
  return { removed: plan.remove.length, freedBytes: plan.freedBytes };
}

/**
 * Removes the files (and SRT/VTT sidecars) of renders soft-deleted more than `keepMs` ago and clears their
 * path, so a later restore shows the render without a file. Returns how many renders lost their file.
 */
export async function purgeDeletedRenders(
  store: Pick<RenderStore, 'list' | 'update'>,
  options: { readonly now: number; readonly keepMs?: number },
): AsyncResult<number> {
  const keepMs = options.keepMs ?? DELETED_RENDER_KEEP_MS;
  const listed = await store.list({ includeDeleted: true });
  if (!listed.ok) return listed;
  let removed = 0;
  for (const record of listed.value) {
    if (record.deletedAt === null || record.filePath === null || options.now - record.deletedAt <= keepMs)
      continue;
    const base = record.filePath.replace(/\.mp4$/u, '');
    for (const path of [record.filePath, `${base}.srt`, `${base}.vtt`]) await rm(path, { force: true });
    const cleared = await store.update(record.id, { filePath: null, bytes: null });
    if (!cleared.ok) return cleared;
    removed += 1;
  }
  return ok(removed);
}
