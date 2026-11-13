// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The audit's sample-level detectors (earshot forge/polish.py): clicks and the edge jump, DC, a truncated tail,
 * digital silence inside, clipping, the attack, the tail's re-rise and length, the crest, the momentary maximum and
 * how long a sound stays live. Each returns upstream's raw numbers; audit.ts turns them into findings. `m` is the
 * float64 mono mean of the channels; `channels` the channels themselves (a mono file counts twice, as earshot's
 * stereo decode of it does).
 */
import { hanningSymmetric, rfftPower } from './fft';
import { K_WEIGHTING, sosfilt } from './filters';
import { LISTEN_SR, roundTo } from './pcm';
import { argMax, mean, median, pairwiseSum } from './stats';

/** polish._fdb: dB power of consecutive n-sample frames ([−240] when shorter than one frame). */
export function frameDb(m: ArrayLike<number>, n: number, from = 0, length = m.length - from): Float64Array {
  const k = Math.floor(length / n);
  if (k < 1) return Float64Array.of(-240);
  const out = new Float64Array(k);
  const sq = new Float64Array(n);
  for (let f = 0; f < k; f++) {
    for (let i = 0; i < n; i++) sq[i] = (m[from + f * n + i] ?? 0) ** 2;
    out[f] = 10 * Math.log10(pairwiseSum(sq, 0, n) / n + 1e-24);
  }
  return out;
}

const absMax = (m: ArrayLike<number>) => {
  let p = 0;
  for (let i = 0; i < m.length; i++) p = Math.max(p, Math.abs(m[i] ?? 0));
  return p;
};

export interface Clicks {
  readonly clicks: number;
  /** Seconds, the first 8. */
  readonly clickTimes: readonly number[];
  readonly edgeDb: number;
}

/** polish.clicks: isolated discontinuities (1 ms frames of the 2nd difference) and the first/last sample's jump. */
export function detectClicks(m: Float64Array, thr = 18.0): Clicks {
  const peak = absMax(m) + 1e-12;
  const edge = 20 * Math.log10(Math.max(Math.abs(m[0] ?? 0), Math.abs(m[m.length - 1] ?? 0)) / peak + 1e-12);
  const d2 = new Float64Array(Math.max(0, m.length - 2));
  for (let i = 0; i < d2.length; i++) d2[i] = (m[i + 2] ?? 0) - 2 * (m[i + 1] ?? 0) + (m[i] ?? 0);
  const e = frameDb(d2, 48);
  const lvl = frameDb(m, 48);
  const k = Math.min(e.length, lvl.length);
  const times: number[] = [];
  if (k >= 24) {
    const ip = argMax(lvl, 0, k);
    let lvlMax = -Infinity;
    for (let i = 0; i < k; i++) lvlMax = Math.max(lvlMax, lvl[i] ?? -Infinity);
    const at = (i: number) => e[Math.min(k - 1, Math.max(0, i))] ?? 0;
    const hit: boolean[] = [];
    const q = new Float64Array(48);
    for (let i = 0; i < k; i++) {
      const pre = median([2, 3, 4, 5, 6, 7, 8, 9].map((j) => at(i - 12 + j)));
      const post = median([15, 16, 17, 18, 19, 20, 21, 22].map((j) => at(i - 12 + j)));
      for (let j = 0; j < 48; j++) q[j] = (d2[i * 48 + j] ?? 0) ** 2;
      q.sort();
      const imp = ((q[46] ?? 0) + (q[47] ?? 0)) / (pairwiseSum(q, 0, 48) + 1e-30);
      hit.push(
        (e[i] ?? 0) - Math.max(pre, post) > thr &&
          Math.abs(post - pre) < 8 &&
          (lvl[i] ?? 0) > lvlMax - 70 &&
          Math.abs(i - ip) > 3 &&
          imp > 0.6,
      );
    }
    for (let i = 0; i < k;) {
      if (!hit[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < k && hit[j + 1]) j++;
      times.push(roundTo((i + j + 1) / 2 / 1000, 3));
      i = j + 1;
    }
  }
  return { clicks: times.length, clickTimes: times.slice(0, 8), edgeDb: roundTo(edge, 1) };
}

/** polish.dc: |mean| re the peak (dB). */
export function dcDb(m: Float64Array): number {
  const peak = absMax(m) + 1e-12;
  return roundTo(
    20 * Math.log10(Math.abs(pairwiseSum(m, 0, m.length) / Math.max(1, m.length)) / peak + 1e-12),
    1,
  );
}

function slopeOf(xs: readonly number[], ys: readonly number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += ((xs[i] ?? 0) - mx) * ((ys[i] ?? 0) - my);
    den += ((xs[i] ?? 0) - mx) ** 2;
  }
  return num / den;
}

