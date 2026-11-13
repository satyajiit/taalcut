// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { ctcDecode, ctcDecodeBatch } from '../../src/ocr/paddle/ctc';
import { dbBoxes, mergeLines } from '../../src/ocr/paddle/db';
import {
  cropRgb,
  detGeometry,
  detTensor,
  recTensor,
  recWidth,
  resizeRgb,
  REC_BASE_WIDTH,
  REC_HEIGHT,
  REC_MAX_WIDTH,
} from '../../src/ocr/paddle/preprocess';

const CHARSET = ['क', 'ा', 'म', '1'];

/** One-hot-ish probability rows for a class sequence, 6 classes (blank, 4 chars, space). */
function rows(classes: number[], width = CHARSET.length + 2, p = 0.9): Float32Array {
  const data = new Float32Array(classes.length * width);
  classes.forEach((c, t) => {
    for (let k = 0; k < width; k++) data[t * width + k] = k === c ? p : (1 - p) / (width - 1);
  });
  return data;
}

describe('detector preprocessing', () => {
  it('sizes the long side to 960 with sides on multiples of 32', () => {
    expect(detGeometry(1080, 1920)).toEqual({ width: 544, height: 960 });
    expect(detGeometry(1920, 1080)).toEqual({ width: 960, height: 544 });
    expect(detGeometry(100, 10)).toEqual({ width: 960, height: 96 });
    expect(detGeometry(4000, 10)).toEqual({ width: 960, height: 32 });
  });

  it('normalises BGR with ImageNet mean and std in BGR order', () => {
    // A 2×1 frame: pure red then pure blue.
    const frame = { data: new Uint8Array([255, 0, 0, 0, 0, 255]), width: 2, height: 1 };
    const t = detTensor(frame);
    expect(t.dims).toEqual([1, 3, 480, 960]);
    const plane = t.width * t.height;
    // Top-left pixel is red: B channel (0) is 0, R channel (2) is 1.
    expect(t.data[0]).toBeCloseTo((0 - 0.485) / 0.229);
    expect(t.data[2 * plane]).toBeCloseTo((1 - 0.406) / 0.225);
    // Last column is blue: B channel is 1.
    expect(t.data[t.width - 1]).toBeCloseTo((1 - 0.485) / 0.229);
  });

  it('resizes and crops rgb24', () => {
    const src = { data: new Uint8Array([0, 0, 0, 200, 200, 200]), width: 2, height: 1 };
    expect(resizeRgb(src, 2, 1)).toBe(src);
    const up = resizeRgb(src, 4, 1);
    expect([...up.data].filter((_, i) => i % 3 === 0)).toEqual([0, 50, 150, 200]);
    const crop = cropRgb(
      { data: new Uint8Array(4 * 4 * 3).map((_, i) => i), width: 4, height: 4 },
      1.2,
      1,
      3,
      2.5,
    );
    expect(crop && [crop.width, crop.height]).toEqual([2, 2]);
    expect(crop?.data[0]).toBe((1 * 4 + 1) * 3);
    expect(cropRgb(src, 5, 0, 6, 1)).toBeNull();
  });
});

describe('recogniser preprocessing', () => {
  it('keeps height 48, aspect and the 320 base width, capped', () => {
    expect(recWidth({ width: 100, height: 48 })).toEqual({ resized: 100, padded: REC_BASE_WIDTH });
    expect(recWidth({ width: 960, height: 48 })).toEqual({ resized: 960, padded: 960 });
    expect(recWidth({ width: 10_000, height: 48 }).padded).toBe(REC_MAX_WIDTH);
  });

  it('batches crops right-padded with zeros, (x/255 − 0.5)/0.5 in BGR', () => {
    const white = { data: new Uint8Array(96 * 48 * 3).fill(255), width: 96, height: 48 };
    const red = {
      data: new Uint8Array(48 * 48 * 3).map((_, i) => (i % 3 === 0 ? 255 : 0)),
      width: 48,
      height: 48,
    };
    const t = recTensor([white, red]);
    expect(t.dims).toEqual([2, 3, REC_HEIGHT, REC_BASE_WIDTH]);
    const plane = REC_HEIGHT * REC_BASE_WIDTH;
    expect(t.data[0]).toBe(1);
    expect(t.data[100]).toBe(0);
    // Second crop, R is channel 2 in BGR.
    expect(t.data[3 * plane + 2 * plane]).toBe(1);
    expect(t.data[3 * plane]).toBe(-1);
  });
});

