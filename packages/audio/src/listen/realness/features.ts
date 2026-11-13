// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * realness.signal_features: the measurements a synthesizer leaves behind (no noise floor, energy in a few pure
 * spectral lines, dead-steady pitch, smooth envelopes, Gaussian noise), on a 32 kHz copy (soxr HQ) normalised to
 * peak 1, so the source rate, a codec's 16 kHz cut-off and the level don't matter. They feed the signal head
 * (fusion weight 0) and the pure-tone rule. Plus `audible`, `liftQuiet` and `pureTone`. Float64 on the CPU like
 * F6's single-window transforms: a clip is at most 6 s, and the −160 dB floors these read are below float32's FFT.
 */
import { db } from '../dsp/pcm';
import { hanningSymmetric, hannPeriodic, realFftPlan } from '../dsp/fft';
import { sosfilt, type Section } from '../dsp/filters';
import { median, pairwiseSum, percentile } from '../dsp/stats';
import { resampleFrom48k } from './resample';

const SR32 = 32_000;
/** realness.LIFT_BELOW_DB and QUIET_MIN_PEAK_DB. */
const LIFT_BELOW_DB = -30.0;
const QUIET_MIN_PEAK_DB = -80.0;

export const SIGNAL_FEATURES = [
  'silence_frac',
  'floor_db',
  'spec_floor_db',
  'log_flatness',
  'peakiness_db',
  'line_share',
  'bandwidth_khz',
  'quiet_flat',
  'tonal_frames',
  'pitch_wobble',
  'env_resid_db',
  'texture_kurt',
  'crest_db',
] as const;
export type SignalFeature = (typeof SIGNAL_FEATURES)[number];
export type SignalFeatures = Readonly<Record<SignalFeature, number>>;

const rmsDb = (x: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += (x[i] ?? 0) ** 2;
  return db(Math.sqrt(s / Math.max(1, x.length)));
};

/** realness.audible: an RMS above the model's silent level (−60 dBFS). */
export function audible(x: Float32Array, silentDb = -60.0): boolean {
  return x.length > 0 && rmsDb(x) > silentDb;
}

/**
 * realness.lift_quiet: a sound under −30 dBFS RMS with a peak over −80 dBFS is raised to −30 dBFS RMS (peak at most
 * −1 dBFS), so very quiet input doesn't bend the CLAP features.
 */
export function liftQuiet(x: Float32Array): {
  x: Float32Array;
  gainDb: number;
  rmsDb: number;
  peakDb: number;
} {
  if (x.length === 0) return { x, gainDb: 0, rmsDb: -200, peakDb: -200 };
  const r = rmsDb(x);
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const p = db(peak);
  const g = Math.min(LIFT_BELOW_DB - r, -1.0 - p);
  if (p < QUIET_MIN_PEAK_DB || g <= 0) return { x, gainDb: 0, rmsDb: r, peakDb: p };
  const k = 10 ** (g / 20);
  return { x: x.map((v) => v * k), gainDb: g, rmsDb: r, peakDb: p };
}

/** realness._frames: rows of `n` at `hop` (default n); a short input is one zero-padded row. */
function frames(y: Float64Array, n: number, hop = n): Float64Array[] {
  const k = y.length >= n ? 1 + Math.floor((y.length - n) / hop) : 0;
  if (k <= 0) {
    const row = new Float64Array(n);
    row.set(y.subarray(0, n));
    return [row];
  }
  return Array.from({ length: k }, (_, i) => y.subarray(i * hop, i * hop + n));
}

const meanSq = (row: ArrayLike<number>) => {
  let sum = 0;
  for (let i = 0; i < row.length; i++) sum += (row[i] as number) * (row[i] as number);
  return sum / row.length;
};

/** scipy.signal.welch(y, 32000, nperseg=min(2048, n)): periodic Hann, half overlap, per-segment mean removed. */
function welch(y: Float64Array): { f: Float64Array; p: Float64Array } {
  const nper = Math.min(2048, y.length);
  const step = nper - Math.floor(nper / 2);
  const count = Math.floor((y.length - Math.floor(nper / 2)) / step);
  const w = hannPeriodic(nper);
  let wsum = 0;
  for (const v of w) wsum += v * v;
  const bins = Math.floor(nper / 2) + 1;
  const p = new Float64Array(bins);
  const re = new Float64Array(nper);
  const im = new Float64Array(nper);
  for (let s = 0; s < count; s++) {
    const seg = y.subarray(s * step, s * step + nper);
    let mu = 0;
    for (const v of seg) mu += v;
    mu /= nper;
    for (let i = 0; i < nper; i++) {
      re[i] = ((seg[i] ?? 0) - mu) * (w[i] ?? 0);
      im[i] = 0;
    }
    dft(re, im);
    for (let k = 0; k < bins; k++) {
      let v = ((re[k] ?? 0) ** 2 + (im[k] ?? 0) ** 2) / (SR32 * wsum);
      if (k > 0 && (nper % 2 === 1 || k < bins - 1)) v *= 2;
      p[k] = (p[k] ?? 0) + v / count;
    }
  }
  const f = Float64Array.from({ length: bins }, (_, k) => (k * SR32) / nper);
  return { f, p };
}

