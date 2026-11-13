// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Pillow-style RGB24 canvas annotator for Set-of-Mark (SoM) contact sheets, cut-confirmation strips, and
 * visual QA overlays. Draws translucent pills, crisp 5×7 pixel-font labels, bounding boxes, dashed safe-zone
 * guides, highlight borders, and bottom waveform bars directly onto a row-major `rgb24` buffer with zero native
 * dependencies.
 */
import type { AnnotatedBox, AnnotationBoxKind, ComputeFallbackEvent, TileAnnotation } from '@taalcut/core';
import { emitComputeFallback } from '../compute-report';

export type RgbTriplet = readonly [number, number, number];

/** Compact 5×7 bitmap font (each row is a 5-bit integer from MSB bit 4 to LSB bit 0, 7 rows tall). */
const GLYPHS_5X7: Readonly<Record<string, readonly number[]>> = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '#': [10, 31, 10, 10, 31, 10, 0],
  ':': [0, 4, 4, 0, 4, 4, 0],
  '.': [0, 0, 0, 0, 0, 6, 6],
  '·': [0, 0, 6, 6, 0, 0, 0],
  '-': [0, 0, 0, 31, 0, 0, 0],
  '+': [0, 4, 4, 31, 4, 4, 0],
  '/': [1, 2, 2, 4, 8, 8, 16],
  '?': [14, 17, 1, 2, 4, 0, 4],
  '!': [4, 4, 4, 4, 4, 0, 4],
  '%': [25, 26, 2, 4, 8, 11, 19],
  '|': [4, 4, 4, 4, 4, 4, 4],
  '(': [2, 4, 8, 8, 8, 4, 2],
  ')': [8, 4, 2, 2, 2, 4, 8],
  '0': [14, 17, 19, 21, 25, 17, 14],
  '1': [4, 12, 4, 4, 4, 4, 14],
  '2': [14, 17, 1, 6, 8, 16, 31],
  '3': [30, 1, 1, 14, 1, 1, 30],
  '4': [2, 6, 10, 18, 31, 2, 2],
  '5': [31, 16, 30, 1, 1, 17, 14],
  '6': [6, 8, 16, 30, 17, 17, 14],
  '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14],
  '9': [14, 17, 17, 15, 1, 2, 12],
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 18, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 27, 17],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
};

const BOX_COLOURS: Readonly<Record<AnnotationBoxKind, RgbTriplet>> = {
  face: [0, 229, 255],
  person: [52, 211, 153],
  subject: [251, 191, 36],
  text: [244, 114, 182],
  safeZone: [248, 113, 113],
};

const HIGHLIGHT_COLOUR: RgbTriplet = [251, 191, 36];
const PILL_BG: RgbTriplet = [12, 14, 18];
const PILL_FG: RgbTriplet = [248, 250, 252];
const WAVE_COLOUR: RgbTriplet = [56, 189, 248];

function blendPixel(
  rgb: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  colour: RgbTriplet,
  alpha = 1,
): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const idx = (y * width + x) * 3;
  if (alpha >= 0.999) {
    rgb[idx] = colour[0];
    rgb[idx + 1] = colour[1];
    rgb[idx + 2] = colour[2];
    return;
  }
  const inv = 1 - alpha;
  rgb[idx] = Math.round((rgb[idx] ?? 0) * inv + colour[0] * alpha);
  rgb[idx + 1] = Math.round((rgb[idx + 1] ?? 0) * inv + colour[1] * alpha);
  rgb[idx + 2] = Math.round((rgb[idx + 2] ?? 0) * inv + colour[2] * alpha);
}

