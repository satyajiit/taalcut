// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The audit's shape detectors (earshot forge/sfx.py) and a take's landmarks (forge/bank.py `times`):
 *
 * - rising glide: the strongest partial tracked in 21 ms frames every 5 ms (1024 samples zero-padded to 8192, on
 *   the spectrogram graph) where it holds half the 80 Hz–10 kHz energy within ±3 semitones; the largest climb of its
 *   5-frame median above the running minimum, the track split where it jumps more than 3 semitones;
 * - layers: separate attacks in a 25 ms RMS envelope every 5 ms, and the pre-swell before the hit;
 * - take times: onset (the 1 ms envelope's first point within 30 dB of its maximum), peak (the centre of the
 *   loudest 5 ms), end (the last 5 ms within 50 dB of it): what lane D's apex placement aims.
 */
import { LISTEN_SR, roundTo } from './pcm';
import type { SpectrogramRunner } from './spectrogram-graph';
import { binFreqs, GLIDE_BINS, GLIDE_FIRST_BIN, glideSpec } from './spectra';
import { median, searchSorted } from './stats';
import { frameSignal } from './transforms';

export interface Glide {
  /** Share of the active frames that are tonal. */
  readonly tonalShare: number;
  /** The largest climb, semitones. */
  readonly riseSt: number;
  readonly fromS: number | null;
  readonly toS: number | null;
}

/** sfx.rising_glide(x) on the runner's spectrogram. */
export async function risingGlide(
  m: Float64Array,
  runner: SpectrogramRunner,
  conc = 0.5,
  jumpSt = 3.0,
  minFrames = 6,
): Promise<Glide> {
  const x = m.length < 1024 ? Float64Array.from({ length: 1024 }, (_, i) => m[i] ?? 0) : m;
  const out = await runner.spectrogram(glideSpec(), frameSignal(x, 1024, 240));
  const k = out.frames;
  const fb = binFreqs(8192, GLIDE_FIRST_BIN + GLIDE_BINS).subarray(GLIDE_FIRST_BIN);
  const tot = new Float64Array(k);
  const fp = new Float64Array(k);
  const cum = new Float64Array(GLIDE_BINS);
  const ton: boolean[] = [];
  const rows: Array<{ lo: number; hi: number }> = [];
  for (let r = 0; r < k; r++) {
    let sum = 0;
    let best = 0;
    for (let b = 0; b < GLIDE_BINS; b++) {
      const v = out.data[r * GLIDE_BINS + b] ?? 0;
      sum += v;
      if (v > (out.data[r * GLIDE_BINS + best] ?? 0)) best = b;
    }
    tot[r] = sum + 1e-30;
    fp[r] = fb[best] ?? 0;
    const half = Math.max((fp[r] ?? 0) * (2 ** (3 / 12) - 1), (2 * LISTEN_SR) / 1024);
    const lo = Math.min(Math.max(searchSorted(fb, (fp[r] ?? 0) - half), 0), GLIDE_BINS - 1);
    const hi = Math.min(Math.max(searchSorted(fb, (fp[r] ?? 0) + half), 0), GLIDE_BINS - 1);
    rows.push({ lo, hi });
  }
  let totMax = 0;
  for (const v of tot) totMax = Math.max(totMax, v);
  let active = 0;
  for (let r = 0; r < k; r++) {
    const act = 10 * Math.log10(tot[r] ?? 0) > 10 * Math.log10(totMax) - 30;
    if (act) active++;
    let c = 0;
    for (let b = 0; b < GLIDE_BINS; b++) {
      c += out.data[r * GLIDE_BINS + b] ?? 0;
      cum[b] = c;
    }
    const { lo, hi } = rows[r] as { lo: number; hi: number };
    ton.push(act && ((cum[hi] ?? 0) - (cum[lo] ?? 0)) / (tot[r] ?? 1) >= conc);
  }
  const st = Array.from(fp, (f) => 12 * Math.log2(f / 440));
  const t = (r: number) => (r * 240) / LISTEN_SR + 1024 / 2 / LISTEN_SR;
  let best: [number, number | null, number | null] = [0, null, null];
  const close = (seg: number[]) => {
    if (seg.length < minFrames) return;
    const raw = seg.map((i) => st[i] ?? 0);
    const v = raw.map((_, q) => median(raw.slice(Math.max(0, q - 2), q + 3)));
    let run = Infinity;
    let top = -Infinity;
    let at = 0;
    v.forEach((value, q) => {
      run = Math.min(run, value);
      if (value - run > top) {
        top = value - run;
        at = q;
      }
    });
    if (top > best[0]) {
      let low = 0;
      for (let q = 1; q <= at; q++) if ((v[q] ?? 0) < (v[low] ?? 0)) low = q;
      best = [top, t(seg[low] ?? 0), t(seg[at] ?? 0)];
    }
  };
  let seg: number[] = [];
  ton.forEach((on, i) => {
    if (!on) return;
    const last = seg[seg.length - 1];
    if (last !== undefined && (i - last > 2 || Math.abs((st[i] ?? 0) - (st[last] ?? 0)) > jumpSt)) {
      close(seg);
      seg = [];
    }
    seg.push(i);
  });
  close(seg);
  return {
    tonalShare: roundTo(ton.filter(Boolean).length / Math.max(1, active), 2),
    riseSt: roundTo(best[0], 1),
    fromS: best[1] === null ? null : roundTo(best[1], 3),
    toS: best[2] === null ? null : roundTo(best[2], 3),
  };
}

