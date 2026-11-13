// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a `.part` file was downloaded from, kept next to it as `.part.json`.
 * Written (atomically) before the first byte of each response is appended, so
 * after a crash the next run knows which URL and which ETag / Last-Modified the
 * bytes belong to, and can ask the server to resume only if the file is unchanged.
 */
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { removeQuietly, writeFileAtomic } from './fs-util';

const PartMetaSchema = z.object({
  v: z.literal(1),
  url: z.string(),
  size: z.int().positive(),
  sha256: z.string(),
  etag: z.string().optional(),
  lastModified: z.string().optional(),
});

export type PartMeta = z.infer<typeof PartMetaSchema>;

export const metaPathFor = (partPath: string): string => `${partPath}.json`;

/** The saved state, or undefined if it is missing or unreadable (the part then restarts from zero). */
export async function readPartMeta(partPath: string): Promise<PartMeta | undefined> {
  try {
    const parsed = PartMetaSchema.safeParse(JSON.parse(await readFile(metaPathFor(partPath), 'utf8')));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export async function writePartMeta(partPath: string, meta: PartMeta): Promise<void> {
  await writeFileAtomic(metaPathFor(partPath), JSON.stringify(meta));
}

/** Deletes the partial download and its state. */
export async function discardPart(partPath: string): Promise<void> {
  await removeQuietly(partPath);
  await removeQuietly(metaPathFor(partPath));
}

/** ETags starting with W/ are weak: fine for "has it changed?", not allowed in If-Range (RFC 9110 13.1.5). */
export function isStrongEtag(etag: string | undefined): etag is string {
  return etag !== undefined && !etag.startsWith('W/');
}

/** The If-Range value for a resume, if the saved validators allow one. */
export function ifRangeValue(meta: PartMeta): string | undefined {
  if (isStrongEtag(meta.etag)) return meta.etag;
  return meta.lastModified;
}

/**
 * True when the response's validators show the remote file is not the one the
 * part came from. A missing validator on either side proves nothing; the
 * sha256 check at the end is the backstop.
 */
export function validatorsChanged(
  meta: PartMeta,
  etag: string | undefined,
  lastModified: string | undefined,
): boolean {
  if (meta.etag !== undefined && etag !== undefined) return stripWeak(meta.etag) !== stripWeak(etag);
  if (meta.lastModified !== undefined && lastModified !== undefined)
    return meta.lastModified !== lastModified;
  return false;
}

const stripWeak = (etag: string): string => (etag.startsWith('W/') ? etag.slice(2) : etag);
