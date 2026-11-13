// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-SIGN fixtures: made-up reels drawn in code, so the composited-or-scene judge is tested on pixels and OCR that
 * behave like the real thing. A shot is a camera looking at a textured world (with sensor noise); scene text is
 * painted into the world (it moves with the camera, a person walking in front of it hides it); added text is drawn
 * on the frame after everything else (it stays put, crisp, on top). OCR is synthesised from the same geometry: a
 * reading partly hidden comes out misread or not at all, a sign at an angle comes with a skewed quad. Nothing here
 * is real footage or real text.
 */
import { ok, type Box } from '@taalcut/core';
import type { OcrLine, OcrPage, OcrQuad } from '../../src/breakdown/ports';

export type Rgb = readonly [number, number, number];

export interface SceneText {
  readonly kind: 'scene';
  readonly text: string;
  /** Top left in world pixels, and the letters' height. */
  readonly at: { readonly x: number; readonly y: number };
  readonly height: number;
  readonly ink: Rgb;
  /** The sign's panel round the words. */
  readonly panel?: Rgb;
  /** A sign at an angle: how much the OCR quad leans and narrows (0 none, 1 strong). */
  readonly skew?: number;
  /** The shot it is painted in (index). */
  readonly shot: number;
}

export interface AddedText {
  readonly kind: 'added';
  readonly text: string;
  /** Top left on the screen, and the letters' height. */
  readonly at: { readonly x: number; readonly y: number };
  readonly height: number;
  readonly ink: Rgb;
  /** A bubble's, pill's or lower third's fill. */
  readonly fill?: Rgb;
  readonly from: number;
  readonly to: number;
}

export interface Walker {
  readonly from: number;
  readonly to: number;
  /** Screen x of the body's left edge at `from` and at `to`. */
  readonly x0: number;
  readonly x1: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly colour: Rgb;
}

export interface Shot {
  readonly start: number;
  readonly end: number;
  readonly seed: number;
  /** The camera's top left in world pixels at a frame. */
  readonly camera: (frame: number) => { readonly x: number; readonly y: number };
}

export interface Fixture {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly total: number;
  readonly shots: readonly Shot[];
  readonly texts: readonly (SceneText | AddedText)[];
  readonly walkers: readonly Walker[];
  /** Sensor noise, ± luma levels. */
  readonly noise: number;
}

const hash = (a: number, b: number, c: number) => {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

/** A letter's 5×7 cells, from its code: different letters look different, the same letter alike. */
const cell = (char: string, column: number, row: number) =>
  char === ' ' ? false : hash(char.codePointAt(0)!, column, row) < 0.45 || row === 0 || column === 0;

/** The words' size in pixels for a letter height. */
export const wordsSize = (text: string, height: number) => ({
  width: Math.round(text.length * height * 0.75),
  height,
});

/** Calls `paint(x, y)` for every ink pixel of the words drawn at (left, top). */
function glyphs(
  text: string,
  left: number,
  top: number,
  height: number,
  paint: (x: number, y: number) => void,
) {
  const advance = height * 0.75;
  const unit = height / 7;
  [...text].forEach((char, k) => {
    for (let row = 0; row < 7; row++)
      for (let column = 0; column < 5; column++) {
        if (!cell(char, column, row)) continue;
        const x0 = Math.round(left + k * advance + column * unit);
        const y0 = Math.round(top + row * unit);
        for (let y = y0; y < Math.round(top + (row + 1) * unit); y++)
          for (let x = x0; x < Math.round(left + k * advance + (column + 1) * unit); x++) paint(x, y);
      }
  });
}

const WORLD_MARGIN = 400;

/** A shot's world: smooth shading and hard-edged blocks, with its scene text painted in. */
function worldOf(fixture: Fixture, shotIndex: number) {
  const shot = fixture.shots[shotIndex]!;
  const width = fixture.width + 2 * WORLD_MARGIN;
  const height = fixture.height + 2 * WORLD_MARGIN;
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const block = hash(shot.seed, Math.floor(x / 23), Math.floor(y / 19));
      const shade = 70 + 60 * Math.sin(x / 41 + shot.seed) + 40 * Math.cos(y / 37);
      const at = (y * width + x) * 3;
      rgb[at] = Math.max(0, Math.min(255, shade + block * 90));
      rgb[at + 1] = Math.max(0, Math.min(255, shade * 0.8 + block * 70));
      rgb[at + 2] = Math.max(0, Math.min(255, shade * 0.6 + (1 - block) * 60));
    }
  const set = (x: number, y: number, colour: Rgb) => {
    const wx = x + WORLD_MARGIN;
    const wy = y + WORLD_MARGIN;
    if (wx < 0 || wy < 0 || wx >= width || wy >= height) return;
    rgb.set(colour, (wy * width + wx) * 3);
  };
  for (const text of fixture.texts) {
    if (text.kind !== 'scene' || text.shot !== shotIndex) continue;
    const size = wordsSize(text.text, text.height);
    if (text.panel) {
      const pad = Math.round(text.height * 0.8);
      for (let y = text.at.y - pad; y < text.at.y + size.height + pad; y++)
        for (let x = text.at.x - pad; x < text.at.x + size.width + pad; x++) set(x, y, text.panel);
    }
    glyphs(text.text, text.at.x, text.at.y, text.height, (x, y) => set(x, y, text.ink));
  }
  return { width, height, rgb };
}

