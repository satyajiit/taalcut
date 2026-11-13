// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `library.scanSource` (P2-L2, jobs process): walks a watched folder, or the
 * paths a watcher saw change, and brings the library in line with the disk.
 * A full scan saves its cursor every batch (200 files) so a scan stopped by a
 * quit resumes after the last path it finished; at its end, locations it
 * didn't see are `missing`. A root on an unmounted volume makes the source and
 * its locations `offline` instead (ADR 0001: never missing for an eject).
 */
import { lstat, opendir, stat } from 'node:fs/promises';
import {
  CancelledError,
  err,
  ok,
  publicErrorSchema,
  type AsyncResult,
  type EventBus,
  type SourceId,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import type { ContentHasher } from '../hashing/content-hasher';
import { normaliseRelativePath } from '../repositories/asset-locations';
import { createSourceRepository, type Source } from '../repositories/sources';
import { FolderPermissionDenied, folderParams } from './errors';
import { applyBatch, emptyTally, type ScanTally } from './scan-apply';
import { planFile, type FilePlan, type PlanContext } from './scan-plan';
import {
  absolutePathOf,
  locationsUnder,
  markMissing,
  markUnseenMissing,
  setSourceLocations,
} from './scan-store';
import type { PlaceholderStatus, VolumeProbe } from './volumes';
import { isScannable, walkMedia } from './walk';

export interface ScanDeps {
  readonly db: LibraryDatabase;
  readonly hasher: ContentHasher;
  readonly volumes: VolumeProbe;
  readonly placeholders?: PlaceholderStatus;
  readonly events?: Pick<EventBus, 'emit'>;
  /** Files per transaction and cursor save. Default 200. */
  readonly batchSize?: number;
}

export interface ScanRequest {
  readonly sourceId: SourceId;
  readonly mode: 'full' | 'paths';
  /** Relative to the source's root (mode 'paths'); a folder means everything under it. */
  readonly paths?: readonly string[];
  /** 'watcher' when the watcher asked for it. */
  readonly via?: 'scan' | 'watcher';
}

/** How the scan ended, beside its counts. */
export type ScanEnd = 'done' | 'offline' | 'missing' | 'permission-denied' | 'dataless' | 'source-removed';

export interface ScanCounts extends ScanTally {
  readonly end: ScanEnd;
  /** Entries the walk ignored or couldn't read. */
  readonly skipped: number;
}

const EPERM = new Set(['EPERM', 'EACCES']);

/** `scan_cursor`: when the interrupted full scan started, and the last relative path it finished. */
function readCursor(cursor: string | null, now: number): { since: number; after: string | null } {
  const match = cursor ? /^(\d+):(.*)$/s.exec(cursor) : null;
  return match ? { since: Number(match[1]), after: match[2] || null } : { since: now, after: null };
}

export async function scanSource(
  deps: ScanDeps,
  request: ScanRequest,
  signal?: AbortSignal,
): AsyncResult<ScanCounts> {
  const { db } = deps;
  const sources = createSourceRepository(db);
  const found = sources.get(request.sourceId);
  const tally = emptyTally();
  const end = (how: ScanEnd, skipped = 0): ScanCounts => ({ ...tally, end: how, skipped });
  if (!found.ok) return ok(end('source-removed'));
  const source = found.value;
  const recursive =
    deps.db.driver.prepare('SELECT recursive FROM import_source_scopes WHERE source_id = ?').get(source.id)?.[
      'recursive'
    ] !== 0;

  const root = await checkRoot(deps, source);
  if (root !== 'online') {
    if (root === 'permission-denied') {
      const error = publicErrorSchema.parse(
        FolderPermissionDenied(folderParams(source.rootPath, source.displayName)),
      );
      sources.update(source.id, { scanState: 'error', scanError: error });
    }
    return ok(end(root));
  }
  const volume = await deps.volumes.identify(source.rootPath);
  const volumeUuid = volume?.uuid ?? source.volumeUuid;
  if (source.status !== 'online' || (volume && source.volumeUuid === null)) {
    sources.update(source.id, {
      status: 'online',
      ...(volume && source.volumeUuid === null ? { volumeUuid: volume.uuid, volumeName: volume.name } : {}),
    });
  }

  const ctx: PlanContext = {
    db,
    hasher: deps.hasher,
    sourceId: source.id,
    volumeUuid,
    exists: (path) =>
      lstat(path).then(
        () => true,
        () => false,
      ),
    ...(deps.placeholders ? { placeholders: deps.placeholders } : {}),
    ...(signal ? { signal } : {}),
  };
  const target = {
    sourceId: source.id,
    rootPath: source.rootPath,
    volumeUuid,
    via: request.via ?? 'scan',
  } as const;
  const batchSize = deps.batchSize ?? 200;
  let skipped = 0;
  let removed = false;
  let pending: { relativePath: string; plan: FilePlan }[] = [];

  const flush = (cursor?: string): boolean => {
    const applied = applyBatch(db, target, pending, tally);
    pending = [];
    if (applied.sourceRemoved) return (removed = true);
    if (cursor !== undefined) sources.update(source.id, { scanCursor: cursor });
    emit(deps, 'created', applied.created, 'asset');
    emit(deps, 'updated', applied.updated, 'asset');
    return false;
  };

  if (request.mode === 'full') {
    const { since, after } = readCursor(source.scanCursor, db.clock());
    sources.update(source.id, {
      scanState: 'scanning',
      scanCursor: `${since}:${after ?? ''}`,
      scanError: null,
    });
    const walk = walkMedia(source.rootPath, {
      after,
      recursive,
      ...(signal ? { signal } : {}),
      onUnreadable: () => (skipped += 1),
    });
    for await (const entry of walk) {
      pending.push({
        relativePath: entry.relativePath,
        plan: await planFile(ctx, entry.relativePath, entry.absolutePath),
      });
      if (pending.length >= batchSize && flush(`${since}:${entry.relativePath}`))
        return ok(end('source-removed'));
    }
    if (signal?.aborted) {
      // Keep what is done; the cursor already points after the last applied batch.
      return err(CancelledError());
    }
    const last = pending.at(-1)?.relativePath;
    if (pending.length > 0 && flush(`${since}:${last}`)) return ok(end('source-removed'));
    const now = db.clock();
    db.transaction(() => {
      tally.missing += markUnseenMissing(db, source.id, since, now, recursive);
      sources.update(source.id, { scanState: 'idle', scanCursor: null, lastScanAt: now, scanError: null });
    });
    return ok(end('done', skipped));
  }

  for (const raw of request.paths ?? []) {
    if (signal?.aborted) return err(CancelledError());
    const relative = normaliseRelativePath(raw.normalize('NFC'));
    if (!relative.ok) {
      skipped += 1;
      continue;
    }
    if (!recursive && relative.value.includes('/')) continue;
    const absolute = absolutePathOf(source.rootPath, relative.value);
    const info = await stat(absolute).catch(() => undefined);
    if (!info) {
      // Deleted, or the old side of a move: its locations (a folder's, everything under it) are missing.
      const gone = locationsUnder(db, source.id, relative.value).map((l) => l.id);
      if (gone.length > 0) tally.missing += db.transaction(() => markMissing(db, gone, db.clock()));
      continue;
    }
    if (info.isDirectory()) {
      if (!recursive) continue;
      for await (const entry of walkMedia(absolute, signal ? { signal } : {})) {
        const relativePath = `${relative.value}/${entry.relativePath}`;
        pending.push({ relativePath, plan: await planFile(ctx, relativePath, entry.absolutePath) });
        if (pending.length >= batchSize && flush()) return ok(end('source-removed'));
      }
    } else if (isScannable(relative.value)) {
      pending.push({ relativePath: relative.value, plan: await planFile(ctx, relative.value, absolute) });
    } else {
      skipped += 1;
    }
    if (pending.length >= batchSize && flush()) return ok(end('source-removed'));
  }
  if (pending.length > 0 && flush()) return ok(end('source-removed'));
  return removed ? ok(end('source-removed')) : ok(end('done', skipped));
}

/** Whether the root can be walked; else the source's new status is written and why it can't is returned. */
async function checkRoot(
  deps: ScanDeps,
  source: Source,
): Promise<'online' | Exclude<ScanEnd, 'done' | 'source-removed'>> {
  const sources = createSourceRepository(deps.db);
  const now = deps.db.clock();
  let isDirectory: boolean;
  try {
    isDirectory = (await stat(source.rootPath)).isDirectory();
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code ?? '';
    if (EPERM.has(code)) return 'permission-denied';
    isDirectory = false;
  }
  if (!isDirectory) {
    const mounted = await volumeMounted(deps.volumes, source);
    const status = mounted ? 'missing' : 'offline';
    deps.db.transaction(() => {
      sources.update(source.id, { status, scanState: 'idle', scanCursor: null });
      setSourceLocations(deps.db, source.id, status, now);
    });
    emit(deps, 'updated', [source.id], 'source');
    return status;
  }
  // A dataless iCloud folder is never recursed (that would download it) and never marked missing.
  if (
    deps.placeholders &&
    (await deps.placeholders(source.rootPath).catch(() => 'unknown')) === 'placeholder'
  ) {
    return 'dataless';
  }
  try {
    await walkProbe(source.rootPath);
  } catch (cause) {
    if (EPERM.has((cause as NodeJS.ErrnoException).code ?? '')) return 'permission-denied';
  }
  return 'online';
}

/** Reading the root is what TCC refuses (Files and Folders), not stat. */
async function walkProbe(root: string): Promise<void> {
  const dir = await opendir(root);
  await dir.close();
}

/**
 * ADR 0001: offline when the source's Volume UUID isn't mounted. Without a stored UUID, a root under
 * /Volumes/<name> whose /Volumes/<name> is gone is an unmounted drive.
 */
async function volumeMounted(volumes: VolumeProbe, source: Source): Promise<boolean> {
  if (source.volumeUuid) return (await volumes.mountedUuids()).has(source.volumeUuid);
  const drive = /^\/Volumes\/[^/]+/.exec(source.rootPath)?.[0];
  if (!drive) return true;
  return stat(drive).then(
    () => true,
    () => false,
  );
}

function emit(
  deps: ScanDeps,
  change: 'created' | 'updated',
  ids: readonly string[],
  entity: 'asset' | 'source',
): void {
  if (!deps.events || ids.length === 0) return;
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 1000) {
    deps.events.emit('library.changed', {
      projectId: null,
      entity,
      change,
      ids: unique.slice(i, i + 1000),
    });
  }
}
