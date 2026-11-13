// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a scan does with one file (P2-L2), decided with async I/O and applied
 * later in a batch transaction. Order (ADR 0001): stat, then the placeholder
 * check before any read, then unchanged size + mtime + inode means nothing to
 * do, else the partial hash decides between "same bytes, touched", "moved
 * here" (relink) and "new bytes". BLAKE3 is read only to break a tie.
 */
import type { Stats } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { AssetId } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import type { ContentHasher } from '../hashing/content-hasher';
import { mediaTypeOf } from './media-files';
import {
  detachedCandidates,
  locationAt,
  relinkCandidates,
  type FileFacts,
  type LocationRow,
  type RelinkCandidate,
} from './scan-store';
import { isPlaceholder, type PlaceholderStatus } from './volumes';

export type FilePlan =
  | { readonly kind: 'gone'; readonly relativePath: string }
  | { readonly kind: 'placeholder'; readonly file: FileFacts; readonly existing?: LocationRow }
  | { readonly kind: 'unchanged'; readonly file: FileFacts; readonly existing: LocationRow }
  | {
      readonly kind: 'touched';
      readonly file: FileFacts;
      readonly existing: LocationRow;
      readonly partialHash: string;
    }
  | {
      readonly kind: 'relink';
      readonly file: FileFacts;
      readonly partialHash: string;
      readonly candidate: RelinkCandidate;
      /** The location that was at this path holds other bytes now: it is dropped. */
      readonly replaces?: LocationRow;
    }
  | {
      readonly kind: 'attach';
      readonly file: FileFacts;
      readonly partialHash: string;
      readonly assetId: AssetId;
      readonly replaces?: LocationRow;
    }
  | {
      readonly kind: 'new';
      readonly file: FileFacts;
      readonly partialHash: string;
      readonly fullHash: string | null;
      readonly replaces?: LocationRow;
    }
  | { readonly kind: 'failed'; readonly relativePath: string; readonly reason: string };

export interface PlanContext {
  readonly db: LibraryDatabase;
  readonly hasher: ContentHasher;
  readonly placeholders?: PlaceholderStatus;
  readonly sourceId: LocationRow['sourceId'];
  readonly volumeUuid: string | null;
  readonly signal?: AbortSignal;
  /** Whether a path exists now (a moved file's old path doesn't). */
  readonly exists: (path: string) => Promise<boolean>;
}

export function fileFacts(info: Pick<Stats, 'size' | 'mtimeMs' | 'ino'>): FileFacts {
  return { sizeBytes: info.size, mtimeMs: Math.round(info.mtimeMs), fileId: info.ino };
}

const sameFile = (row: LocationRow, file: FileFacts) =>
  row.sizeBytes === file.sizeBytes && row.mtimeMs === file.mtimeMs && row.fileId === file.fileId;

/** The kind of asset a file name makes (Live Photos are paired later, from media's facts). */
export function assetKindOf(name: string): 'video' | 'image' | 'audio' | undefined {
  return mediaTypeOf(name);
}

export async function planFile(
  ctx: PlanContext,
  relativePath: string,
  absolutePath: string,
): Promise<FilePlan> {
  let info: Stats;
  try {
    info = await lstat(absolutePath);
  } catch {
    return { kind: 'gone', relativePath };
  }
  if (!info.isFile() || !assetKindOf(basename(relativePath))) return { kind: 'gone', relativePath };
  const file = fileFacts(info);
  const existing = locationAt(ctx.db, ctx.sourceId, relativePath);
  if (await isPlaceholder(absolutePath, info, ctx.placeholders)) {
    return { kind: 'placeholder', file, ...(existing ? { existing } : {}) };
  }
  // An empty file holds no media yet (a copy that stopped, an app's stub): skipped quietly, never a file that
  // "couldn't be read" (UX1-IMPORT). Once it has bytes the watcher or the next scan sees a change and adds it.
  if (info.size === 0) return { kind: 'gone', relativePath };
  if (existing && existing.state !== 'icloud_placeholder' && sameFile(existing, file)) {
    return { kind: 'unchanged', file, existing };
  }
  const partial = await ctx.hasher.partial(absolutePath, ctx.signal ? { signal: ctx.signal } : {});
  if (!partial.ok) return { kind: 'failed', relativePath, reason: partial.error.code };
  const partialHash = partial.value;
  if (existing && existing.partialHash === partialHash && existing.sizeBytes === file.sizeBytes) {
    return { kind: 'touched', file, existing, partialHash };
  }
  // New bytes at this path. A location already here held other bytes (changed in place): not a relink.
  const replaces = existing ? { replaces: existing } : {};
  return { ...(await placeNewBytes(ctx, absolutePath, file, partialHash)), ...replaces };
}

/** Bytes not known at this path: a move of a known file, a re-attach after undo, or a new asset. */
async function placeNewBytes(
  ctx: PlanContext,
  absolutePath: string,
  file: FileFacts,
  partialHash: string,
): Promise<FilePlan> {
  const match = { sizeBytes: file.sizeBytes, partialHash };
  const candidates: RelinkCandidate[] = [];
  for (const candidate of relinkCandidates(ctx.db, { ...match, volumeUuid: ctx.volumeUuid })) {
    if (candidate.absolutePath === absolutePath) continue;
    // A moved file's old path is gone; a copy's isn't, and a copy is not a move.
    if (candidate.location.state === 'missing' || !(await ctx.exists(candidate.absolutePath))) {
      candidates.push(candidate);
    }
  }
  let fullHash: string | null = null;
  const blake3 = async () => {
    if (fullHash === null) {
      const full = await ctx.hasher.full(absolutePath, ctx.signal ? { signal: ctx.signal } : {});
      fullHash = full.ok ? full.value : '';
    }
    return fullHash;
  };
  if (candidates.length > 0) {
    // The inode narrows the candidates but never decides alone: with more than one, BLAKE3 does.
    const sameInode = candidates.filter((c) => c.location.fileId === file.fileId);
    const narrowed = sameInode.length > 0 ? sameInode : candidates;
    if (narrowed.length === 1) return { kind: 'relink', file, partialHash, candidate: narrowed[0]! };
    const hash = await blake3();
    const verified = candidates.filter(
      (c) => hash && (c.contentHash === hash || c.location.fullHash === hash),
    );
    if (verified[0]) return { kind: 'relink', file, partialHash, candidate: verified[0] };
  }
  const detached = detachedCandidates(ctx.db, match);
  if (detached.length === 1) return { kind: 'attach', file, partialHash, assetId: detached[0]!.id };
  if (detached.length > 1) {
    const hash = await blake3();
    const verified = detached.find((d) => hash && d.contentHash === hash);
    if (verified) return { kind: 'attach', file, partialHash, assetId: verified.id };
  }
  return { kind: 'new', file, partialHash, fullHash: fullHash || null };
}
