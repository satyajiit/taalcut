// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: synthetic frames with type of known measures, for the type reading's tests. No fonts: block letters built
 * from rectangles (H, O, E, L, T, a one-stem I, and q: an O with a tail under the line), so the stem, the height,
 * each letter's width, the gaps, the outline's width and every colour are the numbers given. The picture behind
 * is a wave that travels from frame to frame with seeded grain, or one still colour. No real media.
 */
import {
  readType,
  settle,
  weightOfStem,
  type PixelRect,
  type RegionImage,
  type TypeRead,
} from '../../src/overlay-look';

export type Colour = readonly [number, number, number];

export interface DrawnType {
  /** Letters of the block alphabet (H O E L T I q); a space is a word space, a line break a new line. */
  readonly text: string;
  /** The first letter's top left, pixels. */
  readonly at: readonly [number, number];
  readonly height: number;
  readonly stem: number;
  /** Every letter's width but I's (one stem). */
  readonly letterWidth: number;
  /** Between two letters' own edges. */
  readonly gap: number;
  readonly ink: Colour;
  readonly outline?: { readonly colour: Colour; readonly width: number };
  /** From one line's foot to the next line's top. */
  readonly leading?: number;
  /** A black soft shadow: its strength at the letters, how far it fades over, and how far down it is shifted. */
  readonly shadow?: { readonly alpha: number; readonly reach: number; readonly down: number };
  /** A hard shadow: a solid copy of the letters in this colour, shifted right and down by `by`. */
  readonly hard?: { readonly colour: Colour; readonly by: number };
  /** A filled box behind the letters, this far past them. */
  readonly shape?: { readonly pad: number; readonly fill: Colour };
  /** One still colour behind everything; absent: the moving picture. */
  readonly still?: Colour;
}

export const TYPE_FRAME = { width: 440, height: 150 } as const;
const WORD_SPACE = 2.5;

function hash(x: number, y: number, frame: number, channel: number): number {
  let value = (x * 374761393 + y * 668265263 + frame * 2147483647 + channel * 1274126177) | 0;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return (value ^ (value >>> 16)) & 255;
}

/** The moving picture: a wave that travels 19 px a frame, with grain. */
function picture(x: number, y: number, frame: number, channel: number): number {
  const wave = 128 + 80 * Math.sin((x + 19 * frame) / 21 + channel) * Math.cos((y - 13 * frame) / 17);
  const grain = (hash(x, y, frame, channel) & 63) - 32;
  return Math.min(255, Math.max(0, Math.round(wave + grain)));
}

/** How far q's tail hangs under the line. */
export const tailOf = (drawn: DrawnType) => Math.round(drawn.height * 0.25);

function inGlyph(glyph: string, x: number, y: number, w: number, h: number, s: number): boolean {
  const mid = Math.floor((h - s) / 2);
  const bar = y >= mid && y < mid + s;
  if (y >= h) return glyph === 'q' && x >= w - s;
  switch (glyph) {
    case 'H':
      return x < s || x >= w - s || bar;
    case 'O':
    case 'q':
      return x < s || x >= w - s || y < s || y >= h - s;
    case 'E':
      return x < s || y < s || y >= h - s || bar;
    case 'L':
      return x < s || y >= h - s;
    case 'T': {
      const centre = Math.floor((w - s) / 2);
      return y < s || (x >= centre && x < centre + s);
    }
    default:
      return true;
  }
}

