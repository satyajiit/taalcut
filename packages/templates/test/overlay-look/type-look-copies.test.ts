// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: the type reading through what a real copy does to type: the softening of a scale and an encode, shadows
 * that are still because the picture is, hard shadows, lines set tight, tails under the line; and the reading on
 * an overlay's design. Drawn against measured, as type-look.test.ts; the table is printed.
 */
import { overlayDesignSchema } from '@taalcut/core';
import { afterAll, describe, expect, it } from 'vitest';
import { readDesign, STEM_WEIGHTS, weightOfStem, type TypeRead } from '../../src/overlay-look';
import {
  drawType,
  halved,
  layout,
  readDrawn,
  rowOf,
  softenType,
  TYPE_FRAME,
  type Colour,
  type DrawnType,
} from '../helpers/type-frames';

const WHITE: Colour = [255, 255, 255];
const BLACK: Colour = [0, 0, 0];
const SKY: Colour = [120, 150, 190];

const base: DrawnType = {
  text: 'HOLE HOT',
  at: [60, 40],
  height: 28,
  stem: 5,
  letterWidth: 22,
  gap: 8,
  ink: WHITE,
};

const table: string[] = [];

function measure(name: string, drawn: DrawnType, soft = false): TypeRead {
  const read = readDrawn(drawn, { soft });
  table.push(rowOf(name, drawn, read));
  expect(read, name).not.toBeNull();
  return read!;
}

const near = (measured: readonly number[], drawn: readonly number[], within = 24) =>
  measured.every((value, index) => Math.abs(value - drawn[index]!) <= within);

afterAll(() => {
  console.warn(`\nTXT1 type reading through a copy, drawn → measured\n${table.join('\n')}\n`);
});

describe('reading type through a soft copy (TXT1)', () => {
  it('reads a stem to half a pixel though its edges are soft', () => {
    for (const stem of [3, 4, 5, 7]) {
      const read = measure(`white, stem ${stem}, soft copy`, { ...base, stem }, true);
      expect(Math.abs(read.stem - stem), `stem ${stem}`).toBeLessThanOrEqual(0.5);
      expect(read.height).toBeCloseTo(28, 0);
      expect(read.outline).toBeNull();
      expect(near(read.fill, WHITE)).toBe(true);
    }
  });

  it('keeps an outline, its width and its colour', () => {
    const drawn: DrawnType = {
      ...base,
      stem: 7,
      letterWidth: 24,
      gap: 9,
      outline: { colour: BLACK, width: 3 },
    };
    const read = measure('heavy white, black outline, soft copy', drawn, true);
    expect(Math.abs(read.stem - 7)).toBeLessThanOrEqual(0.5);
    expect(near(read.fill, WHITE)).toBe(true);
    expect(read.outline && near(read.outline.colour, BLACK)).toBe(true);
    expect(Math.abs(read.outline!.width - 3)).toBeLessThanOrEqual(0.5);
    expect(read.shadow).toBe(false);
    const inverse = measure(
      'black, white outline, soft copy',
      { ...base, ink: BLACK, outline: { colour: WHITE, width: 3 } },
      true,
    );
    expect(near(inverse.fill, BLACK)).toBe(true);
    expect(inverse.outline && near(inverse.outline.colour, WHITE)).toBe(true);
  });

  it('reads a narrow outline a little wide and a little toward the letters: every pixel of it is mixed', () => {
    const drawn: DrawnType = { ...base, outline: { colour: BLACK, width: 2 } };
    const read = measure('white, 2 px outline, soft copy', drawn, true);
    expect(read.outline).not.toBeNull();
    expect(Math.abs(read.outline!.width - 2)).toBeLessThanOrEqual(1);
    expect(near(read.outline!.colour, BLACK, 60)).toBe(true);
    expect(Math.abs(read.stem - 5)).toBeLessThanOrEqual(0.5);
  });

  it('takes a soft edge against a still picture for no outline', () => {
    const yellow: Colour = [250, 214, 60];
    const drawn: DrawnType = { ...base, text: 'HOLE', stem: 4, ink: yellow, still: [24, 40, 88] };
    const read = measure('yellow on a still picture, soft copy', drawn, true);
    expect(read.outline).toBeNull();
    expect(read.shadow).toBe(false);
    expect(Math.abs(read.stem - 4)).toBeLessThanOrEqual(0.5);
    expect(near(read.fill, yellow)).toBe(true);
  });

  it('keeps an outline on a still picture though the mix of the two tones passes near the picture’s colour', () => {
    const drawn: DrawnType = {
      ...base,
      text: 'HOLE',
      stem: 6,
      still: SKY,
      outline: { colour: BLACK, width: 3 },
    };
    const read = measure('white, black outline, still, soft copy', drawn, true);
    expect(near(read.fill, WHITE)).toBe(true);
    expect(read.outline && near(read.outline.colour, BLACK)).toBe(true);
    expect(Math.abs(read.outline!.width - 3)).toBeLessThanOrEqual(1);
    expect(read.shadow).toBe(false);
  });
});

