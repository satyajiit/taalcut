// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The audit's spectral detectors (earshot forge/polish.py `ring` and `resonances`). Ringing: a comb-like metallic
 * repeat in the tail, the cepstral peak of the tail's log spectrum at 2–40 ms quefrency as a robust z (not judged
 * for a tail under 2 kHz wide or one whose delay is the sound's own pitch). Resonance: the harshest narrow peak over
 * the 2/3-octave median of the summed 4096-point spectrum. One window each (the ring) or a short STFT summed (the
 * resonance), so they run on the CPU beside the other statistics.
 */
import { hanningSymmetric, rfftPower } from './fft';
import { frameDb } from './audit-detectors';
import { LISTEN_SR, roundTo } from './pcm';
import { argMax, median, medianFilterNearest, searchSorted, uniformFilter1d } from './stats';

function logSpectrum(seg: Float64Array, n: number): Float64Array {
  const w = hanningSymmetric(seg.length);
  const p = rfftPower(
    seg.map((v, i) => v * (w[i] ?? 0)),
    n,
  );
  return p.map((v) => 10 * Math.log10(v + 1e-30));
}

/** polish._cepstrum_peak: [robust z, quefrency ms, (span Hz)] or null when too short. */
function cepstrumPeak(seg: Float64Array, span: boolean): number[] | null {
  const n = seg.length <= 8192 ? 8192 : 16384;
  const l = logSpectrum(seg, n);
  const df = LISTEN_SR / n;
  const sel: number[] = [];
  for (let k = 0; k < l.length; k++) {
    const f = k * df;
    if (f >= 300 && f <= 12_000) sel.push(l[k] ?? 0);
  }
  const top = Math.max(...sel);
  const lc = sel.map((v) => Math.max(v, top - 60));
  const size = Math.max(3, Math.trunc(2000 / df));
  const trend = uniformFilter1d(lc, size, 'nearest');
  const r = Float64Array.from(lc, (v, i) => v - (trend[i] ?? 0));
  const hr = hanningSymmetric(r.length);
  const c = rfftPower(
    r.map((v, i) => v * (hr[i] ?? 0)),
    r.length,
  ).map(Math.sqrt);
  const band: number[] = [];
  const quef: number[] = [];
  for (let k = 0; k < c.length; k++) {
    const q = k / (r.length * df);
    if (q >= 0.002 && q <= 0.04) {
      band.push(c[k] ?? 0);
      quef.push(q);
    }
  }
  if (band.length < 8) return null;
  const med = median(band);
  const mad = median(band.map((v) => Math.abs(v - med))) * 1.4826 + 1e-12;
  const j = argMax(band);
  const out = [((band[j] ?? 0) - med) / mad, (quef[j] ?? 0) * 1000];
  if (span) {
    const sm = uniformFilter1d(sel, size, 'nearest');
    let smTop = -Infinity;
    for (const v of sm) smTop = Math.max(smTop, v);
    out.push(sm.filter((v) => v > smTop - 40).length * df);
  }
  return out;
}

/** polish._teeth_roughness: median |2nd difference| of the comb teeth's levels (dB); Infinity with fewer than 8. */
function teethRoughness(seg: Float64Array, ms: number): number {
  const n = 16_384;
  const l = logSpectrum(seg, n);
  const df = LISTEN_SR / n;
  const f0 = 1000 / ms;
  let top = -Infinity;
  for (const v of l) top = Math.max(top, v);
  const lv: number[] = [];
  for (let k = Math.max(1, Math.ceil(300 / f0)); k <= Math.trunc(12_000 / f0); k++) {
    const c = Math.trunc((k * f0) / df);
    let m = -Infinity;
    for (let i = Math.max(0, c - 2); i < Math.min(l.length, c + 3); i++) m = Math.max(m, l[i] ?? -Infinity);
    if (m > top - 50) lv.push(m);
  }
  if (lv.length < 8) return Infinity;
  const d2 = lv.slice(2).map((v, i) => Math.abs(v - 2 * (lv[i + 1] ?? 0) + (lv[i] ?? 0)));
  return median(d2);
}

export interface Ring {
  readonly ringZ: number | null;
  readonly ringMs: number | null;
  /** Why it was not judged: a narrow tail or the sound's own pitch. */
  readonly ringSrc?: 'narrow' | 'pitch';
}