interface Letter {
  readonly glyph: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

/** Each letter's place and width, and the words' box (the letters alone, as OCR boxes them). */
export function layout(drawn: DrawnType): { letters: Letter[]; words: PixelRect } {
  const letters: Letter[] = [];
  let right = drawn.at[0];
  let top = drawn.at[1];
  for (const line of drawn.text.split('\n')) {
    let x = drawn.at[0];
    let first = true;
    for (const glyph of line) {
      if (glyph === ' ') {
        x += Math.round(drawn.gap * WORD_SPACE);
        continue;
      }
      if (!first) x += drawn.gap;
      first = false;
      const width = glyph === 'I' ? drawn.stem : drawn.letterWidth;
      letters.push({ glyph, left: x, top, width });
      x += width;
    }
    right = Math.max(right, x);
    top += drawn.height + (drawn.leading ?? 0);
  }
  const bottom = top - (drawn.leading ?? 0);
  return { letters, words: { left: drawn.at[0], top: drawn.at[1], right, bottom } };
}

/** The box drawn behind the letters, when there is one. */
export function shapeRect(drawn: DrawnType): PixelRect | null {
  if (!drawn.shape) return null;
  const { words } = layout(drawn);
  const { pad } = drawn.shape;
  return {
    left: words.left - pad,
    top: words.top - pad,
    right: words.right + pad,
    bottom: words.bottom + pad,
  };
}

/** The letters' cells, and each cell's distance (pixels) from the letters shifted `down`, up to `reach`. */
function masks(drawn: DrawnType) {
  const { width, height } = TYPE_FRAME;
  const letter = new Uint8Array(width * height);
  for (const { glyph, left, top, width: w } of layout(drawn).letters)
    for (let y = 0; y < drawn.height + tailOf(drawn); y++)
      for (let x = 0; x < w; x++)
        if (inGlyph(glyph, x, y, w, drawn.height, drawn.stem)) letter[(top + y) * width + left + x] = 1;
  const ring = new Uint8Array(width * height);
  const reach = drawn.outline?.width ?? 0;
  if (reach > 0)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        if (letter[y * width + x]) continue;
        let near = false;
        for (let dy = -reach; dy <= reach && !near; dy++)
          for (let dx = -reach; dx <= reach && !near; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            near = nx >= 0 && ny >= 0 && nx < width && ny < height && letter[ny * width + nx] === 1;
          }
        if (near) ring[y * width + x] = 1;
      }
  const shade = new Float32Array(width * height);
  if (drawn.shadow) {
    const { alpha, reach: fade, down } = drawn.shadow;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        let nearest = Infinity;
        for (let dy = -fade; dy <= fade; dy++)
          for (let dx = -fade; dx <= fade; dx++) {
            const nx = x + dx;
            const ny = y + dy - down;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height || letter[ny * width + nx] !== 1) continue;
            nearest = Math.min(nearest, Math.hypot(dx, dy));
          }
        shade[y * width + x] = nearest === Infinity ? 0 : alpha * Math.max(0, 1 - nearest / fade);
      }
  }
  const copy = new Uint8Array(width * height);
  const by = drawn.hard?.by ?? 0;
  if (by > 0)
    for (let y = by; y < height; y++)
      for (let x = by; x < width; x++) copy[y * width + x] = letter[(y - by) * width + x - by]!;
  return { letter, ring, shade, copy };
}

/** The frames `count` long: the picture, the shadows over it, the box, the outline, the letters. */
export function drawType(drawn: DrawnType, count = 5): RegionImage[] {
  const { width, height } = TYPE_FRAME;
  const { letter, ring, shade, copy } = masks(drawn);
  const shape = shapeRect(drawn);
  return Array.from({ length: count }, (_, frame) => {
    const rgb = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const at = y * width + x;
        const boxed = shape && x >= shape.left && x < shape.right && y >= shape.top && y < shape.bottom;
        for (let channel = 0; channel < 3; channel++) {
          let value = drawn.still ? drawn.still[channel]! : picture(x, y, frame, channel);
          value = Math.round(value * (1 - shade[at]!));
          if (boxed) value = drawn.shape!.fill[channel]!;
          if (copy[at]) value = drawn.hard!.colour[channel]!;
          if (ring[at]) value = drawn.outline!.colour[channel]!;
          if (letter[at]) value = drawn.ink[channel]!;
          rgb[at * 3 + channel] = value;
        }
      }
    return { width, height, rgb };
  });
}

