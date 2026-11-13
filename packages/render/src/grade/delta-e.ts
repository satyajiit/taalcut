// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Colour difference for grades (SPEC P3.7; research colour-font-match.md): CIEDE2000 per pixel, after an
 * explicit BT.709 R′G′B′ → linear (BT.1886, γ 2.4) → XYZ (BT.709 primaries, D65, 2°) → CIELAB conversion, the
 * same on both frames. The formula follows Sharma, Wu and Dalal, "The CIEDE2000 Color-Difference Formula:
 * Implementation Notes, Supplementary Test Data, and Mathematical Observations", Color Research and
 * Application 30(1), 2005 (their test pairs are the unit test). Pure.
 */
export type Lab = readonly [number, number, number];

/** D65 reference white (2°), Y = 1. */
const WHITE = [0.95047, 1, 1.08883] as const;
const EPSILON = (6 / 29) ** 3;

const linear = (code8: number) => (Math.min(Math.max(code8, 0), 255) / 255) ** 2.4;
const f = (t: number) => (t > EPSILON ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);

/** A full-range 8-bit BT.709 R′G′B′ pixel as CIELAB. */
export function labOfRgb(r: number, g: number, b: number): Lab {
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const x = 0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb;
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb;
  const z = 0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb;
  const [fx, fy, fz] = [f(x / WHITE[0]), f(y / WHITE[1]), f(z / WHITE[2])];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const DEG = Math.PI / 180;
const POW25_7 = 25 ** 7;

/** Hue angle in degrees, 0–360 (0 for a neutral colour, as Sharma's notes require). */
function hue(b: number, a: number): number {
  if (a === 0 && b === 0) return 0;
  const angle = Math.atan2(b, a) / DEG;
  return angle < 0 ? angle + 360 : angle;
}

/** ΔE00 between two CIELAB colours (kL = kC = kH = 1). */
export function ciede2000(one: Lab, two: Lab): number {
  const [l1, a1, b1] = one;
  const [l2, a2, b2] = two;
  const cBar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + POW25_7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  const dL = l2 - l1;
  const dC = c2p - c1p;
  let dh = 0;
  if (c1p * c2p !== 0) {
    dh = h2p - h1p;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(c1p * c2p) * Math.sin((dh / 2) * DEG);
  const lBar = (l1 + l2) / 2;
  const cBarP = (c1p + c2p) / 2;
  let hBar = h1p + h2p;
  if (c1p * c2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hBar = (h1p + h2p) / 2;
    else hBar = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }
  const t =
    1 -
    0.17 * Math.cos((hBar - 30) * DEG) +
    0.24 * Math.cos(2 * hBar * DEG) +
    0.32 * Math.cos((3 * hBar + 6) * DEG) -
    0.2 * Math.cos((4 * hBar - 63) * DEG);
  const dTheta = 30 * Math.exp(-(((hBar - 275) / 25) ** 2));
  const rC = 2 * Math.sqrt(cBarP ** 7 / (cBarP ** 7 + POW25_7));
  const sL = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sC = 1 + 0.045 * cBarP;
  const sH = 1 + 0.015 * cBarP * t;
  const rT = -Math.sin(2 * dTheta * DEG) * rC;
  return Math.sqrt((dL / sL) ** 2 + (dC / sC) ** 2 + (dH / sH) ** 2 + rT * (dC / sC) * (dH / sH));
}

export interface DeltaEStats {
  readonly mean: number;
  readonly p95: number;
  readonly max: number;
  readonly pixels: number;
}

/** Per-pixel ΔE00 between two rgb24 frames of the same size: mean, 95th percentile and max. */
export function frameDeltaE(one: Uint8Array, two: Uint8Array): DeltaEStats {
  if (one.length !== two.length || one.length % 3 !== 0) throw new RangeError('Frames differ in size');
  const pixels = one.length / 3;
  const values = new Float64Array(pixels);
  let sum = 0;
  for (let index = 0; index < pixels; index++) {
    const at = index * 3;
    const value = ciede2000(
      labOfRgb(one[at] ?? 0, one[at + 1] ?? 0, one[at + 2] ?? 0),
      labOfRgb(two[at] ?? 0, two[at + 1] ?? 0, two[at + 2] ?? 0),
    );
    values[index] = value;
    sum += value;
  }
  values.sort();
  return {
    mean: pixels > 0 ? sum / pixels : 0,
    p95: values[Math.min(pixels - 1, Math.floor(pixels * 0.95))] ?? 0,
    max: values[pixels - 1] ?? 0,
    pixels,
  };
}
