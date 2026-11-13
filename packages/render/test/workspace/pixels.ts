// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Pixels for the workspace's frame comparisons (HFW1): a PNG decoded to RGB (8-bit RGB or RGBA, no interlace, as
 * Chrome writes screenshots) and two frames compared channel by channel, so "within 2/255" is measured, not
 * guessed at through a lossy JPEG.
 */
import { inflateSync } from 'node:zlib';

export interface Rgb {
  readonly width: number;
  readonly height: number;
  /** width × height × 3 bytes. */
  readonly data: Uint8Array;
}

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

export function decodePng(png: Buffer): Rgb {
  let at = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, colour, , , interlace] = [body[8], body[9], body[10], body[11], body[12]];
      if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6))
        throw new Error(`PNG form not supported (depth ${depth}, colour ${colour}, interlace ${interlace})`);
      channels = colour === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(body);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const source = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const value = raw[source + x]!;
      const left = x >= channels ? rows[y * stride + x - channels]! : 0;
      const up = y > 0 ? rows[(y - 1) * stride + x]! : 0;
      const corner = y > 0 && x >= channels ? rows[(y - 1) * stride + x - channels]! : 0;
      const predicted =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? (left + up) >> 1
                : paeth(left, up, corner);
      rows[y * stride + x] = (value + predicted) & 0xff;
    }
  }
  const data = new Uint8Array(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel++)
    for (let channel = 0; channel < 3; channel++)
      data[pixel * 3 + channel] = rows[pixel * channels + channel]!;
  return { width, height, data };
}

export interface FrameDifference {
  /** The largest channel step anywhere, out of 255. */
  readonly max: number;
  /** The mean channel step, out of 255. */
  readonly mean: number;
  /** The share of pixels whose largest channel step is over `limit`. */
  readonly over: number;
  /** How many pixels that is. */
  readonly pixelsOver: number;
}

export function frameDifference(a: Rgb, b: Rgb, limit = 2): FrameDifference {
  if (a.width !== b.width || a.height !== b.height)
    throw new Error(`sizes differ: ${a.width}×${a.height} against ${b.width}×${b.height}`);
  let max = 0;
  let sum = 0;
  let over = 0;
  for (let pixel = 0; pixel < a.width * a.height; pixel++) {
    let step = 0;
    for (let channel = 0; channel < 3; channel++) {
      const at = pixel * 3 + channel;
      const difference = Math.abs(a.data[at]! - b.data[at]!);
      sum += difference;
      step = Math.max(step, difference);
    }
    max = Math.max(max, step);
    if (step > limit) over += 1;
  }
  return { max, mean: sum / (a.width * a.height * 3), over: over / (a.width * a.height), pixelsOver: over };
}