describe('DB post-processing', () => {
  it('finds scored, unclipped boxes and maps them to the frame', () => {
    const width = 40;
    const height = 20;
    const map = new Float32Array(width * height);
    // A strong 20×4 text region and a weak blob that fails box_thresh.
    for (let y = 8; y < 12; y++) for (let x = 5; x < 25; x++) map[y * width + x] = 0.95;
    for (let y = 2; y < 5; y++) for (let x = 30; x < 34; x++) map[y * width + x] = 0.35;
    const boxes = dbBoxes({ data: map, width, height }, 400, 200);
    expect(boxes.length).toBe(1);
    const box = boxes[0]!;
    const grow = (20 * 4 * 1.5) / (2 * 24);
    expect(box.x0).toBeCloseTo((5 - grow) * 10);
    expect(box.y1).toBeCloseTo((12 + grow) * 10);
    expect(box.score).toBeCloseTo(0.95);
  });

  it('applies a sigmoid to logits and ignores specks', () => {
    const map = new Float32Array(10 * 10).fill(-8);
    for (let y = 2; y < 6; y++) for (let x = 2; x < 8; x++) map[y * 10 + x] = 6;
    map[99] = 6;
    const boxes = dbBoxes({ data: map, width: 10, height: 10 }, 10, 10);
    expect(boxes.length).toBe(1);
    expect(boxes[0]!.score).toBeGreaterThan(0.99);
  });

  it('joins words of one line, keeps separate lines and far-apart boxes apart', () => {
    const word = (x0: number, x1: number, y0 = 10, y1 = 30) => ({ x0, y0, x1, y1, score: 0.9 });
    const lines = mergeLines([word(60, 100), word(10, 50), word(10, 40, 50, 70), word(400, 450)]);
    expect(lines.map((l) => [l.x0, l.x1, l.y0])).toEqual([
      [10, 100, 10],
      [400, 450, 10],
      [10, 40, 50],
    ]);
  });
});

describe('CTC decoding', () => {
  it('collapses repeats, drops blanks and reads the space class', () => {
    // क क blank क ा space म 1
    const line = ctcDecode(rows([1, 1, 0, 1, 2, 5, 3, 4]), 8, 6, CHARSET);
    expect(line.text).toBe('कका म1');
    expect(line.confidence).toBeCloseTo(0.9);
  });

  it('turns logits into probabilities and handles empty reads', () => {
    const logits = new Float32Array([0, 5, 0, 0, 0, 0]);
    const line = ctcDecode(logits, 1, 6, CHARSET);
    expect(line.text).toBe('क');
    expect(line.confidence).toBeCloseTo(Math.exp(5) / (Math.exp(5) + 5));
    expect(ctcDecode(rows([0, 0]), 2, 6, CHARSET)).toEqual({ text: '', confidence: 0 });
    expect(() => ctcDecode(rows([0]), 1, 6, ['a'])).toThrow(RangeError);
  });

  it('decodes a batch and a head without the space class', () => {
    const data = new Float32Array([...rows([1, 2]), ...rows([3, 0])]);
    expect(ctcDecodeBatch(data, [2, 2, 6], CHARSET).map((l) => l.text)).toEqual(['का', 'म']);
    expect(ctcDecodeBatch(rows([4], 5), [1, 5], CHARSET).map((l) => l.text)).toEqual(['1']);
  });
});
