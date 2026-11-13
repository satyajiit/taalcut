// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Puts a crop and a rendered string on the same polarity and the same canvas.
 * Mixed-case Latin is scaled so the font x-height matches the crop's lowercase
 * band, then centred. All-caps, digits and Devanagari align ink boxes instead.
 *
 * Scaling is nearest-neighbour: a float reconstruction filter is not bit-stable
 * across libm builds, and an integer source pick is.
 */

const INK_DELTA = 32;
const MIN_SCALE = 1 / 16;
const MAX_SCALE = 16;

export interface GrayImage {
  readonly gray: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface InkBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RenderedSample extends GrayImage {
  readonly xHeight: number;
  readonly inkBox: InkBox;
}

interface Band {
  readonly y: number;
  readonly height: number;
}

export function polarityOf(img: GrayImage): 'darkOnLight' | 'lightOnDark' {
  return borderMean(img) >= 128 ? 'darkOnLight' : 'lightOnDark';
}

function borderMean(img: GrayImage): number {
  const { gray, width, height } = img;
  if (width < 1 || height < 1) return 0;
  let sum = 0;
  let n = 0;
  const add = (index: number): void => {
    sum += gray[index] ?? 0;
    n += 1;
  };
  for (let x = 0; x < width; x++) {
    add(x);
    if (height > 1) add((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    add(y * width);
    if (width > 1) add(y * width + width - 1);
  }
  return n === 0 ? 0 : sum / n;
}

function invert(img: GrayImage): GrayImage {
  const gray = new Uint8Array(img.gray.length);
  for (let i = 0; i < img.gray.length; i++) gray[i] = 255 - (img.gray[i] ?? 0);
  return { gray, width: img.width, height: img.height };
}

/** Light-on-dark and dark-on-light are different pictures to SSIM, so match the crop first. */
function matchPolarity(crop: GrayImage, rendered: GrayImage): GrayImage {
  return polarityOf(crop) === polarityOf(rendered) ? rendered : invert(rendered);
}

function isInk(value: number, background: number): boolean {
  return Math.abs(value - background) > INK_DELTA;
}

function inkBoxOf(img: GrayImage, background: number): InkBox {
  let minX = img.width;
  let minY = img.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < img.height; y++) {
    const row = y * img.width;
    for (let x = 0; x < img.width; x++) {
      if (!isInk(img.gray[row + x] ?? 0, background)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { x: 0, y: 0, width: img.width, height: img.height };
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Rows of the ink box whose ink count stays near the densest row: the lowercase body. */
function lowercaseBand(img: GrayImage, ink: InkBox, background: number): Band {
  let max = 0;
  const counts: number[] = [];
  for (let y = 0; y < ink.height; y++) {
    let count = 0;
    const row = (ink.y + y) * img.width + ink.x;
    for (let x = 0; x < ink.width; x++) if (isInk(img.gray[row + x] ?? 0, background)) count += 1;
    counts.push(count);
    if (count > max) max = count;
  }
  if (max === 0) return { y: ink.y, height: Math.max(1, ink.height) };
  const threshold = max * 0.5;
  let bestStart = 0;
  let bestLen = 0;
  let start = -1;
  for (let i = 0; i <= counts.length; i++) {
    const on = i < counts.length && (counts[i] ?? 0) >= threshold;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      const len = i - start;
      if (len > bestLen) {
        bestLen = len;
        bestStart = start;
      }
      start = -1;
    }
  }
  if (bestLen === 0) return { y: ink.y, height: Math.max(1, ink.height) };
  return { y: ink.y + bestStart, height: bestLen };
}

function codePoint(ch: string): number {
  return ch.codePointAt(0) ?? 0;
}

function hasLowerLatin(text: string): boolean {
  for (const ch of text) {
    const cp = codePoint(ch);
    if (cp >= 0x61 && cp <= 0x7a) return true;
    if (cp >= 0xe0 && cp <= 0xf6) return true;
    if (cp >= 0xf8 && cp <= 0xff) return true;
  }
  return false;
}

function hasLatinLetter(text: string): boolean {
  for (const ch of text) {
    const cp = codePoint(ch);
    if (cp >= 0x41 && cp <= 0x5a) return true;
    if (cp >= 0x61 && cp <= 0x7a) return true;
    if (cp >= 0xc0 && cp <= 0xd6) return true;
    if (cp >= 0xd8 && cp <= 0xf6) return true;
    if (cp >= 0xf8 && cp <= 0xff) return true;
  }
  return false;
}

/** Ink-box alignment for all-caps, digits-only and Devanagari. Mixed-case Latin uses x-height. */
function inkAlign(text: string, script: 'latin' | 'devanagari'): boolean {
  if (script === 'devanagari') return true;
  if (!hasLatinLetter(text)) return true;
  return !hasLowerLatin(text);
}

function bounded(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  if (scale > MAX_SCALE) return MAX_SCALE;
  if (scale < MIN_SCALE) return MIN_SCALE;
  return scale;
}

function scaleNearest(img: GrayImage, scale: number): GrayImage {
  if (scale === 1) return img;
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(img.height - 1, Math.floor((y * img.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(img.width - 1, Math.floor((x * img.width) / width));
      gray[y * width + x] = img.gray[sy * img.width + sx] ?? 0;
    }
  }
  return { gray, width, height };
}

function paint(
  img: GrayImage,
  originX: number,
  originY: number,
  width: number,
  height: number,
  fill: number,
): GrayImage {
  const gray = new Uint8Array(width * height);
  gray.fill(fill);
  for (let y = 0; y < img.height; y++) {
    const dy = originY + y;
    if (dy < 0 || dy >= height) continue;
    for (let x = 0; x < img.width; x++) {
      const dx = originX + x;
      if (dx < 0 || dx >= width) continue;
      gray[dy * width + dx] = img.gray[y * img.width + x] ?? 0;
    }
  }
  return { gray, width, height };
}

interface Anchor {
  readonly x: number;
  readonly y: number;
}

function anchorOf(img: GrayImage, background: number, xHeight: boolean): Anchor {
  const ink = inkBoxOf(img, background);
  const band = xHeight ? lowercaseBand(img, ink, background) : { y: ink.y, height: ink.height };
  return {
    x: ink.x + Math.floor(ink.width / 2),
    y: band.y + Math.floor(band.height / 2),
  };
}

/**
 * Polarity-matched, scaled and centred gray buffers of equal size.
 * `rendered.xHeight` and `rendered.inkBox` come from the text renderer; the crop's
 * x-height is the lowercase ink band (its ink box when that band is the whole body).
 */
export function alignCrop(
  crop: GrayImage,
  rendered: RenderedSample,
  text: string,
  script: 'latin' | 'devanagari',
): { readonly crop: GrayImage; readonly rendered: GrayImage } {
  const matched = matchPolarity(crop, rendered);
  const cropBg = borderMean(crop);
  const useInk = inkAlign(text, script);
  const cropInk = inkBoxOf(crop, cropBg);
  const cropBand = lowercaseBand(crop, cropInk, cropBg);
  const fontMetric = useInk ? rendered.inkBox.height : rendered.xHeight;
  const cropMetric = useInk ? cropInk.height : cropBand.height;
  const scale = bounded(cropMetric / Math.max(1, fontMetric));
  const scaled = scaleNearest(matched, scale);
  const scaledBg = borderMean(scaled);
  const cropAnchor = anchorOf(crop, cropBg, !useInk);
  const rendAnchor = anchorOf(scaled, scaledBg, !useInk);
  const left = Math.min(-cropAnchor.x, -rendAnchor.x);
  const top = Math.min(-cropAnchor.y, -rendAnchor.y);
  const right = Math.max(crop.width - cropAnchor.x, scaled.width - rendAnchor.x);
  const bottom = Math.max(crop.height - cropAnchor.y, scaled.height - rendAnchor.y);
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  return {
    crop: paint(crop, -left - cropAnchor.x, -top - cropAnchor.y, width, height, Math.round(cropBg)),
    rendered: paint(scaled, -left - rendAnchor.x, -top - rendAnchor.y, width, height, Math.round(scaledBg)),
  };
}