/** The one-sided DFT in place (bins 0..n/2): a power of two through the FFT plan, else direct sums (n < 2048). */
function dft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n >= 4 && (n & (n - 1)) === 0) {
    const out = { re: new Float64Array(n / 2 + 1), im: new Float64Array(n / 2 + 1) };
    realFftPlan(n).transform(re, out.re, out.im);
    re.set(out.re);
    im.set(out.im);
    return;
  }
  const xr = Float64Array.from(re);
  for (let k = 0; k <= n / 2; k++) {
    let sr = 0;
    let si = 0;
    for (let t = 0; t < n; t++) {
      const a = (-2 * Math.PI * ((k * t) % n)) / n;
      sr += (xr[t] ?? 0) * Math.cos(a);
      si += (xr[t] ?? 0) * Math.sin(a);
    }
    re[k] = sr;
    im[k] = si;
  }
}

/** scipy.signal.butter(4, [2000, 8000], 'band', fs=32000, output='sos'): zeros at ±1, the 4 pole pairs. */
function bandpass2k8k(): Section[] {
  const order = 4;
  const fs = 2;
  const warp = (f: number) => 2 * fs * Math.tan((Math.PI * ((2 * f) / SR32)) / fs);
  const w1 = warp(2000);
  const w2 = warp(8000);
  const bw = w2 - w1;
  const wo2 = w1 * w2;
  const k2 = 2 * fs;
  const poles: Array<[number, number]> = [];
  for (let m = -order + 1; m < order; m += 2) {
    // buttap pole, scaled by bw / 2, then s = p ± sqrt(p² − wo²) (lp2bp).
    const angle = (Math.PI * m) / (2 * order);
    const pr = (-Math.cos(angle) * bw) / 2;
    const pi = (-Math.sin(angle) * bw) / 2;
    const dr = pr * pr - pi * pi - wo2;
    const di = 2 * pr * pi;
    const mag = Math.hypot(dr, di);
    const sr = Math.sqrt((mag + dr) / 2);
    const si = Math.sign(di) * Math.sqrt((mag - dr) / 2) || Math.sqrt((mag - dr) / 2);
    poles.push([pr + sr, pi + si], [pr - sr, pi - si]);
  }
  // Bilinear: z = (k2 + s) / (k2 − s); gain k = bw^N · real(Π(k2 − z_a) / Π(k2 − p_a)) with N zeros at s = 0.
  let gr = 1;
  let gi = 0;
  const digital = poles.map(([re, im]): [number, number] => {
    const nr = k2 + re;
    const dr = k2 - re;
    const den = dr * dr + im * im;
    const r2 = gr * dr + gi * im;
    gi = gi * dr - gr * im;
    gr = r2;
    return [(nr * dr - im * im) / den, (im * dr + nr * im) / den];
  });
  const gain = (bw ** order * k2 ** order * gr) / (gr * gr + gi * gi);
  const upper = digital.filter(([, im]) => im > 0).sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
  return upper.map(([re, im], i): Section => {
    const g = i === 0 ? gain : 1;
    return [g, 0, -g, -2 * re, re * re + im * im];
  });
}

/** scipy.signal.medfilt(v, 7): a running median with zeros past both ends. */
function medfilt7(v: Float64Array): Float64Array {
  const out = new Float64Array(v.length);
  const win = new Float64Array(7);
  for (let i = 0; i < v.length; i++) {
    for (let k = -3; k <= 3; k++) win[k + 3] = v[i + k] ?? 0;
    out[i] = Float64Array.from(win).sort()[3] ?? 0;
  }
  return out;
}