/** The softening of the breakdown's analysis copy (a scale and an encode): a 3×3 box blur. */
export function softenType(image: RegionImage): RegionImage {
  const { width, height, rgb } = image;
  const out = new Uint8Array(rgb.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0;
        let cells = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const sx = x + dx;
            const sy = y + dy;
            if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
            sum += rgb[(sy * width + sx) * 3 + channel]!;
            cells++;
          }
        out[(y * width + x) * 3 + channel] = Math.round(sum / cells);
      }
  return { width, height, rgb: out };
}

/** A copy at half the size, each pixel the mean of four, with grain of ±`grain` on every pixel as an encode leaves. */
export function halveType(image: RegionImage, frame: number, grain = 8): RegionImage {
  const width = image.width >> 1;
  const height = image.height >> 1;
  const rgb = new Uint8Array(width * height * 3);
  const four = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0;
        for (const [dx, dy] of four)
          sum += image.rgb[((y * 2 + dy) * image.width + x * 2 + dx) * 3 + channel]!;
        const noise = ((hash(x, y, frame + 97, channel) / 255) * 2 - 1) * grain;
        rgb[(y * width + x) * 3 + channel] = Math.min(255, Math.max(0, Math.round(sum / 4 + noise)));
      }
  return { width, height, rgb };
}

/** `drawn` as it measures in a copy at half the size. */
export function halved(drawn: DrawnType): DrawnType {
  return {
    ...drawn,
    height: drawn.height / 2,
    stem: drawn.stem / 2,
    letterWidth: drawn.letterWidth / 2,
    gap: drawn.gap / 2,
    ...(drawn.outline ? { outline: { ...drawn.outline, width: drawn.outline.width / 2 } } : {}),
  };
}

/**
 * The type reading of `drawn`'s frames, as the breakdown asks for it; `soft`: through the copy's softening;
 * `half`: in a copy at half the size (`halveType`).
 */
export function readDrawn(
  drawn: DrawnType,
  given: { soft?: boolean; half?: boolean; frames?: number } = {},
): TypeRead | null {
  const drawnFrames = drawType(drawn, given.frames ?? 5).map((frame) =>
    given.soft ? softenType(frame) : frame,
  );
  const frames = given.half ? drawnFrames.map((frame, index) => halveType(frame, index)) : drawnFrames;
  const box = layout(drawn).words;
  const words = given.half
    ? { left: box.left >> 1, top: box.top >> 1, right: (box.right + 1) >> 1, bottom: (box.bottom + 1) >> 1 }
    : box;
  return readType({
    frames,
    settled: settle(frames),
    words,
    fill: drawn.shape?.fill ?? null,
    within: shapeRect(drawn),
    letters: drawn.text.replace(/\s/g, '').length,
  });
}

const rgb = (colour: readonly number[] | null | undefined) =>
  colour ? colour.map((value) => Math.round(value)).join(',') : 'none';

/** One row of the drawn-against-measured table. */
export function rowOf(name: string, drawn: DrawnType, read: TypeRead | null): string {
  const outline = drawn.outline ? `${drawn.outline.width} px ${rgb(drawn.outline.colour)}` : 'none';
  const measured = read?.outline ? `${read.outline.width.toFixed(2)} px ${rgb(read.outline.colour)}` : 'none';
  const shadow = drawn.shadow || drawn.hard ? 'yes' : 'no';
  return [
    name.padEnd(36),
    `stem ${drawn.stem} → ${read?.stem.toFixed(2) ?? '-'}`,
    `height ${drawn.height} → ${read?.height.toFixed(2) ?? '-'}`,
    `weight ${weightOfStem(drawn.stem / drawn.height)} → ${read ? weightOfStem(read.stem / read.height) : '-'}`,
    `ink ${rgb(drawn.ink)} → ${rgb(read?.fill)}`,
    `outline ${outline} → ${read ? measured : '-'}`,
    `shadow ${shadow} → ${read ? (read.shadow ? 'yes' : 'no') : '-'}`,
    `letter width ${(drawn.letterWidth / drawn.height).toFixed(2)} → ${read?.width ?? '-'}`,
    `gap ${drawn.gap} → ${read?.spacing?.toFixed(2) ?? '-'}`,
    `confidence ${read?.confidence ?? '-'}`,
  ].join(' | ');
}
