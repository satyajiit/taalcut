// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { decodeWaveformHeader, encodeWaveformPeaks } from '../src/previews/peaks';
import {
  parseBlackdetect,
  parseEbur128,
  parseFreezedetect,
  parseSceneScores,
  parseSsim,
} from '../src/primitives/parsers';

describe('analysis parsers', () => {
  it('reads a score for every scdet sample, including a flat frame', () => {
    const text = [
      'frame:0 pts:0 pts_time:0',
      'lavfi.scd.mafd=1.5',
      'lavfi.scd.score=0',
      'frame:1 pts:1 pts_time:0.5',
      'lavfi.scd.score=12.25',
      'lavfi.scd.mafd=40',
    ].join('\n');
    expect(parseSceneScores(text)).toEqual([
      { timeSec: 0, score: 0, mafd: 1.5 },
      { timeSec: 0.5, score: 12.25, mafd: 40 },
    ]);
  });

  it('counts each sample once when scdet logs its own score line too', () => {
    const text = [
      '[Parsed_scdet_0 @ 0x1] lavfi.scd.score: 0.000, lavfi.scd.time: 0',
      '[Parsed_metadata_1 @ 0x2] frame:0    pts:0       pts_time:0',
      '[Parsed_metadata_1 @ 0x2] lavfi.scd.mafd=0.000',
      '[Parsed_metadata_1 @ 0x2] lavfi.scd.score=0.000',
      '[Parsed_metadata_1 @ 0x2] lavfi.scd.time=0',
      '[Parsed_scdet_0 @ 0x1] lavfi.scd.score: 0.969, lavfi.scd.time: 0.0333333',
      '[Parsed_metadata_1 @ 0x2] frame:1    pts:512     pts_time:0.0333333',
      '[Parsed_metadata_1 @ 0x2] lavfi.scd.mafd=0.969',
      '[Parsed_metadata_1 @ 0x2] lavfi.scd.score=0.969',
      '[Parsed_metadata_1 @ 0x2] lavfi.scd.time=0.0333333',
    ].join('\n');
    expect(parseSceneScores(text)).toEqual([
      { timeSec: 0, score: 0, mafd: 0 },
      { timeSec: 0.0333333, score: 0.969, mafd: 0.969 },
    ]);
  });

  it('parses black, freeze-to-end, ebur128 and ssim', () => {
    expect(parseBlackdetect('black_start:0 black_end:1.5 black_duration:1.5')).toEqual([
      { startSec: 0, endSec: 1.5 },
    ]);
    expect(parseFreezedetect('lavfi.freezedetect.freeze_start: 2', 4)).toEqual([{ startSec: 2, endSec: 4 }]);
    const loud = parseEbur128(
      'Integrated loudness:\n  I:         -23.0 LUFS\n  LRA:         3.0 LU\n  Peak:       -1.5 dBFS',
    );
    expect(loud).toEqual({ integratedLufs: -23, loudnessRange: 3, truePeakDbtp: -1.5 });
    const silent = parseEbur128('I: -70.0 LUFS\nLRA: 0.0 LU\nPeak: -inf dBFS');
    expect(silent).toEqual({ integratedLufs: -70, loudnessRange: 0, truePeakDbtp: Number.NEGATIVE_INFINITY });
    const ssim = parseSsim('n:1 Y:1 U:1 V:1 All:0.990\nn:2 Y:1 U:1 V:1 All:0.980\n', 'SSIM All:0.985');
    expect(ssim.frames).toHaveLength(2);
    expect(ssim.mean).toBeCloseTo(0.985);
  });

  it('writes a little-endian peak header and min/max pairs', () => {
    const samples = Int16Array.from([0, 100, -50, 20]);
    const body = encodeWaveformPeaks(samples, 4, 4);
    expect(decodeWaveformHeader(body)).toEqual({ version: 1, bucketsPerSec: 4, count: 4 });
    expect(body.readInt16LE(12)).toBe(0);
    expect(body.readInt16LE(14)).toBe(0);
    expect(body.readInt16LE(16)).toBe(100);
    expect(body.readInt16LE(18)).toBe(100);
  });
});
