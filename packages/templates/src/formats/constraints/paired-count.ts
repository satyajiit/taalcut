// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { AllocatedPart, AllocationConstraint } from './types';

/**
 * The two sections end with the same slot count. Their combined beats are
 * re-split; one pair is the floor, and fewer beats than that is a failure.
 */
export function pairedCount(aKey: string, bKey: string): AllocationConstraint {
  return {
    name: `pairedCount(${aKey},${bKey})`,
    paired: [aKey, bKey],
    enforce(parts) {
      const left = parts.find((part) => part.section.key === aKey);
      const right = parts.find((part) => part.section.key === bKey);
      if (!left || !right) return false;
      const pool = sum(left.lengths) + sum(right.lengths);
      const paired = pairLengths(pool, left, right);
      if (!paired) return false;
      left.lengths = paired.left;
      right.lengths = paired.right;
      return true;
    },
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function deviation(lengths: readonly number[], pref: number): number {
  if (lengths.length === 0) return 0;
  let total = 0;
  for (const length of lengths) total += Math.abs(length - pref);
  return total / lengths.length;
}

function even(total: number, count: number, min: number, max: number): number[] | null {
  if (count === 0) return total === 0 ? [] : null;
  if (total < count * min || total > count * max) return null;
  const base = Math.floor(total / count);
  const extra = total - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < extra ? 1 : 0));
}

function tryPair(
  pool: number,
  count: number,
  left: AllocatedPart,
  right: AllocatedPart,
): { left: number[]; right: number[] } | null {
  const minLeft = count * left.range.min;
  const maxLeft = count * left.range.max;
  const minRight = count * right.range.min;
  const maxRight = count * right.range.max;
  if (pool < minLeft + minRight) return null;
  let rightBeats = Math.min(maxRight, Math.max(minRight, count * right.range.pref));
  let leftBeats = pool - rightBeats;
  if (leftBeats > maxLeft) {
    const move = Math.min(leftBeats - maxLeft, maxRight - rightBeats);
    leftBeats -= move;
    rightBeats += move;
  }
  if (leftBeats < minLeft) {
    const move = Math.min(minLeft - leftBeats, rightBeats - minRight);
    leftBeats += move;
    rightBeats -= move;
  }
  const leftLengths = even(leftBeats, count, left.range.min, left.range.max);
  const rightLengths = even(rightBeats, count, right.range.min, right.range.max);
  if (!leftLengths || !rightLengths) return null;
  if (sum(leftLengths) + sum(rightLengths) !== pool) return null;
  return { left: leftLengths, right: rightLengths };
}

/** In-range splits failed: equal counts, leftover beats on the later section's last slot. */
function absorb(
  pool: number,
  count: number,
  left: AllocatedPart,
  right: AllocatedPart,
): { left: number[]; right: number[] } | null {
  if (pool < count * (left.range.min + right.range.min)) return null;
  const leftLengths = Array.from({ length: count }, () => left.range.max);
  const rightLengths = Array.from({ length: count }, () => right.range.max);
  const extra = pool - sum(leftLengths) - sum(rightLengths);
  if (extra < 0) return null;
  const last = rightLengths[count - 1];
  if (last === undefined) return null;
  rightLengths[count - 1] = last + extra;
  return { left: leftLengths, right: rightLengths };
}

function pairLengths(
  pool: number,
  left: AllocatedPart,
  right: AllocatedPart,
): { left: number[]; right: number[] } | null {
  const minPair = left.range.min + right.range.min;
  if (pool < minPair) return null;
  const caps = [left, right].filter((part) => !part.section.fill).map((part) => part.section.count.max);
  const cap = Math.max(1, caps.length > 0 ? Math.min(...caps) : Math.ceil(pool / minPair));
  const guess = Math.min(
    cap,
    Math.max(1, Math.round(pool / Math.max(1, left.range.pref + right.range.pref))),
  );
  let best: { left: number[]; right: number[] } | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let count = 1; count <= cap; count++) {
    const plan = tryPair(pool, count, left, right);
    if (!plan) continue;
    const score =
      deviation(plan.left, left.range.pref) +
      deviation(plan.right, right.range.pref) +
      Math.abs(count - guess) * 0.01;
    if (score < bestScore) {
      best = plan;
      bestScore = score;
    }
  }
  return best ?? absorb(pool, Math.min(cap, Math.max(1, Math.floor(pool / minPair))), left, right);
}
