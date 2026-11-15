// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: the type reading against real faces. The frames are a made video's title as render draws it through the
 * headless shell, in looks whose numbers are known (render's test/style/text-design.int.test.ts keeps them with
 * TXT1_STILLS_DIR set, under `reader/`): what was drawn against what is measured, look by look, printed.
 *
 * Opt-in: it runs with TXT1_READER_DIR set to that folder, and is skipped without it (the frames need the shell).
 * It is a measuring instrument more than a gate. What it holds is little: half the looks are read, a reading's
 * letter colour is the drawn one, an outline is read where one was drawn and nowhere else, and the heaviest face
 * reads heavier than the lightest. The weight, the width and the shadow are printed, not held: on these frames
 * (a still card of saturated bars under the words) they are not reliable, and the SPEC says so with the numbers.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readType, settle, weightOfStem, type RegionImage, type TypeRead } from '../../src/overlay-look';

const DIR = process.env.TXT1_READER_DIR;

interface Drawn {
  readonly name: string;
  readonly text: string;
  readonly look: {
    readonly font: { readonly family: string; readonly weight: number };
    readonly colour: string;
    readonly stroke: { readonly colour: string; readonly widthPx: number } | null;
    readonly shadow?: { readonly colour: string } | null;
  };
  readonly capPx: number;
  readonly region: { readonly width: number; readonly height: number };
  readonly words: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
  readonly frames: readonly string[];
}

const hex = (rgb: readonly number[]) =>
  `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
const rgbOf = (colour: string) => [1, 3, 5].map((at) => parseInt(colour.slice(at, at + 2), 16));
const apart = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(...a.map((value, index) => value - b[index]!));

function measured(dir: string, drawn: Drawn): TypeRead | null {
  const frames: RegionImage[] = drawn.frames.map((file) => ({
    width: drawn.region.width,
    height: drawn.region.height,
    rgb: new Uint8Array(readFileSync(join(dir, file))),
  }));
  // The kept box is the text element's line box, about twice as tall as the letters; a reel's words come with the
  // box OCR found, tight to the letters. The same here: the line's middle, the capitals' height and a little more.
  const middle = (drawn.words.top + drawn.words.bottom) / 2;
  const words = {
    ...drawn.words,
    top: Math.round(middle - drawn.capPx * 0.75),
    bottom: Math.round(middle + drawn.capPx * 0.75),
  };
  return readType({
    frames,
    settled: settle(frames),
    words,
    fill: null,
    within: null,
    letters: (drawn.text.match(/[\p{L}\p{N}]/gu) ?? []).length,
  });
}

describe.skipIf(!DIR || !existsSync(DIR))('reading real faces as render draws them (TXT1)', () => {
  const dir = DIR ?? '';
  const drawn: Drawn[] = existsSync(dir)
    ? readdirSync(dir)
        .filter((file) => file.endsWith('.json'))
        .sort()
        .map((file) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as Drawn)
    : [];
  const reads = new Map(drawn.map((entry) => [entry.name, measured(dir, entry)]));
  const table: string[] = [];

  afterAll(() => {
    console.warn(`\nTXT1 type reading of real faces, drawn → measured\n${table.join('\n')}\n`);
  });

  it('reads every look', () => {
    expect(drawn.length).toBeGreaterThanOrEqual(3);
    for (const entry of drawn) {
      const read = reads.get(entry.name) ?? null;
      const stroke = entry.look.stroke;
      table.push(
        read
          ? `${entry.name} (${entry.look.font.family} ${entry.look.font.weight}): colour ${entry.look.colour} → ` +
              `${hex(read.fill)}; weight ${entry.look.font.weight} → ${weightOfStem(read.stem / read.height)} ` +
              `(stem ${read.stem.toFixed(2)} px of ${read.height.toFixed(1)} px, capitals drawn ` +
              `${entry.capPx.toFixed(1)} px); outline ${stroke ? `${stroke.widthPx} px ${stroke.colour}` : 'none'} → ` +
              `${read.outline ? `${read.outline.width.toFixed(2)} px ${hex(read.outline.colour)}` : 'none'}; ` +
              `shadow ${entry.look.shadow ? 'yes' : 'no'} → ${read.shadow ? 'yes' : 'no'}; width ${read.width} ` +
              `(${read.widthRatio?.toFixed(2) ?? 'unread'}); ` +
              `confidence ${read.confidence}`
          : `${entry.name} (${entry.look.font.family} ${entry.look.font.weight}): no reading`,
      );
    }
    // A look the reader can't read at all is said so in the table. The picture under these words is a still test
    // card of saturated bars, the reader's hardest case, so only half must be read.
    const unread = drawn.filter((entry) => !reads.get(entry.name)).map((entry) => entry.name);
    expect(unread.length, unread.join(', ')).toBeLessThanOrEqual(Math.floor(drawn.length / 2));
  });

  it("reads each look's letter colour, and an outline where one was drawn and none where none was", () => {
    for (const entry of drawn) {
      const read = reads.get(entry.name);
      if (!read) continue;
      expect(apart(read.fill, rgbOf(entry.look.colour)), `${entry.name} colour`).toBeLessThan(48);
      expect(read.outline !== null, `${entry.name} outline`).toBe(entry.look.stroke !== null);
      if (read.outline && entry.look.stroke)
        expect(
          apart(read.outline.colour, rgbOf(entry.look.stroke.colour)),
          `${entry.name} outline`,
        ).toBeLessThan(64);
    }
  });

  it('reads the heaviest drawn face heavier than the lightest', () => {
    const byWeight = [...drawn].sort((a, b) => a.look.font.weight - b.look.font.weight);
    const light = reads.get(byWeight[0]!.name);
    const heavy = reads.get(byWeight.at(-1)!.name);
    if (!light || !heavy) return;
    expect(heavy.stem / heavy.height).toBeGreaterThan(light.stem / light.height);
  });
});