/** polish.truncated: the level re peak at which a still-decaying tail was cut, or null. */
export function truncatedDb(m: Float64Array): { truncDb: number | null; endDb: number | null } {
  const raw = frameDb(m, 240);
  if (raw.length < 12) return { truncDb: null, endDb: null };
  const ip = argMax(raw);
  const e = raw.map((v) => v - (raw[ip] ?? 0));
  const n = e.length;
  const end = ((e[n - 2] ?? 0) + (e[n - 1] ?? 0)) / 2;
  if (n - ip < 12 || end < -55) return { truncDb: null, endDb: roundTo(end, 1) };
  const before = Array.from(e.subarray(Math.max(ip, n - 38), n - 8));
  const slope =
    before.length >= 4
      ? slopeOf(
          before.map((_, i) => i * 0.005),
          before,
        )
      : 0;
  const fadeFrom = ((e[n - 10] ?? 0) + (e[n - 9] ?? 0) + (e[n - 8] ?? 0)) / 3;
  const expect = Math.max(3.0, -slope * 0.04);
  let cut: number | null = null;
  if (fadeFrom - end > 3 * expect + 6 && fadeFrom > -50) cut = fadeFrom;
  else if (slope < -20 && end > -50) cut = end;
  return { truncDb: cut === null ? null : roundTo(cut, 1), endDb: roundTo(end, 1) };
}

/** polish.silence: digital silence (runs ≥ 2 ms of |x| < 1e-6) between the first and last audible sample, ms. */
export function innerSilenceMs(m: Float64Array): number {
  const peak = absMax(m) + 1e-12;
  let first = -1;
  let last = -1;
  for (let i = 0; i < m.length; i++) {
    if (Math.abs(m[i] ?? 0) > peak * 1e-3) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0 || first === last) return 0;
  let total = 0;
  let run = 0;
  for (let i = first; i <= last; i++) {
    const zero = i < last && Math.abs(m[i] ?? 0) < 1e-6;
    if (zero) run++;
    else {
      if (run >= 96) total += run;
      run = 0;
    }
  }
  return roundTo(total / 48, 1);
}

/** polish.clipping: flat tops (≥ 3 equal samples at the peak) per channel, and samples beyond full scale. */
export function clippingRuns(channels: readonly Float32Array[]): { clipRuns: number; overs: number } {
  let runs = 0;
  let overs = 0;
  for (const c of channels) {
    const pk = absMax(c);
    if (pk <= 0) continue;
    for (let i = 0; i < c.length; i++) if (Math.abs(c[i] ?? 0) > 1.0) overs++;
    let run = 0;
    for (let i = 1; i <= c.length; i++) {
      const flat =
        i < c.length && Math.abs(c[i] ?? 0) >= 0.99 * pk && Math.abs((c[i] ?? 0) - (c[i - 1] ?? 0)) < 2e-6;
      if (flat) run++;
      else {
        if (run >= 2) runs++;
        run = 0;
      }
    }
  }
  return { clipRuns: runs, overs };
}

/** polish.attack: the 10 → 90 % rise (ms) of the 0.5 ms RMS envelope, and the HF share of the first 10 ms (dB). */
export function attackOf(m: Float64Array): { attackMs: number | null; onsetHfDb: number | null } {
  const n = Math.floor(m.length / 12);
  if (n < 4) return { attackMs: null, onsetHfDb: null };
  const p = new Float64Array(n);
  const sq = new Float64Array(12);
  for (let f = 0; f < n; f++) {
    for (let i = 0; i < 12; i++) sq[i] = (m[f * 12 + i] ?? 0) ** 2;
    p[f] = pairwiseSum(sq, 0, 12) / 12;
  }
  const env = p.map((v, i) => Math.sqrt(0.5 * v + 0.5 * (i > 0 ? (p[i - 1] ?? 0) : 0)));
  let top = 0;
  for (const v of env) top = Math.max(top, v);
  let i90 = 0;
  while (i90 < n && (env[i90] ?? 0) < 0.9 * top) i90++;
  let i10 = 0;
  for (let i = i90; i >= 0; i--) {
    if ((env[i] ?? 0) < 0.1 * top) {
      i10 = i;
      break;
    }
  }
  const seg = m.subarray(i10 * 12, i10 * 12 + 480);
  let hf: number | null = null;
  if (seg.length >= 32) {
    const w = hanningSymmetric(seg.length);
    const F = rfftPower(
      seg.map((v, i) => v * (w[i] ?? 0)),
      1024,
    );
    let high = 0;
    let all = 0;
    for (let k = 0; k < F.length; k++) {
      all += F[k] ?? 0;
      if ((k * LISTEN_SR) / 1024 >= 6000) high += F[k] ?? 0;
    }
    hf = roundTo(10 * Math.log10(high / (all + 1e-30) + 1e-12), 1);
  }
  return { attackMs: roundTo((i90 - i10) * 0.25, 2), onsetHfDb: hf };
}

