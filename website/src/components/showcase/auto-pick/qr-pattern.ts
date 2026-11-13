// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The sample pairing screen's code: a QR-like grid that is NOT a code (nothing to scan, nothing to open), with the
 * three finder eyes so it reads as one at a glance, and a six-digit sample PIN. Both come from a seed, so the server
 * and the browser draw the same picture and "New code and PIN" can draw another.
 */

export const QR_SIZE = 25;
const EYE = 7;

/** A small, fast, seeded generator (mulberry32): the same seed always gives the same numbers. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Whether a module sits in one of the three eyes (or the light ring around it). */
export function inEye(x: number, y: number): boolean {
  const near = (v: number) => v <= EYE;
  const far = (v: number) => v >= QR_SIZE - EYE - 1;
  return (near(x) && near(y)) || (far(x) && near(y)) || (near(x) && far(y));
}

/** The eyes' top-left corners, in modules. */
export const EYES: readonly (readonly [number, number])[] = [
  [0, 0],
  [QR_SIZE - EYE, 0],
  [0, QR_SIZE - EYE],
];

/** The dark modules outside the eyes, as [x, y] pairs. */
export function qrModules(seed: number): [number, number][] {
  const next = seeded(seed);
  const dark: [number, number][] = [];
  for (let y = 0; y < QR_SIZE; y += 1)
    for (let x = 0; x < QR_SIZE; x += 1) {
      const roll = next();
      if (!inEye(x, y) && roll < 0.48) dark.push([x, y]);
    }
  return dark;
}

/** A six-digit sample PIN from the same seed. */
export function samplePin(seed: number): string {
  const next = seeded(seed * 7919 + 13);
  return Array.from({ length: 6 }, () => Math.floor(next() * 10)).join('');
}
