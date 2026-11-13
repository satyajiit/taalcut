// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Pieces of FFmpeg filter expressions that render builds as text: decimals the expression parser reads, and a
 * balanced `if` tree over piecewise segments, so the expression's depth (and the parser's recursion) grows as
 * log n. The speed curve's `setpts` and the ducking envelope's `volume` are both such trees.
 */

/** A decimal FFmpeg's expression parser reads: `places` decimals, no exponent, no trailing zeros. */
export function exprDecimal(value: number, places: number): string {
  const text = value.toFixed(places).replace(/0+$/, '').replace(/\.$/, '');
  return text === '-0' ? '0' : text;
}

export interface PiecewiseTree {
  /** The expression variable compared against the splits (`t`, `ld(0)`). */
  readonly variable: string;
  /** Segment `index`'s expression. */
  leaf(index: number): string;
  /** Where segment `index` starts, as an expression decimal; null: no split there (segment `index − 1` covers it). */
  start(index: number): string | null;
}

/** Segments low..high as nested `if(lt(variable, start), left, right)`, split in the middle each time. */
export function balancedIf(tree: PiecewiseTree, low: number, high: number): string {
  if (low === high) return tree.leaf(low);
  const mid = (low + high + 1) >> 1;
  const split = tree.start(mid);
  if (split === null) return tree.leaf(low);
  return `if(lt(${tree.variable},${split}),${balancedIf(tree, low, mid - 1)},${balancedIf(tree, mid, high)})`;
}