/** realness.signal_features on mono 48 kHz samples; null when shorter than 20 ms or silent. */
export function signalFeatures(x: Float32Array): SignalFeatures | null {
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  if (x.length < Math.trunc(0.02 * 48_000) || peak < 1e-7) return null;
  let zeros = 0;
  for (const v of x) if (Math.abs(v) < 1e-6) zeros++;
  const f: Record<string, number> = { silence_frac: zeros / x.length };
  const y = Float64Array.from(resampleFrom48k(x, 32_000));
  let ymax = 0;
  for (const v of y) ymax = Math.max(ymax, Math.abs(v));
  for (let i = 0; i < y.length; i++) y[i] = (y[i] ?? 0) / (ymax + 1e-12);
  const rdb = frames(y, 640).map((row) => 20 * Math.log10(Math.sqrt(meanSq(row) + 1e-30)));
  f['floor_db'] = Math.max(-140.0, percentile(rdb, 10) - Math.max(...rdb));
  const { f: fr, p } = welch(y);
  const band: number[] = [];
  const bandF: number[] = [];
  fr.forEach((hz, k) => {
    if (hz >= 40 && hz <= 15000) {
      band.push((p[k] ?? 0) + 1e-30);
      bandF.push(hz);
    }
  });
  const pb = Float64Array.from(band);
  const pbMean = pairwiseSum(pb, 0, pb.length) / pb.length;
  const logMean = pairwiseSum(pb.map(Math.log), 0, pb.length) / pb.length;
  f['log_flatness'] = Math.log10(Math.exp(logMean) / pbMean);
  f['peakiness_db'] = 10 * Math.log10(Math.max(Math.max(...pb) / median(pb), 1e-30));
  const sorted = Float64Array.from(pb).sort();
  const top = Math.max(1, Math.trunc(0.01 * pb.length));
  f['line_share'] = pairwiseSum(sorted, sorted.length - top, top) / pairwiseSum(pb, 0, pb.length);
  const lv = Array.from(pb, (v) => 10 * Math.log10(v));
  const lvMax = Math.max(...lv);
  let lastBand = 0;
  lv.forEach((v, k) => {
    if (v >= lvMax - 60) lastBand = k;
  });
  f['bandwidth_khz'] = (bandF[lastBand] ?? 0) / 1000;
  Object.assign(f, spectralFrames(y), envelopeAndTexture(y));
  return f as SignalFeatures;
}

/** The short-time spectra features: spectral floor, quiet flatness, pure-tone frames and pitch wobble. */
function spectralFrames(y: Float64Array): Record<string, number> {
  const win = hanningSymmetric(1024);
  const plan = realFftPlan(1024);
  const lo = Math.ceil((40 * 1024) / SR32);
  const hi = Math.floor((15000 * 1024) / SR32);
  const bins = hi - lo + 1;
  const binHz = SR32 / 1024;
  const re = new Float64Array(513);
  const im = new Float64Array(513);
  const buf = new Float64Array(1024);
  const s: Float64Array[] = frames(y, 1024, 256).map((row) => {
    for (let i = 0; i < 1024; i++) buf[i] = (row[i] ?? 0) * (win[i] ?? 0);
    plan.transform(buf, re, im);
    return Float64Array.from(
      { length: bins },
      (_, b) => (re[lo + b] ?? 0) ** 2 + (im[lo + b] ?? 0) ** 2 + 1e-30,
    );
  });
  const sums = s.map((row) => pairwiseSum(row, 0, row.length));
  const e = sums.map((v) => 10 * Math.log10(v));
  const eMax = Math.max(...e);
  const loud = s.filter((_, i) => (e[i] ?? 0) > eMax - 30);
  const floors = loud.map((row) => {
    const l = Array.from(row, (v) => 10 * Math.log10(v));
    return percentile(l, 10) - Math.max(...l);
  });
  const out: Record<string, number> = { spec_floor_db: median(floors) };
  const act = e.map((v) => v > eMax - 50);
  const nAct = act.filter(Boolean).length;
  const q25 =
    nAct >= 8
      ? percentile(
          e.filter((_, i) => act[i]),
          25,
        )
      : Infinity;
  let quiet = act.map((a, i) => a && (e[i] ?? 0) <= q25);
  if (!quiet.some(Boolean)) quiet = s.map(() => true);
  const qs = new Float64Array(bins);
  const qRows = s.filter((_, i) => quiet[i]);
  for (let b = 0; b < bins; b++)
    qs[b] =
      pairwiseSum(
        Float64Array.from(qRows, (r) => r[b] ?? 0),
        0,
        qRows.length,
      ) / qRows.length;
  const qMean = pairwiseSum(qs, 0, bins) / bins;
  out['quiet_flat'] = Math.log10(Math.exp(pairwiseSum(qs.map(Math.log), 0, bins) / bins) / qMean);
  const peakBin = s.map((row) => {
    let k = 0;
    for (let b = 1; b < bins; b++) if ((row[b] ?? 0) > (row[k] ?? 0)) k = b;
    return Math.min(Math.max(k, 2), bins - 3);
  });
  const tonal = s.map((row, i) => {
    const k = peakBin[i] ?? 2;
    let share = 0;
    for (let o = -2; o <= 2; o++) share += row[k + o] ?? 0;
    return (act[i] ?? false) && share / (sums[i] ?? 1) > 0.5;
  });
  out['tonal_frames'] = tonal.filter(Boolean).length / Math.max(1, nAct);
  out['pitch_wobble'] = Number.NaN;
  const trip = tonal.slice(0, -2).map((t, i) => t && (tonal[i + 1] ?? false) && (tonal[i + 2] ?? false));
  if (trip.filter(Boolean).length >= 4) {
    const cents = s.map((row, i) => {
      const k = peakBin[i] ?? 2;
      const a = Math.log(row[k - 1] ?? 1);
      const b = Math.log(row[k] ?? 1);
      const c = Math.log(row[k + 1] ?? 1);
      const hz = (lo + k) * binHz + ((0.5 * (a - c)) / (a - 2 * b + c - 1e-12)) * binHz;
      return 1200 * Math.log2(Math.max(hz, 20));
    });
    const d2: number[] = [];
    trip.forEach((t, i) => {
      if (t) d2.push(Math.abs((cents[i + 2] ?? 0) - 2 * (cents[i + 1] ?? 0) + (cents[i] ?? 0)));
    });
    out['pitch_wobble'] = Math.log10(median(d2) + 0.01);
  }
  return out;
}

