// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: how a reel sets its letters, measured from frames whose type is drawn with known numbers
 * (helpers/type-frames.ts): what was drawn against what was measured, look by look. The table is printed.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { readType, settle, weightOfStem, type TypeRead } from '../../src/overlay-look';
import { drawType, readDrawn, rowOf, type Colour, type DrawnType } from '../helpers/type-frames';

const WHITE: Colour = [255, 255, 255];
const BLACK: Colour = [0, 0, 0];

const base: DrawnType = {
  text: 'HOLE HOT',
  at: [60, 56],
  height: 28,
  stem: 5,
  letterWidth: 22,
  gap: 8,
  ink: WHITE,
};

const table: string[] = [];

/** Measures `drawn` and adds its row (drawn → measured) to the table. */
function measure(name: string, drawn: DrawnType): TypeRead {
  const read = readDrawn(drawn);
  table.push(rowOf(name, drawn, read));
  expect(read, name).not.toBeNull();
  return read!;
}

const near = (measured: readonly number[], drawn: readonly number[], within = 24) =>
  measured.every((value, index) => Math.abs(value - drawn[index]!) <= within);
/** Within a pixel, or 15 % for a larger measure. */
const close = (measured: number, drawn: number) => Math.abs(measured - drawn) <= Math.max(1, drawn * 0.15);

afterAll(() => {
  console.warn(`\nTXT1 type reading, drawn → measured\n${table.join('\n')}\n`);
});

describe('reading how letters are set (TXT1)', () => {
  it('reads heavy white letters with a black outline', () => {
    const drawn: DrawnType = {
      ...base,
      stem: 7,
      letterWidth: 24,
      gap: 9,
      outline: { colour: BLACK, width: 3 },
    };
    const read = measure('heavy white, black outline', drawn);
    expect(close(read.stem, 7)).toBe(true);
    expect(read.height).toBeCloseTo(28, 0);
    expect(weightOfStem(read.stem / read.height)).toBe(800);
    expect(near(read.fill, WHITE)).toBe(true);
    expect(read.outline && near(read.outline.colour, BLACK)).toBe(true);
    expect(Math.abs(read.outline!.width - 3)).toBeLessThanOrEqual(1);
    expect(read.shadow).toBe(false);
    expect(read.width).toBe('normal');
    expect(close(read.spacing!, 9)).toBe(true);
    expect(read.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('reads thin letters in a colour, with no outline', () => {
    const pink: Colour = [255, 92, 168];
    const drawn: DrawnType = { ...base, text: 'HOTEL', height: 30, stem: 2, gap: 7, ink: pink };
    const read = measure('thin pink, no outline', drawn);
    expect(close(read.stem, 2)).toBe(true);
    expect(weightOfStem(read.stem / read.height)).toBe(200);
    expect(near(read.fill, pink)).toBe(true);
    expect(read.outline).toBeNull();
    expect(read.shadow).toBe(false);
    expect(read.width).toBe('normal');
  });

  it('reads tall narrow letters as condensed, and broad ones as wide', () => {
    const tall: DrawnType = { ...base, text: 'TOLL HOLE', at: [40, 50], height: 36, letterWidth: 14, gap: 4 };
    const condensed = measure('condensed tall', tall);
    expect(condensed.width).toBe('condensed');
    expect(close(condensed.stem, 5)).toBe(true);
    expect(condensed.height).toBeCloseTo(36, 0);
    expect(close(condensed.spacing!, 4)).toBe(true);
    const broad: DrawnType = { ...base, text: 'HOLE', letterWidth: 32, gap: 10 };
    expect(measure('wide', broad).width).toBe('wide');
  });

  it('reads a soft dark shadow, and no outline with it', () => {
    const drawn: DrawnType = { ...base, text: 'HOTEL', shadow: { alpha: 0.75, reach: 9, down: 2 } };
    const read = measure('white, soft shadow', drawn);
    expect(read.shadow).toBe(true);
    expect(read.outline).toBeNull();
    expect(close(read.stem, 5)).toBe(true);
    expect(near(read.fill, WHITE)).toBe(true);
  });

  it('reads letters on a still picture by their colour, less surely', () => {
    const yellow: Colour = [250, 214, 60];
    const drawn: DrawnType = { ...base, text: 'HOLE', stem: 4, ink: yellow, still: [24, 40, 88] };
    const read = measure('yellow on a still picture', drawn);
    expect(close(read.stem, 4)).toBe(true);
    expect(read.height).toBeCloseTo(28, 0);
    expect(near(read.fill, yellow)).toBe(true);
    expect(read.outline).toBeNull();
    expect(read.shadow).toBe(false);
    expect(read.confidence).toBeLessThan(0.7);
  });

  it('reads an outline on a still picture when its colour is not the picture’s', () => {
    const still: Colour = [120, 150, 190];
    const drawn: DrawnType = { ...base, text: 'HOLE', stem: 6, still, outline: { colour: BLACK, width: 3 } };
    const read = measure('white, black outline, still', drawn);
    expect(read.outline && near(read.outline.colour, BLACK)).toBe(true);
    expect(Math.abs(read.outline!.width - 3)).toBeLessThanOrEqual(1);
    expect(close(read.stem, 6)).toBe(true);
    expect(read.shadow).toBe(false);
  });

  it('reads letters on a filled shape', () => {
    const ink: Colour = [20, 20, 24];
    const drawn: DrawnType = {
      ...base,
      text: 'HOTEL',
      height: 24,
      stem: 4,
      letterWidth: 20,
      gap: 6,
      ink,
      shape: { pad: 12, fill: [245, 245, 245] },
    };
    const read = measure('dark on a white shape', drawn);
    expect(close(read.stem, 4)).toBe(true);
    expect(read.height).toBeCloseTo(24, 0);
    expect(near(read.fill, ink)).toBe(true);
    expect(read.outline).toBeNull();
    expect(read.shadow).toBe(false);
  });

  it('answers nothing where there are no letters, or one frame over a picture', () => {
    const frames = drawType({ ...base, text: '', still: [90, 90, 90] });
    const words = { left: 60, top: 56, right: 200, bottom: 84 };
    expect(readType({ frames, settled: settle(frames), words, fill: null })).toBeNull();
    // One frame of a picture: nothing moves, and no colour is the letters' alone.
    expect(readDrawn(base, { frames: 1 })).toBeNull();
  });

  it('is less sure of few frames, and still reads them', () => {
    const sure = readDrawn(base)!.confidence;
    const three = readDrawn(base, { frames: 3 })!;
    const two = readDrawn(base, { frames: 2 })!;
    expect(three.confidence).toBeLessThan(sure);
    expect(two.confidence).toBeLessThan(three.confidence);
    // Two frames leave specks of the picture still: they are not strokes.
    expect(close(two.stem, 5)).toBe(true);
    expect(two.shadow).toBe(false);
  });
});