const shotIndexAt = (fixture: Fixture, frame: number) =>
  Math.max(
    0,
    fixture.shots.findIndex((shot) => frame >= shot.start && frame < shot.end),
  );

const walkerAt = (walker: Walker, frame: number) => {
  if (frame < walker.from || frame >= walker.to) return null;
  const t = (frame - walker.from) / Math.max(1, walker.to - walker.from);
  return { ...walker, x: Math.round(walker.x0 + (walker.x1 - walker.x0) * t) };
};

/** The fixture's frames, rendered on demand and kept (a fixture is a few hundred small frames). */
export function renderer(fixture: Fixture) {
  const worlds = new Map<number, ReturnType<typeof worldOf>>();
  const frames = new Map<number, Uint8Array>();
  return (frame: number): Uint8Array => {
    const cached = frames.get(frame);
    if (cached) return cached;
    const index = shotIndexAt(fixture, frame);
    if (!worlds.has(index)) worlds.set(index, worldOf(fixture, index));
    const world = worlds.get(index)!;
    const camera = fixture.shots[index]!.camera(frame);
    const { width, height } = fixture;
    const rgb = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const wx = Math.round(x + camera.x) + WORLD_MARGIN;
        const wy = Math.round(y + camera.y) + WORLD_MARGIN;
        const from =
          (Math.max(0, Math.min(world.height - 1, wy)) * world.width +
            Math.max(0, Math.min(world.width - 1, wx))) *
          3;
        const grain = (hash(frame, x, y) - 0.5) * 2 * fixture.noise;
        for (let c = 0; c < 3; c++)
          rgb[(y * width + x) * 3 + c] = Math.max(0, Math.min(255, world.rgb[from + c]! + grain));
      }
    const set = (x: number, y: number, colour: Rgb) => {
      if (x >= 0 && y >= 0 && x < width && y < height) rgb.set(colour, (y * width + x) * 3);
    };
    for (const walker of fixture.walkers) {
      const at = walkerAt(walker, frame);
      if (!at) continue;
      for (let y = at.y; y < at.y + at.height; y++)
        for (let x = at.x; x < at.x + at.width; x++)
          set(x, y, [at.colour[0] + hash(x, y, 7) * 20, at.colour[1], at.colour[2]] as Rgb);
    }
    for (const text of fixture.texts) {
      if (text.kind !== 'added' || frame < text.from || frame >= text.to) continue;
      const size = wordsSize(text.text, text.height);
      if (text.fill) {
        const pad = Math.round(text.height * 0.7);
        for (let y = text.at.y - pad; y < text.at.y + size.height + pad; y++)
          for (let x = text.at.x - pad; x < text.at.x + size.width + pad; x++) set(x, y, text.fill);
      }
      glyphs(text.text, text.at.x, text.at.y, text.height, (x, y) => set(x, y, text.ink));
    }
    frames.set(frame, rgb);
    return rgb;
  };
}

