// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Template } from '@taalcut/core';

/**
 * A waveform flattened before REF1 (keep's `04e87739`): the breakdown clamped an unscaled onset envelope to 1, so
 * more than half its peaks are exactly 1 and there is no shape left to draw. A waveform scaled to its loudest frame
 * has 1 once or a few times. The same rule as the templates package's `flattenedWaveform`, which the kit can't import.
 */
export function flattenedWaveform(peaks: readonly number[]): boolean {
  let ones = 0;
  for (const peak of peaks) if (peak >= 1) ones += 1;
  return peaks.length > 0 && ones * 2 > peaks.length;
}

/** The reel's waveform to draw: null when it has none, no peaks, or a flattened one (drawn as none). */
export function reelWaveform(template: Template): NonNullable<Template['audio']['waveform']> | null {
  const waveform = template.audio.waveform;
  return waveform && waveform.peaks.length > 0 && !flattenedWaveform(waveform.peaks) ? waveform : null;
}