/** Draws a translucent rectangular pill and renders `text` in 5×7 bitmap glyphs on `rgb`. */
export function drawRgbPillBadge(
  rgb: Uint8Array,
  width: number,
  height: number,
  text: string,
  options: {
    readonly x: number;
    readonly y: number;
    readonly scale?: 1 | 2;
    readonly fg?: RgbTriplet;
    readonly bg?: RgbTriplet;
    readonly bgAlpha?: number;
  },
): { readonly pillWidth: number; readonly pillHeight: number } {
  const clean = text.trim().slice(0, 32).toUpperCase();
  if (!clean) return { pillWidth: 0, pillHeight: 0 };
  const scale = options.scale ?? (Math.min(width, height) >= 320 ? 2 : 1);
  const padX = 4 * scale;
  const padY = 3 * scale;
  const charAdvance = 6 * scale;
  const pillWidth = clean.length * charAdvance - scale + padX * 2;
  const pillHeight = 7 * scale + padY * 2;
  const x0 = Math.max(0, Math.min(width - pillWidth, Math.round(options.x)));
  const y0 = Math.max(0, Math.min(height - pillHeight, Math.round(options.y)));
  const bg = options.bg ?? PILL_BG;
  const fg = options.fg ?? PILL_FG;
  const alpha = options.bgAlpha ?? 0.76;

  for (let py = y0; py < y0 + pillHeight && py < height; py++) {
    for (let px = x0; px < x0 + pillWidth && px < width; px++) {
      blendPixel(rgb, width, height, px, py, bg, alpha);
    }
  }

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i] ?? ' ';
    const rows = GLYPHS_5X7[ch] ?? GLYPHS_5X7[' ']!;
    const gx = x0 + padX + i * charAdvance;
    const gy = y0 + padY;
    for (let r = 0; r < 7; r++) {
      const mask = rows[r] ?? 0;
      for (let c = 0; c < 5; c++) {
        if ((mask & (1 << (4 - c))) === 0) continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            blendPixel(rgb, width, height, gx + c * scale + sx, gy + r * scale + sy, fg, 1);
          }
        }
      }
    }
  }
  return { pillWidth, pillHeight };
}

/** Draws a solid or dashed rectangle outline of `thickness` pixels inside `rgb`. */
export function drawRgbRect(
  rgb: Uint8Array,
  width: number,
  height: number,
  rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  colour: RgbTriplet,
  options: { readonly thickness?: number; readonly dashed?: boolean; readonly alpha?: number } = {},
): void {
  const x0 = Math.max(0, Math.min(width - 1, Math.round(rect.x)));
  const y0 = Math.max(0, Math.min(height - 1, Math.round(rect.y)));
  const x1 = Math.max(x0, Math.min(width - 1, Math.round(rect.x + rect.width - 1)));
  const y1 = Math.max(y0, Math.min(height - 1, Math.round(rect.y + rect.height - 1)));
  const t = Math.max(1, options.thickness ?? 2);
  const dashed = options.dashed ?? false;
  const alpha = options.alpha ?? 0.92;
  const dashOn = (step: number) => !dashed || Math.floor(step / 5) % 2 === 0;

  for (let x = x0; x <= x1; x++) {
    if (!dashOn(x - x0)) continue;
    for (let d = 0; d < t; d++) {
      blendPixel(rgb, width, height, x, y0 + d, colour, alpha);
      blendPixel(rgb, width, height, x, y1 - d, colour, alpha);
    }
  }
  for (let y = y0; y <= y1; y++) {
    if (!dashOn(y - y0)) continue;
    for (let d = 0; d < t; d++) {
      blendPixel(rgb, width, height, x0 + d, y, colour, alpha);
      blendPixel(rgb, width, height, x1 - d, y, colour, alpha);
    }
  }
}

