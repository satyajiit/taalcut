// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A seeded random sequence (mulberry32): the same seed gives the same numbers on every machine, so a footage
 * set plans the same shots, cuts and colours wherever it is generated.
 */
export interface Random {
  /** In [0, 1). */
  next(): number;
  /** An integer in [min, max]. */
  int(min: number, max: number): number;
  /** In [min, max), rounded to `places`. */
  between(min: number, max: number, places?: number): number;
  pick<T>(items: readonly T[]): T;
}

export function seeded(seed: number): Random {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    between: (min, max, places = 2) => {
      const scale = 10 ** places;
      return Math.round((min + next() * (max - min)) * scale) / scale;
    },
    pick: (items) => {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new Error('pick from an empty list');
      return item;
    },
  };
}

/** A clip's own sequence: the set's seed mixed with the clip's file name, so adding a clip leaves the others. */
export const clipSeed = (setSeed: number, file: string): number => {
  let hash = setSeed >>> 0;
  for (const char of file) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  return hash;
};