export interface Layers {
  /** Attack times, seconds. */
  readonly attacks: readonly number[];
  readonly count: number;
  readonly preSwellMs: number;
}

/** sfx.layers(x): separate attacks in the first 0.5 s and the build before the hit. */
export function layersOf(m: Float64Array, peakDb = -6.0, dipDb = 10.0, windowS = 0.5): Layers {
  const w = 1200;
  const h = 240;
  if (m.length < w + 2 * h) return { attacks: [0], count: 1, preSwellMs: 0 };
  const c = new Float64Array(m.length + 1);
  for (let i = 0; i < m.length; i++) c[i + 1] = (c[i] ?? 0) + (m[i] ?? 0) ** 2;
  const e: number[] = [];
  for (let s = 0; s + w <= m.length; s += h)
    e.push(10 * Math.log10(((c[s + w] ?? 0) - (c[s] ?? 0)) / w + 1e-24));
  let top = -Infinity;
  for (const v of e) top = Math.max(top, v);
  for (let i = 0; i < e.length; i++) e[i] = (e[i] ?? 0) - top;
  const k = e.length;
  const i30 = e.findIndex((v) => v >= -30);
  const i6 = e.findIndex((v) => v >= peakDb);
  const ev: number[] = [];
  for (let i = 0; i < k; i++) {
    const v = e[i] ?? -Infinity;
    if (!(v >= peakDb && v >= (e[Math.max(0, i - 1)] ?? 0) && v >= (e[Math.min(k - 1, i + 1)] ?? 0)))
      continue;
    const first = ev[0];
    if (first !== undefined && ((i - first) * h) / LISTEN_SR > windowS) break;
    const last = ev[ev.length - 1];
    if (last !== undefined) {
      let low = Infinity;
      for (let j = last; j <= i; j++) low = Math.min(low, e[j] ?? Infinity);
      if (low > Math.min(e[last] ?? 0, v) - dipDb) {
        if (v > (e[last] ?? 0)) ev[ev.length - 1] = i;
        continue;
      }
    }
    ev.push(i);
  }
  return {
    attacks: ev.map((i) => roundTo((i * h + w / 2) / LISTEN_SR, 3)),
    count: ev.length,
    preSwellMs: roundTo(((i6 - i30) * 1000 * h) / LISTEN_SR, 1),
  };
}

export interface TakeTimes {
  readonly onsetS: number;
  readonly peakS: number;
  readonly endS: number;
  readonly durS: number;
}

function rmsEnvelope(m: Float64Array, win: number, hop: number): { e: Float64Array; starts: number[] } {
  const c = new Float64Array(m.length + 1);
  for (let i = 0; i < m.length; i++) c[i + 1] = (c[i] ?? 0) + (m[i] ?? 0) ** 2;
  const starts: number[] = [];
  for (let s = 0; s < Math.max(1, m.length - win + 1); s += hop) starts.push(s);
  const e = Float64Array.from(starts, (s) =>
    Math.sqrt(Math.max(((c[Math.min(s + win, m.length)] ?? 0) - (c[s] ?? 0)) / win, 0)),
  );
  return { e, starts };
}

/** bank.times(y): a take's onset, loudest 5 ms (its centre) and end, seconds (4 decimals). */
export function takeTimes(m: Float64Array): TakeTimes {
  const one = rmsEnvelope(m, 48, 12);
  let top1 = 0;
  for (const v of one.e) top1 = Math.max(top1, v);
  const firstOn = one.e.findIndex((v) => v >= top1 * 10 ** (-30 / 20));
  const on = one.e.length > 0 ? (one.starts[Math.max(0, firstOn)] ?? 0) : 0;
  const five = rmsEnvelope(m, 240, 48);
  let ip = 0;
  for (let i = 1; i < five.e.length; i++) if ((five.e[i] ?? 0) > (five.e[ip] ?? 0)) ip = i;
  const floor = (five.e[ip] ?? 0) * 10 ** (-50 / 20);
  let lastLive = -1;
  for (let i = 0; i < five.e.length; i++) if ((five.e[i] ?? 0) >= floor) lastLive = i;
  const end = lastLive >= 0 ? Math.min(m.length, (five.starts[lastLive] ?? 0) + 240) : m.length;
  return {
    onsetS: roundTo(on / LISTEN_SR, 4),
    peakS: roundTo(((five.starts[ip] ?? 0) + 120) / LISTEN_SR, 4),
    endS: roundTo(end / LISTEN_SR, 4),
    durS: roundTo(m.length / LISTEN_SR, 4),
  };
}
