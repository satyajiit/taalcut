// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Synthetic frames with a known camera move (FRM1-MOT tests): a textured "world" (smooth random blobs) seen through a
 * camera whose shift, scale and roll are given, and an optional textured subject pasted in frame space.
 */
import { grayImage, pyramid, type Level } from '../../src/motion/image';

function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A smooth textured field: the sum of a few hundred Gaussian blobs, 0–255. */
export function world(seed: number, blobs = 400): (x: number, y: number) => number {
  const rng = random(seed);
  const items = Array.from({ length: blobs }, () => ({
    x: rng() * 2 - 0.5,
    y: rng() * 2 - 0.5,
    r: 0.004 + rng() * 0.02,
    a: rng() * 2 - 1,
  }));
  return (x, y) => {
    let v = 128;
    for (const b of items) {
      const d2 = ((x - b.x) ** 2 + (y - b.y) ** 2) / (b.r * b.r);
      if (d2 < 9) v += 90 * b.a * Math.exp(-d2);
    }
    return Math.max(0, Math.min(255, v));
  };
}

export interface Camera {
  /** Centre in world units (the frame is 1 wide). */
  readonly x: number;
  readonly y: number;
  /** Zoom: 1 shows a 1-wide window, 2 a half-wide one. */
  readonly zoom: number;
  /** Roll, radians: the picture turns clockwise on screen by this. */
  readonly roll: number;
}

export interface Subject {
  /** Box in frame shares. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly texture: (x: number, y: number) => number;
}

/** One frame through `camera`, `width` × `height` pixels, with subjects pasted on top. */
export function render(
  field: (x: number, y: number) => number,
  camera: Camera,
  size: { width: number; height: number },
  subjects: readonly Subject[] = [],
): Uint8Array {
  const { width, height } = size;
  const out = new Uint8Array(width * height);
  const cos = Math.cos(camera.roll);
  const sin = Math.sin(camera.roll);
  for (let py = 0; py < height; py++)
    for (let px = 0; px < width; px++) {
      const u = (px - width / 2) / width;
      const v = (py - height / 2) / width;
      const wx = camera.x + (cos * u + sin * v) / camera.zoom;
      const wy = camera.y + (-sin * u + cos * v) / camera.zoom;
      let value = field(wx, wy);
      for (const s of subjects) {
        const sx = px / width - s.x;
        const sy = py / height - s.y;
        if (sx >= 0 && sy >= 0 && sx < s.width && sy < s.height) value = s.texture(sx, sy);
      }
      out[py * width + px] = Math.round(value);
    }
  return out;
}

export function levels(data: Uint8Array, size: { width: number; height: number }): Level[] {
  return pyramid(grayImage(data, size.width, size.height), 4);
}
