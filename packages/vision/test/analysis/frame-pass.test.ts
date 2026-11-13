// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-D2: the analysis pass document. Its statistics are the old analyse
 * pass's, frame for frame (every frame's 64×64 change, every n-th frame's
 * stats and signals against the previous sample, and the dHash the best
 * frame used to be hashed with); a stage that finds the document reads it
 * and decodes nothing, a stale one (other sampling) runs the pass again; the
 * OCR frames are kept only when asked for, at the OCR size and spacing.
 */
import { describe, expect, it } from 'vitest';
import {
  analysisPass,
  createPassStats,
  ocrSampling,
  PASS_DOC,
  passParameters,
} from '../../src/analysis/frame-pass';
import { shotSamples } from '../../src/ocr/read-shots';
import { frameSetName } from '../../src/media/media-frame-source';
import { dHash, frameStats, type FrameStats } from '../../src/quality/frame-stats';
import { downsample } from '../../src/quality/shift';
import { sampleSignals } from '../../src/quality/shot-quality';
import { fakeFrameSource } from '../helpers/fake-frame-source';

/** A frame with texture that moves with k, so stats, shifts and changes differ frame to frame. */
const pixel = (k: number, i: number) => ((i % 97) * 3 + k * 5 + Math.floor(i / 256) * 7) % 256;

describe('createPassStats', () => {
  it('computes what the old pass computed, frame by frame', () => {
    const width = 64;
    const height = 36;
    const frames = Array.from({ length: 12 }, (_, index) => ({
      index,
      width,
      height,
      data: Uint8Array.from({ length: width * height }, (_, i) => pixel(index, i)),
    }));
    const stats = createPassStats(3);
    for (const frame of frames) stats.push(frame);

    let previous: FrameStats | undefined;
    let previousThumb: Float32Array | undefined;
    const change: number[] = [];
    const samples = [];
    for (const frame of frames) {
      const thumb = downsample(frame.data, width, height, 64);
      let sum = 0;
      if (previousThumb)
        for (let i = 0; i < thumb.length; i++) sum += Math.abs(previousThumb[i]! - thumb[i]!);
      change.push(previousThumb ? sum / thumb.length : 0);
      previousThumb = thumb;
      if (frame.index % 3 !== 0) continue;
      const s = frameStats(frame);
      samples.push({ ...sampleSignals(s, previous), dHash: dHash(frame.data, width, height) });
      previous = s;
    }
    expect(stats.frameChange).toEqual(change);
    expect(stats.samples).toEqual(samples);
    expect(stats.samples.map((s) => s.index)).toEqual([0, 3, 6, 9]);
  });
});

