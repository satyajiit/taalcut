// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Peak picking and 3-minute window stitching, with no model file. */
import { describe, expect, it } from 'vitest';
import { planWindows, stitchPredictions, type WindowPrediction } from '../../src/beats/aggregate';
import { AUDIO_CONFIG } from '../../src/config';
import { deduplicatePeaks, parabolicShift, pickPeaks } from '../../src/beats/peaks';

const { windowFrames: CHUNK } = AUDIO_CONFIG.beats;

describe('pickPeaks', () => {
  it('keeps a positive local max, merges neighbours, and shifts by the parabola', () => {
    const beat = new Float32Array(16);
    beat[4] = 1;
    beat[5] = 3;
    beat[6] = 2;
    beat[10] = 4;
    beat[11] = 4;
    const down = new Float32Array(16);
    down[6] = 2;
    const peaks = pickPeaks(beat, down);
    expect(deduplicatePeaks([10, 11])).toEqual([10.5]);
    const shift = parabolicShift(5, beat);
    expect(shift).toBeCloseTo(5 + 0.5 * ((1 - 2) / (1 - 6 + 2)), 6);
    expect(peaks.beats[0]).toBeCloseTo(shift, 5);
    expect(peaks.beats.some((frame) => Math.abs(frame - 10.5) < 1e-6)).toBe(true);
    expect(peaks.downbeats[0]).toBeCloseTo(shift, 5);
  });

  it('drops logits that are not above zero', () => {
    const beat = new Float32Array(8);
    beat[3] = -1;
    expect(pickPeaks(beat, beat)).toEqual({ beats: [], downbeats: [] });
  });
});

describe('stitchPredictions', () => {
  it('keeps every frame of a short clip, including frame 0', () => {
    const n = 10;
    const beat = new Float32Array(CHUNK);
    for (let i = 0; i < n; i++) beat[i] = i;
    const stitched = stitchPredictions(n, [{ start: 0, beat, downbeat: beat }]);
    for (let i = 0; i < n; i++) expect(stitched.beat[i]).toBe(i);
  });

  it('reconstructs frame indexes across a 3 minute stitch and lets the earlier window win', () => {
    const n = 3 * 60 * 50;
    const windows = planWindows(n);
    expect(windows.length).toBeGreaterThan(1);
    const pieces: WindowPrediction[] = windows.map((window, index) => {
      const beat = new Float32Array(CHUNK);
      const downbeat = new Float32Array(CHUNK);
      for (let i = 0; i < CHUNK; i++) {
        const frame = window.start + i;
        beat[i] = frame >= 0 && frame < n ? frame : -1000;
        downbeat[i] = index;
      }
      return { start: window.start, beat, downbeat };
    });
    const stitched = stitchPredictions(n, pieces);
    for (let i = 0; i < n; i++) expect(stitched.beat[i]).toBe(i);
    // Border trim tiles ordinary windows. The forced last start overlaps the one before it.
    const last = windows[windows.length - 1]!;
    const seam = last.start + AUDIO_CONFIG.beats.borderFrames;
    expect(stitched.downbeat[seam]).toBe(windows.length - 2);
  });
});
