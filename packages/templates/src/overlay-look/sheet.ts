// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG1-READ: one picture of an overlay's life for a vision model. On top, the whole frame while it is settled, the
 * overlay's region outlined, for context (a sign sits in a scene; a graphic sits on it). Below, the region close up
 * just before it appears, as it appears, settled, and as it leaves. Written as a PNG with Node's zlib, so nothing
 * new ships. Pure apart from the encoder.
 */
import { crc32, deflateSync } from 'node:zlib';
import type { PixelRect, RgbFrame } from './pixels';

export const SHEET = {
  width: 960,
  /** The whole frame's tallest. */
  frameHeight: 540,
  /** The close-ups' tallest. */
  tileHeight: 220,
  gap: 8,
  /** The outline round the overlay on the whole frame: magenta, which the prompt names. */
  outline: [255, 0, 255] as const,
  outlineWidth: 3,
  background: [24, 24, 24] as const,
} as const;

interface Canvas {
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8Array;
}

function canvas(width: number, height: number): Canvas {
  const rgb = new Uint8Array(width * height * 3);
  for (let index = 0; index < width * height; index++) rgb.set(SHEET.background, index * 3);
  return { width, height, rgb };
}

/** Draws `rect` of `source` scaled into `to` (canvas pixels), bilinear. */
function draw(target: Canvas, source: RgbFrame, rect: PixelRect, to: PixelRect): void {
  const sw = rect.right - rect.left;
  const sh = rect.bottom - rect.top;
  const tw = to.right - to.left;
  const th = to.bottom - to.top;
  if (sw <= 0 || sh <= 0 || tw <= 0 || th <= 0) return;
  for (let y = 0; y < th; y++) {
    const fy = Math.min(sh - 1, Math.max(0, ((y + 0.5) * sh) / th - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < tw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, ((x + 0.5) * sw) / tw - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = fx - x0;
      const at = ((to.top + y) * target.width + to.left + x) * 3;
      for (let c = 0; c < 3; c++) {
        const p = (px: number, py: number) =>
          source.rgb[((rect.top + py) * source.width + rect.left + px) * 3 + c]!;
        const top = p(x0, y0) * (1 - wx) + p(x1, y0) * wx;
        const bottom = p(x0, y1) * (1 - wx) + p(x1, y1) * wx;
        target.rgb[at + c] = Math.round(top * (1 - wy) + bottom * wy);
      }
    }
  }
}

function outline(target: Canvas, rect: PixelRect): void {
  const w = SHEET.outlineWidth;
  for (let y = rect.top - w; y < rect.bottom + w; y++)
    for (let x = rect.left - w; x < rect.right + w; x++) {
      if (x < 0 || y < 0 || x >= target.width || y >= target.height) continue;
      const inner = x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
      if (!inner) target.rgb.set(SHEET.outline, (y * target.width + x) * 3);
    }
}

export interface SheetInput {
  /** The settled frame, whole. */
  readonly whole: RgbFrame;
  /** The overlay's region in frame pixels, outlined on the whole frame and shown close up. */
  readonly region: PixelRect;
  /** Up to four frames for the close-ups, in order (before, entering, settled, exiting); a missing one is left dark. */
  readonly moments: readonly (RgbFrame | undefined)[];
}

/** The sheet's pixels: the whole frame on top, the close-ups below. */
export function composeSheet(input: SheetInput): Canvas {
  const { whole, region } = input;
  const scale = Math.min(SHEET.width / whole.width, SHEET.frameHeight / whole.height);
  const frameW = Math.max(1, Math.round(whole.width * scale));
  const frameH = Math.max(1, Math.round(whole.height * scale));
  const columns = 4;
  const tileW = Math.floor((SHEET.width - SHEET.gap * (columns - 1)) / columns);
  const regionW = Math.max(1, region.right - region.left);
  const regionH = Math.max(1, region.bottom - region.top);
  const tileScale = Math.min(tileW / regionW, SHEET.tileHeight / regionH);
  const tw = Math.max(1, Math.round(regionW * tileScale));
  const th = Math.max(1, Math.round(regionH * tileScale));
  const out = canvas(SHEET.width, frameH + SHEET.gap + th);
  const left = Math.floor((SHEET.width - frameW) / 2);
  draw(
    out,
    whole,
    { left: 0, top: 0, right: whole.width, bottom: whole.height },
    {
      left,
      top: 0,
      right: left + frameW,
      bottom: frameH,
    },
  );
  outline(out, {
    left: left + Math.floor(region.left * scale),
    top: Math.floor(region.top * scale),
    right: left + Math.ceil(region.right * scale),
    bottom: Math.ceil(region.bottom * scale),
  });
  input.moments.slice(0, columns).forEach((moment, index) => {
    if (!moment) return;
    const x = index * (tileW + SHEET.gap) + Math.floor((tileW - tw) / 2);
    draw(out, moment, region, {
      left: x,
      top: frameH + SHEET.gap,
      right: x + tw,
      bottom: frameH + SHEET.gap + th,
    });
  });
  return out;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** An RGB image as a PNG file's bytes (8-bit truecolour, no filter). */
export function encodePng(image: {
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8Array;
}): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const stride = image.width * 3;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y++)
    raw.set(image.rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}
