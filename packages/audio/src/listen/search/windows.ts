// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `find`'s candidate segments that are not onset-based (search.py at ff41f07): sliding windows over the whole range
 * (default length duration / 6 clamped to 1–5 s, hop half of it; a long file grows the window up to 10 s, then the
 * hop up to the window, to stay near 40), their edges snapped onto the sound for one-shot queries, near-duplicates
 * dropped, and the round-robin pick over 2 s stretches that keeps strokes and events from bunching in one place.
 */
import { maxOf, mean } from '../dsp/stats';
import { FIND, frameNear, quietLevel } from './envelope';

/** A candidate: local seconds [start, end), its kind, a priority (onset-based ones). */
export interface Candidate {
  readonly start: number;
  readonly end: number;
  readonly kind: 'stroke' | 'event' | 'window';
  readonly priority: number;
}

const F = FIND.frame;

/**
 * `window_candidates(dur, win, hop, t0)`. EAR1-R1: an explicit `win` or `hop` never makes more windows than the
 * defaults would for the same span (at least FIND.maxWindows): each is a CLAP run, and 0.25 s windows at a 0.05 s
 * hop over a 10-minute file were about 12,000 of them, past the job's timeout. Past that the hop grows to fit.
 */
export function windowCandidates(dur: number, win?: number, hop?: number, t0 = 0): Candidate[] {
  const starts = windowStarts(dur, win, hop, t0);
  if ((win || hop) && starts.windows.length > FIND.maxWindows) {
    const cap = Math.max(FIND.maxWindows, windowStarts(dur, undefined, undefined, t0).windows.length);
    if (starts.windows.length > cap) {
      const w = starts.w;
      return windowStarts(dur, w, (dur - t0 - w) / (cap - 1), t0).windows;
    }
  }
  return starts.windows;
}

function windowStarts(
  dur: number,
  win: number | undefined,
  hop: number | undefined,
  t0: number,
): { readonly windows: Candidate[]; readonly w: number } {
  const span = dur - t0;
  let w = win ?? 0;
  if (!w) {
    w = Math.min(5, Math.max(1, span / 6));
    while (w < FIND.maxWinS && (span - w) / (w / 2) + 1 > FIND.maxWindows)
      w = Math.min(FIND.maxWinS, w * 1.25);
  }
  if (span <= w) return { windows: [{ start: t0, end: dur, kind: 'window', priority: 0 }], w };
  let h = hop ?? 0;
  if (!h) {
    h = w / 2;
    if ((span - w) / h + 1 > FIND.maxWindows) h = Math.min(w, (span - w) / (FIND.maxWindows - 1));
  }
  // np.arange(t0, dur - w + 1e-6, h): ceil((stop - start) / step) values start + i·delta, delta = (start + h) - start.
  const stop = dur - w + 1e-6;
  const count = Math.max(0, Math.ceil((stop - t0) / h));
  const delta = t0 + h - t0;
  const starts = Array.from({ length: count }, (_, i) => (i === 0 ? t0 : i === 1 ? t0 + h : t0 + i * delta));
  const last = starts.at(-1) ?? t0;
  if (dur - w - last > 1e-3) starts.push(dur - w);
  return { windows: starts.map((s) => ({ start: s, end: s + w, kind: 'window', priority: 0 })), w };
}

/** The first k in `range` (Python's `next((k for k in range(...) if env[k] <= q), None)`). */
function firstQuiet(
  env: Float64Array,
  from: number,
  to: number,
  step: 1 | -1,
  q: number,
): number | undefined {
  for (let k = from; step > 0 ? k < to : k > to; k += step) if ((env[k] ?? Infinity) <= q) return k;
  return undefined;
}