/** Envelope smoothness (5 ms frames around a 35 ms median), the 2–8 kHz texture's kurtosis and the crest factor. */
function envelopeAndTexture(y: Float64Array): Record<string, number> {
  const out: Record<string, number> = {};
  const e5 = Float64Array.from(frames(y, 160), (row) => 10 * Math.log10(meanSq(row) + 1e-30));
  let e5max = -Infinity;
  for (const v of e5) e5max = Math.max(e5max, v);
  const ok = Array.from(e5, (v) => v > e5max - 40);
  if (ok.filter(Boolean).length >= 9) {
    const tr = medfilt7(e5);
    const resid = Array.from(e5, (v, i) => Math.abs(v - (tr[i] ?? 0))).filter((_, i) => ok[i]);
    out['env_resid_db'] = Math.log10(median(resid) + 0.01);
  } else {
    out['env_resid_db'] = Number.NaN;
  }
  const z = sosfilt(bandpass2k8k(), y);
  const n = z.length;
  // np.convolve(z², ones(320) / 320, 'same'): the window i − 160 .. i + 159. Prefix sums restart every block, so a
  // quiet stretch after a loud one keeps its precision.
  const env = new Float64Array(n);
  const block = 1024;
  const prefix = new Float64Array(block + 321);
  for (let start = 0; start < n; start += block) {
    const from = Math.max(0, start - 160);
    const to = Math.min(n, start + block + 160);
    for (let i = from; i < to; i++) prefix[i - from + 1] = (prefix[i - from] ?? 0) + (z[i] ?? 0) ** 2;
    for (let i = start; i < Math.min(n, start + block); i++) {
      const a = Math.max(0, i - 160) - from;
      const b = Math.min(n, i + 160) - from;
      env[i] = Math.sqrt(Math.max(0, (prefix[b] ?? 0) - (prefix[a] ?? 0)) / 320) + 1e-9;
    }
  }
  let envMax = 0;
  for (const v of env) envMax = Math.max(envMax, v);
  const gate = envMax * 10 ** (-40 / 20);
  const zz: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = z[i] ?? 0;
    if (Math.abs(v) > 0 && (env[i] ?? 0) > gate) zz.push(v / (env[i] ?? 1));
  }
  if (zz.length > 100) {
    const m2 =
      pairwiseSum(
        Float64Array.from(zz, (v) => v * v),
        0,
        zz.length,
      ) / zz.length;
    const m4 =
      pairwiseSum(
        Float64Array.from(zz, (v) => v ** 4),
        0,
        zz.length,
      ) / zz.length;
    out['texture_kurt'] = Math.log(m4 / (m2 * m2 + 1e-30) + 1e-9);
  } else {
    out['texture_kurt'] = Number.NaN;
  }
  const ya = Array.from(y).filter((v) => Math.abs(v) > 0);
  out['crest_db'] = ya.length ? 20 * Math.log10(1 / (Math.sqrt(meanSq(ya)) + 1e-12)) : 0.0;
  return out;
}

/**
 * realness.pure_tone: nearly all energy in one spectral line in every frame, a flat level (crest ≤ 4.5 dB) and no
 * pitch drift. A test tone is outside the CLAP head's training data, so a rule decides it (p_real ≤ 0.03).
 */
export function pureTone(f: SignalFeatures): boolean {
  const w = f.pitch_wobble;
  return (
    f.tonal_frames >= 0.95 && f.line_share >= 0.9 && f.crest_db <= 4.5 && (!Number.isFinite(w) || w <= -1.0)
  );
}
