// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * NumPy and scipy.ndimage helpers with upstream's exact edge rules. ndimage's default mode `reflect` repeats the
 * edge sample (d c b a | a b c d); `nearest` repeats it forever. A window of size s covers i - s//2 .. i - s//2 + s - 1.
 */

/** `np.percentile(v, q)` with linear interpolation; NaN for an empty input. */
export function percentile(values: ArrayLike<number>, q: number): number {
  const n = values.length;
  if (n === 0) return Number.NaN;
  const sorted = Float64Array.from(values as ArrayLike<number>).sort();
  return percentileSorted(sorted, q);
}

export function percentileSorted(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const pos = (q / 100) * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(n - 1, lo + 1);
  const frac = pos - lo;
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? 0;
  // NumPy's `_lerp`: a + (b - a)·t, and from the top end when t ≥ 0.5.
  return frac >= 0.5 ? b - (b - a) * (1 - frac) : a + (b - a) * frac;
}

export function median(values: ArrayLike<number>): number {
  return percentile(values, 50);
}

export function mean(values: ArrayLike<number>, from = 0, to = values.length): number {
  if (to <= from) return Number.NaN;
  let sum = 0;
  for (let i = from; i < to; i++) sum += values[i] ?? 0;
  return sum / (to - from);
}

export function argMax(values: ArrayLike<number>, from = 0, to = values.length): number {
  let best = from;
  for (let i = from + 1; i < to; i++) if ((values[i] ?? -Infinity) > (values[best] ?? -Infinity)) best = i;
  return best;
}

export function argMin(values: ArrayLike<number>, from = 0, to = values.length): number {
  let best = from;
  for (let i = from + 1; i < to; i++) if ((values[i] ?? Infinity) < (values[best] ?? Infinity)) best = i;
  return best;
}

export function maxOf(values: ArrayLike<number>, from = 0, to = values.length): number {
  let best = -Infinity;
  for (let i = from; i < to; i++) if ((values[i] ?? -Infinity) > best) best = values[i] ?? -Infinity;
  return best;
}

export function minOf(values: ArrayLike<number>, from = 0, to = values.length): number {
  let best = Infinity;
  for (let i = from; i < to; i++) if ((values[i] ?? Infinity) < best) best = values[i] ?? Infinity;
  return best;
}

/** Index of an out-of-range position under ndimage's `reflect` (edge repeated) or `nearest`. */
function edgeIndex(i: number, n: number, mode: 'reflect' | 'nearest'): number {
  if (i >= 0 && i < n) return i;
  if (mode === 'nearest' || n === 1) return i < 0 ? 0 : n - 1;
  const period = 2 * n;
  let j = ((i % period) + period) % period;
  if (j >= n) j = period - 1 - j;
  return j;
}

/** `ndimage.maximum_filter1d(v, size)` (mode reflect unless given). */
export function maximumFilter1d(
  v: ArrayLike<number>,
  size: number,
  mode: 'reflect' | 'nearest' = 'reflect',
): Float64Array {
  const n = v.length;
  const out = new Float64Array(n);
  const start = -Math.floor(size / 2);
  for (let i = 0; i < n; i++) {
    let best = -Infinity;
    for (let k = 0; k < size; k++) {
      const x = v[edgeIndex(i + start + k, n, mode)] ?? -Infinity;
      if (x > best) best = x;
    }
    out[i] = best;
  }
  return out;
}

/**
 * `ndimage.uniform_filter1d(v, size)` (mode reflect unless given), with scipy's exact accumulation: a running sum,
 * divided at each output. The rounding matters: upstream's swell search takes argmin over −80 dB plateaus whose
 * 1e-13 drift comes from this sum.
 */
export function uniformFilter1d(
  v: ArrayLike<number>,
  size: number,
  mode: 'reflect' | 'nearest' = 'reflect',
): Float64Array {
  const n = v.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  const start = -Math.floor(size / 2);
  let sum = 0;
  for (let k = 0; k < size; k++) sum += v[edgeIndex(start + k, n, mode)] ?? 0;
  out[0] = sum / size;
  for (let i = 1; i < n; i++) {
    sum += (v[edgeIndex(i + start + size - 1, n, mode)] ?? 0) - (v[edgeIndex(i - 1 + start, n, mode)] ?? 0);
    out[i] = sum / size;
  }
  return out;
}

