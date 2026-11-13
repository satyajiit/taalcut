// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * earshot rounds its outputs with Python's `round(x, digits)`, and the critique compares rounded values with its
 * ranges, so the port rounds the same way: the exact binary value to the nearest decimal, an exact tie to even
 * (scaling first, as F6's `roundTo` does, can take a near-tie the other way).
 */

export function pyRoundTo(x: number, digits: number): number {
  if (!Number.isFinite(x) || x === 0) return x;
  const fixed = x.toFixed(digits);
  // toFixed works on the exact binary value but takes an exact tie away from zero; Python takes it to even.
  const exact = x.toFixed(Math.min(100, digits + 60));
  const tail = exact.slice(exact.indexOf('.') + 1 + digits);
  if (/^50*$/.test(tail) && Number(fixed.at(-1)) % 2 === 1) {
    return Number((Number(fixed) - Math.sign(x) * 10 ** -digits).toFixed(digits));
  }
  return Number(fixed);
}