describe('reading type in a copy at half the size (TXT1)', () => {
  // Drawn at odd offsets and twice the size, so in the copy every edge falls mid-pixel and stems are fractions.
  const twice: DrawnType = { ...base, at: [21, 31], height: 48, letterWidth: 40, gap: 13 };
  const read = (name: string, drawn: DrawnType) => {
    const got = readDrawn(drawn, { half: true });
    table.push(rowOf(name, halved(drawn), got));
    expect(got, name).not.toBeNull();
    return got!;
  };

  /** The stem's share of the height within 0.006 of the drawn one, and the same weight where no threshold is that near. */
  const sameWeight = (name: string, got: TypeRead, share: number) => {
    expect(Math.abs(got.stem / got.height - share), name).toBeLessThanOrEqual(0.006);
    if (STEM_WEIGHTS.every(([below]) => Math.abs(below - share) > 0.006))
      expect(weightOfStem(got.stem / got.height), name).toBe(weightOfStem(share));
  };

  it('reads a stem and the letters’ height to a fraction of a pixel, so the weight is the drawn one', () => {
    for (const stem of [4, 5, 6, 7, 9, 11]) {
      const name = `white, stem ${stem / 2}, half-size copy`;
      const got = read(name, { ...twice, stem });
      expect(Math.abs(got.stem - stem / 2), name).toBeLessThanOrEqual(0.15);
      expect(Math.abs(got.height - 24), name).toBeLessThanOrEqual(0.3);
      sameWeight(name, got, stem / 48);
    }
  });

  it('reads an outline of a pixel or two to a quarter of a pixel, and the stems inside it', () => {
    for (const width of [2, 3, 4, 5]) {
      const name = `white, ${width / 2} px outline, half-size copy`;
      const got = read(name, { ...twice, stem: 9, outline: { colour: BLACK, width } });
      expect(got.outline, name).not.toBeNull();
      expect(Math.abs(got.outline!.width - width / 2), name).toBeLessThanOrEqual(0.25);
      expect(near(got.outline!.colour, BLACK), name).toBe(true);
      expect(Math.abs(got.stem - 4.5), name).toBeLessThanOrEqual(0.15);
      sameWeight(name, got, 9 / 48);
    }
  });
});

describe('reading shadows (TXT1)', () => {
  const shadow = { alpha: 0.75, reach: 9, down: 2 };

  it('reads a soft shadow in a soft copy, and no outline', () => {
    const read = measure('white, soft shadow, soft copy', { ...base, text: 'HOTEL', shadow }, true);
    expect(read.shadow).toBe(true);
    expect(read.outline).toBeNull();
    expect(Math.abs(read.stem - 5)).toBeLessThanOrEqual(0.5);
  });

  it('tells a shadow that is still because the picture is from an outline', () => {
    for (const soft of [false, true]) {
      const name = `white, soft shadow, still${soft ? ', soft copy' : ''}`;
      const read = measure(name, { ...base, text: 'HOTEL', still: SKY, shadow }, soft);
      expect(read.shadow, name).toBe(true);
      expect(read.outline, name).toBeNull();
      expect(near(read.fill, WHITE), name).toBe(true);
      expect(Math.abs(read.stem - 5), name).toBeLessThanOrEqual(0.5);
    }
  });

  it('reads an outline and a shadow together', () => {
    const drawn: DrawnType = {
      ...base,
      text: 'HOTEL',
      outline: { colour: BLACK, width: 2 },
      shadow: { alpha: 0.75, reach: 10, down: 3 },
    };
    const read = measure('white, 2 px outline, soft shadow', drawn);
    expect(read.shadow).toBe(true);
    expect(read.outline && near(read.outline.colour, BLACK)).toBe(true);
    expect(Math.abs(read.outline!.width - 2)).toBeLessThanOrEqual(1);
  });

  it('reads a hard shadow as a shadow, not as letters or an outline', () => {
    const read = measure('white, hard black shadow', {
      ...base,
      text: 'HOTEL',
      hard: { colour: BLACK, by: 3 },
    });
    expect(read.shadow).toBe(true);
    expect(read.outline).toBeNull();
    expect(near(read.fill, WHITE)).toBe(true);
    expect(Math.abs(read.stem - 5)).toBeLessThanOrEqual(0.5);
    expect(read.confidence).toBeLessThan(0.8);
  });

  it('can’t see an outline the colour of a still picture', () => {
    const still: Colour = [20, 22, 26];
    const read = measure('white, black outline, dark still', {
      ...base,
      still,
      outline: { colour: BLACK, width: 3 },
    });
    expect(read.outline).toBeNull();
    expect(near(read.fill, WHITE)).toBe(true);
  });
});

