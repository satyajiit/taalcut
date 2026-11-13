// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Waveform peaks the asset audio store took from a pass, held until the waveform asks for them (IX-D4): the
 * speech PCM goes when the transcript is done, which is often before `media.previews` runs (it waits for the
 * proxy). Peaks are small (400 bytes a second of audio), so they outlive the PCM at little cost; taking them
 * removes them, and ones nobody takes go after `idleMs`, then the oldest once they pass `maxBytes`.
 */

export interface KeptPeaks {
  keep(key: string, peaks: Buffer): void;
  /** The asset's peaks, removed from the table; undefined when none are kept. */
  take(key: string): Buffer | undefined;
  sweep(): void;
  clear(): void;
}

export interface KeptPeaksLimits {
  readonly idleMs: number;
  readonly maxBytes: number;
}

export function createKeptPeaks(now: () => number, limits: KeptPeaksLimits): KeptPeaks {
  // Insertion order is age order: `keep` re-inserts.
  const kept = new Map<string, { readonly peaks: Buffer; readonly at: number }>();
  let bytes = 0;
  const remove = (key: string) => {
    const item = kept.get(key);
    if (!item) return undefined;
    kept.delete(key);
    bytes -= item.peaks.length;
    return item.peaks;
  };
  const sweep = () => {
    for (const [key, item] of kept) {
      if (now() - item.at <= limits.idleMs && bytes <= limits.maxBytes) break;
      remove(key);
    }
  };
  return {
    keep(key, peaks) {
      remove(key);
      kept.set(key, { peaks, at: now() });
      bytes += peaks.length;
      sweep();
    },
    take: remove,
    sweep,
    clear() {
      kept.clear();
      bytes = 0;
    },
  };
}