describe('analysisPass', () => {
  it('runs the pass once and leaves its document; the next stage reads it', async () => {
    const source = fakeFrameSource({
      pixel,
      pass: {
        fine: [
          { index: 0, score: 0, mafd: 0 },
          { index: 2, score: 40, mafd: 9 },
        ],
        coarse: [{ index: 3, score: 12, mafd: 4 }],
        black: [{ startSec: 1, endSec: 2 }],
      },
    });
    const first = await analysisPass(source, { keepOcrFrames: true });
    expect(first.ok).toBe(true);
    expect(source.passes).toHaveLength(1);
    const pass = source.passes[0]!;
    expect(pass).toMatchObject({ longSide: 256, coarseEvery: 3 });
    // Never upscaled: the 320×180 clip's own size.
    expect(pass.keep).toEqual([{ size: { width: 320, height: 180 }, format: 'rgb24', every: 30 }]);
    if (!first.ok) return;
    // Scores sit at their frame; a frame scdet printed nothing for scores 0.
    expect(first.value.fine[2]).toEqual([40, 9]);
    expect(first.value.fine[1]).toEqual([0, 0]);
    expect(first.value.fine).toHaveLength(90);
    expect(first.value.coarse[1]).toEqual([12, 4]);
    expect(first.value.coarse).toHaveLength(30);
    expect(first.value.samples.map((s) => s.index)).toEqual(Array.from({ length: 30 }, (_, i) => i * 3));
    expect(source.docs.has(PASS_DOC)).toBe(true);

    const again = await analysisPass(source);
    expect(source.passes).toHaveLength(1);
    expect(again).toEqual(first);
  });

  it('runs again over a document with other sampling, and keeps no OCR frames unless asked', async () => {
    const source = fakeFrameSource({ pixel });
    source.docs.set(PASS_DOC, { version: 1, longSide: 256, every: 1, coarseEvery: 3 });
    const run = await analysisPass(source);
    expect(run.ok).toBe(true);
    expect(source.passes).toHaveLength(1);
    expect(source.passes[0]!.keep).toBeUndefined();
  });

  it('keeps FFmpeg’s 2 s rule for black and freeze, and every black run for the shots (IX3-D2)', async () => {
    // The pass reports every black run (blackdetect at d=0) and freezes of 2 s or more (freezedetect's default).
    const black = [
      { startSec: 0.5, endSec: 0.9 },
      { startSec: 1.5, endSec: 3.5 },
      { startSec: 4, endSec: 5.99 },
    ];
    const freeze = [{ startSec: 1, endSec: 3.2 }];
    const source = fakeFrameSource({ pixel, pass: { black, freeze } });
    const run = await analysisPass(source);
    if (!run.ok) throw new Error(run.error.code);
    // What vision.analyse reads: only runs of 2 s or more, as the pass at FFmpeg's default minimum gave them.
    expect(run.value.black).toEqual([{ startSec: 1.5, endSec: 3.5 }]);
    expect(run.value.freeze).toEqual(freeze);
    expect(run.value.blackRuns).toEqual(black);
  });

  it('runs the pass again over a document from before every black run was kept (IX3-F5, M3)', async () => {
    const first = fakeFrameSource({ pixel });
    const made = await analysisPass(first);
    if (!made.ok) throw new Error(made.error.code);
    const { blackRuns, ...older } = made.value;
    expect(blackRuns).toEqual([]);
    const source = fakeFrameSource({ pixel });
    source.docs.set(PASS_DOC, older);
    const read = await analysisPass(source);
    // Measured now, and the document rewritten: the next read is a cache hit.
    expect(source.passes).toHaveLength(1);
    expect(read.ok && read.value.blackRuns).toEqual([]);
    await analysisPass(source);
    expect(source.passes).toHaveLength(1);
  });

  it('samples 10 a second at the plan’s rate', () => {
    expect(passParameters(30)).toEqual({ longSide: 256, every: 3, coarseEvery: 3 });
    expect(passParameters(59.94)).toEqual({ longSide: 256, every: 6, coarseEvery: 6 });
    expect(passParameters(1)).toEqual({ longSide: 256, every: 1, coarseEvery: 1 });
  });
});

describe('OCR frames', () => {
  it('reads a shot on the one-a-second grid the pass keeps, or its best frame when none falls inside', () => {
    const source = fakeFrameSource({ width: 1920, height: 1080 });
    expect(ocrSampling(source)).toEqual({ size: { width: 1280, height: 720 }, every: 30 });
    expect(shotSamples({ start: 0, end: 61, bestFrame: 7 }, 30)).toEqual([0, 30, 60]);
    expect(shotSamples({ start: 31, end: 95, bestFrame: 40 }, 30)).toEqual([60, 90]);
    expect(shotSamples({ start: 31, end: 50, bestFrame: 40 }, 30)).toEqual([40]);
  });

  it('names cached frame sets by size and format', () => {
    expect(frameSetName({ width: 1280, height: 720 }, 'rgb24')).toBe('rgb24-1280x720');
    expect(frameSetName({ longSide: 768 }, 'jpeg')).toBe('jpeg-l768');
  });
});

describe('a long video in segments (IX-D7)', () => {
  it('joins per-segment statistics into what one pass computes', async () => {
    const single = fakeFrameSource({ pixel, frames: 120 });
    const one = await analysisPass(single);
    // Segments start on multiples of 3 and decode 6 frames early; frames arrive interleaved.
    const split = fakeFrameSource({
      pixel,
      frames: 120,
      segments: [
        { start: 0, end: 42, from: 0 },
        { start: 42, end: 81, from: 36 },
        { start: 81, end: 120, from: 75 },
      ],
    });
    const three = await analysisPass(split, { parallel: 3 });
    expect(split.passes[0]).toMatchObject({ parallel: 3, align: 3 });
    expect(three.ok && one.ok).toBe(true);
    if (!three.ok || !one.ok) return;
    expect(three.value.samples).toEqual(one.value.samples);
    expect(three.value.frameChange).toEqual(one.value.frameChange);
  });
});