/** polish.ring (current rules, not `legacy`). */
export function ringOf(m: Float64Array): Ring {
  const e = frameDb(m, 480);
  const ip = argMax(e);
  const s = ip + 3;
  let end = e.length;
  for (let i = s; i < e.length; i++) {
    if ((e[i] ?? 0) < (e[ip] ?? 0) - 50) {
      end = i;
      break;
    }
  }
  if (end - s < 6) return { ringZ: null, ringMs: null };
  const seg = m.subarray(s * 480, end * 480).subarray(0, 16_384);
  const got = cepstrumPeak(seg, true);
  if (!got) return { ringZ: null, ringMs: null };
  const [z = 0, ms = 0, bw = 0] = got;
  if (z < 8.0) return { ringZ: roundTo(z, 1), ringMs: roundTo(ms, 2) };
  if (bw < 2000) return { ringZ: null, ringMs: roundTo(ms, 2), ringSrc: 'narrow' };
  let pitch = teethRoughness(seg, ms) <= 2.0;
  if (!pitch) {
    const body = m.subarray(Math.max(0, (ip - 2) * 480), (ip + 6) * 480);
    const bp = body.length >= 1920 ? cepstrumPeak(body, false) : null;
    if (bp && (bp[0] ?? 0) >= 100) {
      const ratio = ms / (bp[1] ?? 1);
      pitch = [1, 2, 3, 0.5, 1 / 3].some((k) => Math.abs(ratio / k - 1) < (k === 1 ? 0.3 : 0.1));
    }
  }
  if (pitch) return { ringZ: null, ringMs: roundTo(ms, 2), ringSrc: 'pitch' };
  return { ringZ: roundTo(z, 1), ringMs: roundTo(ms, 2) };
}

/** polish.resonances: the harshest narrow peak (weighted dB over the 2/3-octave median) and its frequency. */
export function resonanceOf(m: Float64Array): { resDb: number; resHz: number | null } {
  const nfft = m.length >= 4096 ? 4096 : 2 ** Math.max(10, Math.ceil(Math.log2(Math.max(m.length, 2))));
  const x = m.length < nfft ? Float64Array.from({ length: nfft }, (_, i) => m[i] ?? 0) : m;
  const hop = nfft / 4;
  const frames = 1 + Math.floor((x.length - nfft) / hop);
  const w = hanningSymmetric(nfft);
  const sum = new Float64Array(nfft / 2 + 1);
  const buf = new Float64Array(nfft);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < nfft; i++) buf[i] = (x[f * hop + i] ?? 0) * (w[i] ?? 0);
    const p = rfftPower(buf, nfft);
    for (let k = 0; k < sum.length; k++) sum[k] = (sum[k] ?? 0) + (p[k] ?? 0);
  }
  const l = sum.map((v) => 10 * Math.log10(v + 1e-30));
  const freqs = Float64Array.from({ length: sum.length }, (_, k) => (k * LISTEN_SR) / nfft);
  const g: number[] = [];
  const octaves = Math.log2(16_000 / 100);
  for (let i = 0; i * (1 / 48) < octaves; i++) g.push(100 * 2 ** (i / 48));
  const edges = [...g.map((v) => v / 2 ** (1 / 96)), (g[g.length - 1] ?? 0) * 2 ** (1 / 96)].map((v) =>
    searchSorted(freqs, v),
  );
  const lg = g.map((_, i) => {
    const a = edges[i] ?? 0;
    const b = Math.max(edges[i + 1] ?? 0, a + 1);
    let mx = -Infinity;
    for (let k = a; k < Math.min(b, l.length); k++) mx = Math.max(mx, l[k] ?? -Infinity);
    return mx;
  });
  const med = medianFilterNearest(lg, 33);
  const prom = lg.map((v, i) => v - (med[i] ?? 0));
  const weight = g.map((f) => (f >= 2000 && f <= 6000 ? 1.0 : f >= 1000 && f <= 9000 ? 0.7 : 0.5));
  const lgMax = Math.max(...lg);
  const idx: number[] = [];
  for (let i = 1; i < g.length - 1; i++) {
    const ok = (lg[i] ?? 0) > lgMax - 30 && (prom[i] ?? 0) > 0;
    if (ok && (prom[i] ?? 0) >= (prom[i - 1] ?? 0) && (prom[i] ?? 0) >= (prom[i + 1] ?? 0)) idx.push(i);
  }
  if (idx.length === 0) return { resDb: 0, resHz: null };
  let best = idx[0] ?? 0;
  for (const i of idx)
    if ((prom[i] ?? 0) * (weight[i] ?? 0) > (prom[best] ?? 0) * (weight[best] ?? 0)) best = i;
  return { resDb: roundTo((prom[best] ?? 0) * (weight[best] ?? 0), 1), resHz: Math.round(g[best] ?? 0) };
}