/** `snap_window`: [a, b) moved onto the sound's own edges; `lo`, `hi` bound the search. */
export function snapWindow(
  env: Float64Array,
  floor: number,
  a: number,
  b: number,
  lo: number,
  hi: number,
): [number, number] {
  let i0 = frameNear(a);
  let i1 = Math.min(Math.max(i0 + 1, frameNear(b)), env.length);
  if (i0 >= i1 - 1) return [a, b];
  const q = quietLevel(env, floor, i0, i1);
  const qEnd = Math.max(floor + 4, maxOf(env, i0, i1) - FIND.decayDb);
  const w = 6;
  const nLo = Math.max(0, frameNear(lo));
  const nHi = Math.min(env.length, frameNear(hi));
  const step = Math.trunc(FIND.snapS / F);
  if ((env[i0] ?? -Infinity) > q) {
    const falling = i0 - w >= nLo && mean(env, i0 - w, i0) > mean(env, i0, Math.min(env.length, i0 + w)) + 1;
    if (falling) {
      // It starts inside the tail of an earlier sound: start after that tail.
      const k = firstQuiet(env, i0, Math.min(i1 - 1, i0 + step), 1, q);
      if (k !== undefined && (i1 - k) * F >= 0.1) i0 = k;
    } else {
      // It starts inside a rising or sounding stretch: go back to where it is quiet.
      const k = firstQuiet(env, i0, Math.max(nLo, i0 - step) - 1, -1, q);
      if (k !== undefined) i0 = k;
    }
  }
  const last = i1 - 1;
  if ((env[last] ?? -Infinity) > qEnd) {
    const rising =
      last + 1 + w <= nHi &&
      mean(env, last + 1, last + 1 + w) > mean(env, Math.max(i0, last - w), last + 1) + 1;
    if (rising) {
      // A new sound starts at the end: stop before its attack.
      const k = firstQuiet(env, last, i0, -1, q);
      if (k !== undefined && (k - i0) * F >= 0.1) i1 = k + 1;
    } else {
      // Still decaying (or sounding): follow it until it has decayed, never into a new attack.
      let k = last;
      let low = env[last] ?? 0;
      const limit = Math.min(nHi, last + step);
      while (k + 1 < limit && (env[k] ?? 0) > qEnd && (env[k + 1] ?? 0) <= low + 6) {
        k += 1;
        low = Math.min(low, env[k] ?? low);
      }
      i1 = k + 1;
    }
  }
  // Tighten: from one frame before the sound to its decay, no leading or trailing silence.
  let loud = -1;
  for (let i = i0; i < Math.min(i1, env.length); i++)
    if ((env[i] ?? -Infinity) > q) {
      loud = i - i0;
      break;
    }
  if (loud >= 0) {
    i0 += Math.max(0, loud - 1);
    let dec = -1;
    for (let i = Math.min(i1, env.length) - 1; i >= i0; i--)
      if ((env[i] ?? -Infinity) > qEnd) {
        dec = i - i0;
        break;
      }
    if (dec >= 0) i1 = i0 + dec + 1;
  }
  const a2 = i0 * F;
  const b2 = i1 * F;
  return [Math.max(lo, a2), Math.min(hi, b2 + (b2 < hi ? 0.02 : 0))];
}

/** `_dedupe`: drop a candidate that overlaps a kept one by ≥ 90 % of their joint extent. */
export function dedupe<T extends Candidate>(cands: readonly T[], iou = 0.9): T[] {
  const out: T[] = [];
  for (const c of cands) {
    const distinct = out.every(
      (d) =>
        Math.min(c.end, d.end) - Math.max(c.start, d.start) <
        iou * (Math.max(c.end, d.end) - Math.min(c.start, d.start)),
    );
    if (distinct) out.push(c);
  }
  return out;
}

/** `_select`: at most `n`, round-robin over `bucket`-second stretches, the best priority first within each. */
export function selectRoundRobin<T extends Candidate>(
  cands: readonly T[],
  n: number = FIND.maxEvents,
  bucket = FIND.bucketS,
): T[] {
  const by = new Map<number, T[]>();
  for (const c of [...cands].sort((x, y) => y.priority - x.priority)) {
    const key = Math.floor(c.start / bucket);
    const list = by.get(key);
    if (list) list.push(c);
    else by.set(key, [c]);
  }
  const keys = [...by.keys()].sort((x, y) => x - y);
  const out: T[] = [];
  while (out.length < n && keys.some((k) => (by.get(k)?.length ?? 0) > 0)) {
    for (const k of keys) {
      const list = by.get(k);
      if (list?.length && out.length < n) out.push(list.shift() as T);
    }
  }
  return out;
}