/** Draws a normalized [0, 1] `AnnotatedBox` and its optional label onto `rgb`. */
export function drawRgbAnnotatedBox(
  rgb: Uint8Array,
  width: number,
  height: number,
  box: AnnotatedBox,
): void {
  const colour = BOX_COLOURS[box.kind];
  const rx = box.x * width;
  const ry = box.y * height;
  const rw = box.width * width;
  const rh = box.height * height;
  drawRgbRect(
    rgb,
    width,
    height,
    { x: rx, y: ry, width: rw, height: rh },
    colour,
    { thickness: box.kind === 'safeZone' ? 1 : 2, dashed: box.kind === 'safeZone' },
  );
  if (box.label) {
    drawRgbPillBadge(rgb, width, height, box.label, {
      x: rx + 2,
      y: Math.max(2, ry - 13),
      scale: 1,
      fg: [10, 12, 16],
      bg: colour,
      bgAlpha: 0.9,
    });
  }
}

/** Draws a miniature audio waveform bar strip along the bottom of a tile. */
export function drawRgbWaveformStrip(
  rgb: Uint8Array,
  width: number,
  height: number,
  bars: readonly number[],
): void {
  if (bars.length === 0 || height < 24) return;
  const stripH = Math.min(18, Math.max(10, Math.floor(height * 0.12)));
  const yTop = height - stripH;
  for (let y = yTop; y < height; y++) {
    for (let x = 0; x < width; x++) {
      blendPixel(rgb, width, height, x, y, PILL_BG, 0.55);
    }
  }
  const n = bars.length;
  for (let i = 0; i < n; i++) {
    const val = Math.max(0.05, Math.min(1, bars[i] ?? 0));
    const x0 = Math.floor((i * width) / n);
    const x1 = Math.max(x0 + 1, Math.floor(((i + 1) * width) / n) - 1);
    const barH = Math.max(1, Math.round(val * (stripH - 2)));
    for (let y = height - 1 - barH; y < height - 1; y++) {
      for (let x = x0; x < x1; x++) {
        blendPixel(rgb, width, height, x, y, WAVE_COLOUR, 0.9);
      }
    }
  }
}

/** Applies a complete `TileAnnotation` in-place onto a tile's `rgb24` buffer. */
export function annotateRgbTile(
  rgb: Uint8Array,
  width: number,
  height: number,
  annotation: TileAnnotation,
  onComputeFallback?: (event: ComputeFallbackEvent) => void,
): void {
  if (width <= 0 || height <= 0 || rgb.length < width * height * 3) return;
  // Neither backend has a bitmap-font/box/waveform kernel in this build; never claim GPU execution.
  emitComputeFallback(
    onComputeFallback ?? ((event) => console.warn('[media] compute.fallback', event)),
    'media.annotateRgbTile',
    ['metal', 'webgpu'],
    'no_accelerator',
    'RGB tile annotation has no supported Metal or WebGPU kernel; using the CPU rasterizer',
  );
  for (const box of annotation.boxes) {
    drawRgbAnnotatedBox(rgb, width, height, box);
  }
  if (annotation.waveformBars && annotation.waveformBars.length > 0) {
    drawRgbWaveformStrip(rgb, width, height, annotation.waveformBars);
  }
  if (annotation.highlight) {
    drawRgbRect(rgb, width, height, { x: 0, y: 0, width, height }, HIGHLIGHT_COLOUR, {
      thickness: Math.min(width, height) >= 200 ? 3 : 2,
      alpha: 1,
    });
  }
  if (annotation.badge) {
    drawRgbPillBadge(rgb, width, height, annotation.badge, {
      x: 4,
      y: 4,
      ...(annotation.highlight ? { fg: HIGHLIGHT_COLOUR } : {}),
    });
  }
  if (annotation.cornerTag) {
    const scale = Math.min(width, height) >= 320 ? 2 : 1;
    const estWidth = annotation.cornerTag.trim().length * 6 * scale + 8 * scale;
    drawRgbPillBadge(rgb, width, height, annotation.cornerTag, {
      x: Math.max(4, width - estWidth - 4),
      y: 4,
      fg: annotation.highlight ? [12, 14, 18] : PILL_FG,
      bg: annotation.highlight ? HIGHLIGHT_COLOUR : PILL_BG,
      bgAlpha: 0.88,
    });
  }
}