/** polish.tail: the re-rise above the running minimum after the peak (dB), the decay rate and the 40 dB length. */
export function tailOf(m: Float64Array): { bumpDb: number; decayDbS: number | null; t40Ms: number | null } {
  const raw = frameDb(m, 480);
  if (raw.length < 4) return { bumpDb: 0, decayDbS: null, t40Ms: null };
  const lin = raw.map((v) => 10 ** (v / 10));
  const e = lin.map(
    (_, i) => 10 * Math.log10(((lin[i - 1] ?? 0) + (lin[i] ?? 0) + (lin[i + 1] ?? 0)) / 3 + 1e-24),
  );
  const ip = argMax(e);
  const after = Array.from(e.subarray(ip), (v) => v - (e[ip] ?? 0));
  const below = after.findIndex((v) => v < -40);
  const t40 = below >= 0 ? below * 10 : after.length * 10;
  let run = Infinity;
  let bump = 0;
  let any = false;
  after.forEach((v, i) => {
    run = Math.min(run, v);
    if (i >= 2 && v > -45) {
      bump = any ? Math.max(bump, v - run) : v - run;
      any = true;
    }
  });
  const sel = after.flatMap((v, i) => (v <= -6 && v >= -45 ? [i] : []));
  const rate =
    sel.length >= 3
      ? roundTo(
          slopeOf(
            sel.map((i) => i * 0.01),
            sel.map((i) => after[i] ?? 0),
          ),
          1,
        )
      : null;
  return { bumpDb: roundTo(any ? bump : 0, 1), decayDbS: rate, t40Ms: t40 };
}

/** The largest mean of n consecutive values (polish._movmax). */
function movMax(p: Float64Array, n: number): number {
  if (p.length < n) return pairwiseSum(p, 0, p.length) / n;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += p[i] ?? 0;
  let best = sum;
  for (let i = n; i < p.length; i++) {
    sum += (p[i] ?? 0) - (p[i - n] ?? 0);
    best = Math.max(best, sum);
  }
  return best / n;
}

/** polish.body: crest_db = peak (dBFS) minus the loudest 50 ms of K-weighted RMS. */
export function crestDb(m: Float64Array): number {
  const k = sosfilt(K_WEIGHTING, m).map((v) => v * v);
  return roundTo(20 * Math.log10(absMax(m) + 1e-12) - 10 * Math.log10(movMax(k, 2400) + 1e-24), 1);
}

/** polish.lufs_max: momentary-max LUFS (400 ms, the channels' K-weighted powers summed; shorter sounds zero-padded). */
export function momentaryMaxLufs(channels: readonly Float32Array[]): number {
  const n = channels[0]?.length ?? 0;
  const tot = new Float64Array(n);
  for (const c of channels) {
    const k = sosfilt(K_WEIGHTING, c);
    for (let i = 0; i < n; i++) tot[i] = (tot[i] ?? 0) + (k[i] ?? 0) ** 2;
  }
  return -0.691 + 10 * Math.log10(movMax(tot, 19_200) + 1e-24);
}

/** sfx.live_ms: how long the sound stays within `db` of its loudest (1 ms RMS frames every 0.25 ms), ms. */
export function liveMs(m: Float64Array, db = -40.0): number {
  const w = 48;
  const h = 12;
  const x = m.length < w ? Float64Array.from({ length: w }, (_, i) => m[i] ?? 0) : m;
  const c = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) c[i + 1] = (c[i] ?? 0) + (x[i] ?? 0) ** 2;
  const e: number[] = [];
  for (let s = 0; s + w <= x.length; s += h) e.push(((c[s + w] ?? 0) - (c[s] ?? 0)) / w);
  let top = 0;
  for (const v of e) top = Math.max(top, v);
  if (e.length === 0 || top <= 0) return 0;
  const thr = top * 10 ** (db / 10);
  return (e.filter((v) => v >= thr).length * 1000 * h) / LISTEN_SR;
}