describe('reading lines of type (TXT1)', () => {
  it('measures the letters’ height on each line, to the baseline', () => {
    const tight = measure('two lines set tight, tails', { ...base, text: 'HOqE\nTOLL', leading: 3 });
    expect(tight.height).toBeCloseTo(28, 0);
    expect(Math.abs(tight.stem - 5)).toBeLessThanOrEqual(0.5);
    expect(tight.spacing).toBeCloseTo(8, 0);
    const tails = measure('tails under the line', { ...base, text: 'HOqE qOqO' });
    expect(tails.height).toBeCloseTo(28, 0);
    // Stems alone at the foot of a line are not tails.
    expect(measure('two letters, stems at the foot', { ...base, text: 'TT' }).height).toBeCloseTo(28, 0);
  });

  it('leaves one-stem letters out of how wide the letters are set', () => {
    const read = measure('with I and L', { ...base, text: 'HILL TOE' });
    expect(read.width).toBe('normal');
    expect(Math.abs(read.stem - 5)).toBeLessThanOrEqual(0.5);
  });
});

describe('the reading on an overlay’s design (TXT1)', () => {
  const region = { left: 0, top: 0, right: TYPE_FRAME.width, bottom: TYPE_FRAME.height };
  const designOf = (drawn: DrawnType, soft = false) => {
    const settled = drawType(drawn).map((frame) => (soft ? softenType(frame) : frame));
    return readDesign({
      width: TYPE_FRAME.width,
      height: TYPE_FRAME.height,
      region,
      words: layout(drawn).words,
      start: 30,
      end: 90,
      settled,
      edges: { frames: [] },
      letters: drawn.text.replace(/\s/g, '').length,
    });
  };

  it('carries the type, the letters’ colour, their outline and their weight', () => {
    const drawn: DrawnType = {
      ...base,
      stem: 7,
      letterWidth: 24,
      gap: 9,
      outline: { colour: BLACK, width: 3 },
    };
    const design = designOf(drawn)!;
    expect(design.kind).toBe('plain');
    expect(design.colors).toEqual({ fill: null, text: '#ffffff', stroke: '#000000' });
    expect(design.font).toEqual({ class: 'sans', weight: 800 });
    expect(design.type).toMatchObject({ shadow: false, width: 'normal' });
    expect(design.type!.stem).toBeCloseTo(7 / 28, 2);
    expect(design.type!.outline).toBeCloseTo(3 / 28, 2);
    expect(design.type!.spacing).toBeCloseTo(9 / 28, 2);
    expect(design.type!.confidence).toBeGreaterThanOrEqual(0.8);
    expect(overlayDesignSchema.safeParse(design).success).toBe(true);
  });

  it('claims no outline on a shape, and keeps the letters’ colour', () => {
    const ink: Colour = [20, 20, 24];
    const drawn: DrawnType = {
      ...base,
      text: 'HOTEL',
      stem: 4,
      ink,
      shape: { pad: 14, fill: [245, 245, 245] },
    };
    const design = designOf(drawn, true)!;
    expect(design.kind).not.toBe('plain');
    expect(design.colors.stroke).toBeNull();
    expect(design.colors.text).toBe('#141418');
    expect(design.type).toMatchObject({ outline: null, shadow: false });
    expect(design.type!.stem).toBeCloseTo(4 / 28, 2);
    expect(design.font.weight).toBe(500);
  });

  it('is the design as it was where the type can’t be told', () => {
    // One frame of a picture: the letters can't be told from it, so nothing of TXT1 is on the design.
    const settled = drawType(base, 1);
    const words = layout(base).words;
    const design = readDesign({
      width: TYPE_FRAME.width,
      height: TYPE_FRAME.height,
      region,
      words,
      start: 30,
      end: 90,
      settled,
      edges: { frames: [] },
    });
    expect(design?.type).toBeUndefined();
    expect(design?.colors.stroke ?? null).toBeNull();
  });
});