const level = (box: Box): OcrQuad => [
  { x: box.x, y: box.y },
  { x: box.x + box.width, y: box.y },
  { x: box.x + box.width, y: box.y + box.height },
  { x: box.x, y: box.y + box.height },
];

/** A sign at an angle: its quad's right side lower and shorter than its left. */
const skewed = (box: Box, skew: number): OcrQuad => [
  { x: box.x, y: box.y },
  { x: box.x + box.width, y: box.y + box.height * 0.6 * skew },
  { x: box.x + box.width, y: box.y + box.height * (1 - 0.1 * skew) },
  { x: box.x, y: box.y + box.height },
];

/** What OCR reads on a frame. */
export function linesAt(fixture: Fixture, frame: number): OcrLine[] {
  const { width, height } = fixture;
  const index = shotIndexAt(fixture, frame);
  const camera = fixture.shots[index]!.camera(frame);
  const walkers = fixture.walkers.map((walker) => walkerAt(walker, frame)).filter((at) => at !== null);
  const lines: OcrLine[] = [];
  for (const text of fixture.texts) {
    const size = wordsSize(text.text, text.height);
    let left = text.at.x;
    let top = text.at.y;
    if (text.kind === 'scene') {
      if (text.shot !== index) continue;
      left -= Math.round(camera.x);
      top -= Math.round(camera.y);
    } else if (frame < text.from || frame >= text.to) continue;
    // Off the frame, or cut by its edge: the part inside.
    const x0 = Math.max(0, left);
    const x1 = Math.min(width, left + size.width);
    const y0 = Math.max(0, top);
    const y1 = Math.min(height, top + size.height);
    if (x1 - x0 < size.width * 0.5 || y1 - y0 < size.height * 0.8) continue;
    let words = text.text;
    let readFrom = x0;
    let readTo = x1;
    if (text.kind === 'scene')
      for (const walker of walkers) {
        const hidden = Math.max(0, Math.min(x1, walker.x + walker.width) - Math.max(x0, walker.x));
        if (hidden === 0 || walker.y > y1 || walker.y + walker.height < y0) continue;
        if (hidden > 0.6 * (x1 - x0)) words = '';
        else {
          // The hidden letters drop out, and the one at the cut is misread.
          const keep = Math.max(1, Math.round(text.text.length * (1 - hidden / (x1 - x0))));
          const fromLeft = walker.x + walker.width / 2 > (x0 + x1) / 2;
          words = fromLeft
            ? `${text.text.slice(0, keep - 1)}1`
            : `I${text.text.slice(text.text.length - keep + 1)}`;
          if (fromLeft) readTo = x1 - hidden;
          else readFrom = x0 + hidden;
        }
      }
    if (words.trim().length === 0) continue;
    const box = {
      x: readFrom / width,
      y: y0 / height,
      width: (readTo - readFrom) / width,
      height: (y1 - y0) / height,
    };
    const skew = text.kind === 'scene' ? (text.skew ?? 0) : 0;
    lines.push({
      text: words,
      box,
      confidence: 1,
      language: null,
      quad: skew > 0 ? skewed(box, skew) : level(box),
    });
  }
  return lines;
}

/** The breakdown's analysers over a fixture: OCR at 4 a second, single-frame OCR, and pixels. */
export function fixtureAnalysers(fixture: Fixture) {
  const render = renderer(fixture);
  const pages: OcrPage[] = [];
  for (let i = 0; Math.round(i * 7.5) < fixture.total; i++) {
    const frame = Math.round(i * 7.5);
    pages.push({ frame, lines: linesAt(fixture, frame) });
  }
  return {
    media: {
      extractFrames: async (_path: string, frames: readonly number[]) =>
        ok(frames.map((frame) => `/fixture/frame-${frame}-ocr.png`)),
      framePixels: async (_path: string, frames: readonly number[]) =>
        ok(
          frames.map((frame) => ({
            frame,
            width: fixture.width,
            height: fixture.height,
            rgb: render(frame),
          })),
        ),
    },
    vision: {
      ocrFrames: async () => ok(pages),
      ocrImage: async (path: string) => ok(linesAt(fixture, Number(/frame-(\d+)-/.exec(path)?.[1] ?? -1))),
    },
  };
}
