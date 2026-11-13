// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Preview bytes the agent fetched, addressed as app://media/stock/<sha256>.jpg.
 * The cap (default 200 MB) drops the oldest entries. A directory, when given,
 * receives the same bytes; the URL does not depend on the write.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256Hex } from '../stores/canonical';

export const PREVIEW_CAP_BYTES = 200 * 1024 * 1024;
/** A tiny JPEG (SOI/EOI) for a sound, which has no poster. */
export const SOUND_PLACEHOLDER = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9);

export function previewUrlFor(bytes: Uint8Array): string {
  return `app://media/stock/${sha256Hex(bytes)}.jpg`;
}

interface Entry {
  readonly sha: string;
  readonly bytes: number;
}

export interface PreviewCache {
  put(bytes: Uint8Array): Promise<string>;
  has(url: string): boolean;
}

export function createPreviewCache(options: { maxBytes?: number; root?: string } = {}): PreviewCache {
  const maxBytes = options.maxBytes ?? PREVIEW_CAP_BYTES;
  const entries: Entry[] = [];
  const total = () => entries.reduce((sum, entry) => sum + entry.bytes, 0);
  return {
    async put(bytes) {
      const url = previewUrlFor(bytes);
      const sha = sha256Hex(bytes);
      const existing = entries.findIndex((entry) => entry.sha === sha);
      if (existing >= 0) {
        const kept = entries[existing];
        if (kept) {
          entries.splice(existing, 1);
          entries.push(kept);
        }
        return url;
      }
      entries.push({ sha, bytes: bytes.byteLength });
      const dropped: string[] = [];
      while (entries.length > 1 && total() > maxBytes) {
        const oldest = entries.shift();
        if (oldest) dropped.push(oldest.sha);
      }
      const root = options.root;
      if (root) {
        await mkdir(root, { recursive: true });
        await writeFile(join(root, `${sha}.jpg`), bytes);
        await Promise.all(dropped.map((id) => rm(join(root, `${id}.jpg`), { force: true })));
      }
      return url;
    },
    has(url) {
      const sha = /([0-9a-f]{64})/.exec(url)?.[1];
      return sha != null && entries.some((entry) => entry.sha === sha);
    },
  };
}
