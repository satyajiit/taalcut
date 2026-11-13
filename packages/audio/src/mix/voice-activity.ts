// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where someone speaks, from the dry voice stem render wrote (SPEC P3.5 "Voiced windows"). The planner's port
 * hands it stems, not transcripts, and the stem holds only voice-over lines and kept clip speech, so its own
 * momentary loudness is the most direct signal: a 100 ms frame is voiced when its 400 ms loudness is above an
 * absolute floor and within 25 LU of the stem's loudest. Windows are padded 120 ms before and 80 ms after, and
 * gaps under 300 ms are merged, so a breath doesn't let the music swell. Pure.
 */
import { MIX_CONFIG } from './config';

export interface Window {
  readonly startMs: number;
  readonly endMs: number;
}

export function voicedFrames(momentary: readonly number[]): boolean[] {
  const peak = momentary.reduce((max, v) => Math.max(max, v), MIX_CONFIG.envelope.silenceLufs);
  const gate = Math.max(MIX_CONFIG.voice.floorLufs, peak - MIX_CONFIG.voice.belowPeakLu);
  return momentary.map((v) => v > gate);
}

export function voicedWindows(momentary: readonly number[], durationMs: number): Window[] {
  const hop = MIX_CONFIG.hopMs;
  const frames = voicedFrames(momentary);
  const raw: Window[] = [];
  frames.forEach((voiced, i) => {
    if (!voiced) return;
    // Momentary loudness at frame i covers the 400 ms ending at (i + 1) × hop.
    const startMs = Math.max(0, (i + 1) * hop - 400);
    const endMs = (i + 1) * hop;
    const last = raw.at(-1);
    if (last && startMs <= last.endMs) raw[raw.length - 1] = { startMs: last.startMs, endMs };
    else raw.push({ startMs, endMs });
  });
  const padded = raw.map((w) => ({
    startMs: Math.max(0, w.startMs - MIX_CONFIG.voice.padBeforeMs),
    endMs: Math.min(durationMs, w.endMs + MIX_CONFIG.voice.padAfterMs),
  }));
  const merged: Window[] = [];
  for (const w of padded) {
    const last = merged.at(-1);
    if (last && w.startMs - last.endMs < MIX_CONFIG.voice.mergeGapMs)
      merged[merged.length - 1] = { startMs: last.startMs, endMs: Math.max(last.endMs, w.endMs) };
    else merged.push(w);
  }
  return merged;
}

/** Milliseconds of voice inside [startMs, endMs). */
export function voicedMsIn(windows: readonly Window[], startMs: number, endMs: number): number {
  let total = 0;
  for (const w of windows) total += Math.max(0, Math.min(endMs, w.endMs) - Math.max(startMs, w.startMs));
  return total;
}
