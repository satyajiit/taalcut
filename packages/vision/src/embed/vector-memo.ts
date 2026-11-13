// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Embed each frame once (IX-E5): the embedder remembers the vectors of the
 * frames it embedded lately, keyed by the frame's own pixels. Shot detection
 * embeds the frames around each cut; `vision.embed` then asks for some of the
 * same frames (its extras snap onto them, embed-stages.ts), decoded the same
 * way at the same size, so their bytes match and the model doesn't run again.
 * A frame decoded differently simply misses. Bounded: the oldest entries go
 * first (a 768-wide vector is 3 KiB, so the default holds about 12 MiB).
 */
import { createHash } from 'node:crypto';
import type { EmbeddingImage } from './model';

export interface VectorMemo {
  key(image: EmbeddingImage): string;
  get(key: string): Float32Array | undefined;
  set(key: string, vector: Float32Array): void;
  readonly size: number;
  /** Lookups that found a vector, since the memo was made. */
  readonly hits: number;
  clear(): void;
}

export const DEFAULT_MEMO_ENTRIES = 4096;

export function createVectorMemo(maxEntries = DEFAULT_MEMO_ENTRIES): VectorMemo {
  const entries = new Map<string, Float32Array>();
  let hits = 0;
  return {
    key: (image) =>
      createHash('sha256').update(`${image.width}x${image.height}:`).update(image.rgb).digest('base64url'),
    get(key) {
      const vector = entries.get(key);
      if (!vector) return undefined;
      // Most recently used last, so eviction takes the oldest.
      entries.delete(key);
      entries.set(key, vector);
      hits++;
      return vector;
    },
    set(key, vector) {
      entries.delete(key);
      entries.set(key, vector);
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },
    get size() {
      return entries.size;
    },
    get hits() {
      return hits;
    },
    clear: () => entries.clear(),
  };
}
