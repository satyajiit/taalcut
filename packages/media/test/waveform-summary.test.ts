// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** UX2: a waveform file in brief, for the clip page's sound lane. */
import { describe, expect, it } from 'vitest';
import { encodeWaveformPeaks, summariseWaveformPeaks, WAVEFORM_SUMMARY_MAX } from '../src/previews/peaks';

describe('summariseWaveformPeaks', () => {
  it('gives each bucket’s loudest sample from 0 to 1', () => {
    // 4 samples a bucket at 4 buckets a second: quiet, full scale up, full scale down, silence.
    const samples = Int16Array.from([100, -100, 50, 0, 32767, 0, 0, 0, 0, -32768, 0, 0, 0, 0, 0, 0]);
    const summary = summariseWaveformPeaks(encodeWaveformPeaks(samples, 16, 4));
    expect(summary).toEqual({ bucketsPerSecond: 4, peaks: [0.003, 1, 1, 0] });
  });

  it('merges buckets down to the most asked for, keeping the loudest', () => {
    const samples = new Int16Array(100 * 80).fill(0);
    samples[10] = 16384;
    const summary = summariseWaveformPeaks(encodeWaveformPeaks(samples, 8000, 100), 10);
    expect(summary?.peaks).toHaveLength(10);
    expect(summary?.bucketsPerSecond).toBeCloseTo(10);
    expect(summary?.peaks[0]).toBe(0.5);
    expect(summary?.peaks.slice(1).every((peak) => peak === 0)).toBe(true);
  });

  it('never gives more than the contract carries', () => {
    const summary = summariseWaveformPeaks(encodeWaveformPeaks(new Int16Array(9000), 1, 1), 1_000_000);
    expect(summary?.peaks.length).toBeLessThanOrEqual(WAVEFORM_SUMMARY_MAX);
  });

  it('refuses a file that isn’t a whole version-1 waveform', () => {
    const body = encodeWaveformPeaks(new Int16Array(64), 16, 4);
    expect(summariseWaveformPeaks(body.subarray(0, 8))).toBeUndefined();
    expect(summariseWaveformPeaks(body.subarray(0, body.length - 2))).toBeUndefined();
    const other = Buffer.from(body);
    other.writeUInt32LE(2, 0);
    expect(summariseWaveformPeaks(other)).toBeUndefined();
  });
});
