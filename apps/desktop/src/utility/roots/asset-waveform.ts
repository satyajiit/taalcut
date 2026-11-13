// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The clip page's sound lane (UX2): a clip's waveform file, read from the media cache in the agent process and
 * summarised for the asset detail. The cache may have evicted the file since media.previews wrote it; the page then
 * draws no sound lane until the stage runs again, which is what null tells the library.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DERIVED_KEY_PATTERN, type DerivedFileRef, type WaveformSummary } from '@taalcut/core';
import type { WaveformReader } from '@taalcut/library';
import { summariseWaveformPeaks } from '@taalcut/media';

/** Enough buckets for a sharp sound lane at the widest window (two per CSS pixel on a 2,000 px strip). */
const SUMMARY_BUCKETS = 1200;
const MAX_CACHED_SUMMARIES = 256;

export function cachedWaveformReader(
  cacheRoot: string,
  warn: (line: string) => void = (line) => console.warn(line),
): WaveformReader {
  const cache = new Map<string, WaveformSummary>();
  return async (ref: DerivedFileRef): Promise<WaveformSummary | null> => {
    // The key is checked before it touches the filesystem: it stays inside the cache folder.
    if (ref.kind !== 'waveform' || !DERIVED_KEY_PATTERN.test(ref.key)) return null;
    const cached = cache.get(ref.key);
    if (cached) {
      cache.delete(ref.key);
      cache.set(ref.key, cached);
      return cached;
    }
    const body = await readFile(join(cacheRoot, ref.key)).then(
      (bytes) => ({ ok: true as const, bytes }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    if (!body.ok) {
      const code = (body.error as NodeJS.ErrnoException | null)?.code;
      if (code !== 'ENOENT') warn(`[library] waveform ${ref.key} not read: ${code ?? String(body.error)}`);
      return null;
    }
    const summary = summariseWaveformPeaks(body.bytes, SUMMARY_BUCKETS);
    if (!summary) {
      warn(`[library] waveform ${ref.key} is not a version-1 waveform`);
      return null;
    }
    if (cache.size >= MAX_CACHED_SUMMARIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(ref.key, summary);
    return summary;
  };
}