/** Binary-search insert position in a sorted array (left). */
function lowerBound(sorted: Float64Array, length: number, x: number): number {
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] ?? 0) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** `ndimage.median_filter(v, size, mode='nearest')` for odd `size`: a sorted sliding window. */
export function medianFilterNearest(v: ArrayLike<number>, size: number): Float64Array {
  const n = v.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  const half = Math.floor(size / 2);
  const window = new Float64Array(size);
  let count = 0;
  const at = (i: number) => v[edgeIndex(i, n, 'nearest')] ?? 0;
  for (let k = -half; k <= half; k++) {
    const x = at(k);
    const pos = lowerBound(window, count, x);
    window.copyWithin(pos + 1, pos, count);
    window[pos] = x;
    count++;
  }
  out[0] = window[half] ?? 0;
  for (let i = 1; i < n; i++) {
    const leaving = at(i - 1 - half);
    const del = lowerBound(window, count, leaving);
    window.copyWithin(del, del + 1, count);
    count--;
    const entering = at(i + half);
    const pos = lowerBound(window, count, entering);
    window.copyWithin(pos + 1, pos, count);
    window[pos] = entering;
    count++;
    out[i] = window[half] ?? 0;
  }
  return out;
}

/** `np.searchsorted(sorted, x)` (side left). */
export function searchSorted(sorted: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] ?? 0) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Runs of true of at least `minLen`, as [start, end) (timeline `_runs`). */
export function runsOf(mask: ArrayLike<boolean>, minLen: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i <= mask.length; i++) {
    const on = i < mask.length && mask[i] === true;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      if (i - start >= minLen) out.push([start, i]);
      start = -1;
    }
  }
  return out;
}

/** `ndimage.binary_closing(mask, np.ones(size))` with ndimage's border value 0. */
export function binaryClosing(mask: readonly boolean[], size: number): boolean[] {
  const n = mask.length;
  const half = Math.floor(size / 2);
  const lo = -half;
  const hi = size - 1 - half;
  const dilated = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    for (let k = lo; k <= hi; k++) {
      const j = i - k;
      if (j >= 0 && j < n && mask[j]) {
        dilated[i] = true;
        break;
      }
    }
  }
  const out = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    let all = true;
    for (let k = lo; k <= hi; k++) {
      const j = i + k;
      if (j < 0 || j >= n || !dilated[j]) {
        all = false;
        break;
      }
    }
    out[i] = all;
  }
  return out;
}

/** Population standard deviation (NumPy's `std`, ddof 0). */
export function std(values: ArrayLike<number>): number {
  const n = values.length;
  if (n === 0) return Number.NaN;
  const m = mean(values);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += ((values[i] ?? 0) - m) ** 2;
  return Math.sqrt(sum / n);
}

/** NumPy's pairwise summation (`np.sum` / `np.mean` over a contiguous run): 8 accumulators per block of ≤ 128. */
export function pairwiseSum(v: ArrayLike<number>, from: number, count: number): number {
  if (count < 8) {
    let s = 0;
    for (let i = 0; i < count; i++) s += v[from + i] ?? 0;
    return s;
  }
  if (count <= 128) {
    const r = [0, 0, 0, 0, 0, 0, 0, 0].map((_, j) => v[from + j] ?? 0) as number[];
    const whole = count - (count % 8);
    for (let i = 8; i < whole; i += 8)
      for (let j = 0; j < 8; j++) r[j] = (r[j] ?? 0) + (v[from + i + j] ?? 0);
    let res = r[0]! + r[1]! + (r[2]! + r[3]!) + (r[4]! + r[5]! + (r[6]! + r[7]!));
    for (let i = whole; i < count; i++) res += v[from + i] ?? 0;
    return res;
  }
  let half = Math.floor(count / 2);
  half -= half % 8;
  return pairwiseSum(v, from, half) + pairwiseSum(v, from + half, count - half);
}
