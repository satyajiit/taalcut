// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Deterministic synthesis primitives for the parity clips. Everything runs in float64 on a seeded PRNG and plain
 * arithmetic plus Math.sin / cos / exp / log / pow, which V8 implements with its own fdlibm port, so a clip renders
 * to the same bytes on every machine. The clip manifest pins each clip's sha256, so any drift shows up at once.
 */

export const SR = 48000;

/** mulberry32: a small seeded PRNG giving uniform numbers in [0, 1). */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gaussian numbers (Box-Muller) from a uniform source. */
export function gauss(rnd) {
  let spare = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    const u = Math.max(rnd(), 1e-12);
    const v = rnd();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}

export const samples = (seconds) => Math.round(seconds * SR);
export const dbToGain = (db) => Math.pow(10, db / 20);
export const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** White noise, n samples. */
export function noise(n, rnd) {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) out[i] = rnd() * 2 - 1;
  return out;
}

/** One-pole low-pass in place. */
export function lowpass1(x, hz) {
  const a = Math.exp((-2 * Math.PI * hz) / SR);
  let y = 0;
  for (let i = 0; i < x.length; i += 1) {
    y = (1 - a) * x[i] + a * y;
    x[i] = y;
  }
  return x;
}

/** One-pole high-pass in place (the input minus its one-pole low-pass). */
export function highpass1(x, hz) {
  const a = Math.exp((-2 * Math.PI * hz) / SR);
  let y = 0;
  for (let i = 0; i < x.length; i += 1) {
    y = (1 - a) * x[i] + a * y;
    x[i] -= y;
  }
  return x;
}

/** RBJ cookbook biquad coefficients: kind lowpass | highpass | bandpass (0 dB peak). */
export function biquad(kind, hz, q) {
  const w = (2 * Math.PI * hz) / SR;
  const cw = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (kind === 'lowpass') [b0, b1, b2] = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2];
  else if (kind === 'highpass') [b0, b1, b2] = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2];
  else [b0, b1, b2] = [alpha, 0, -alpha];
  const a0 = 1 + alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * cw) / a0, a2: (1 - alpha) / a0 };
}

/** A biquad's running state, so coefficients can change block by block (formant glides). */
export function biquadState() {
  return { x1: 0, x2: 0, y1: 0, y2: 0 };
}

export function biquadRun(x, c, s = biquadState(), from = 0, to = x.length) {
  for (let i = from; i < to; i += 1) {
    const y = c.b0 * x[i] + c.b1 * s.x1 + c.b2 * s.x2 - c.a1 * s.y1 - c.a2 * s.y2;
    s.x2 = s.x1;
    s.x1 = x[i];
    s.y2 = s.y1;
    s.y1 = y;
    x[i] = y;
  }
  return x;
}

/** Filter a whole buffer with one biquad, in place. */
export function filter(x, kind, hz, q = Math.SQRT1_2) {
  return biquadRun(x, biquad(kind, hz, q));
}

/** Multiply by exp(-t / tau) from the start. */
export function expDecay(x, tauS) {
  const k = Math.exp(-1 / (tauS * SR));
  let g = 1;
  for (let i = 0; i < x.length; i += 1) {
    x[i] *= g;
    g *= k;
  }
  return x;
}

/** Linear fade in over the first `inS` and out over the last `outS` seconds. */
export function fade(x, inS, outS) {
  const a = samples(inS);
  const b = samples(outS);
  for (let i = 0; i < a && i < x.length; i += 1) x[i] *= i / a;
  for (let i = 0; i < b && i < x.length; i += 1) x[x.length - 1 - i] *= i / b;
  return x;
}

/** Add `src * gain` into `dst` from sample `at` (clipped to dst). */
export function mixAt(dst, src, at, gain = 1) {
  const from = Math.max(0, -at);
  const to = Math.min(src.length, dst.length - at);
  for (let i = from; i < to; i += 1) dst[at + i] += src[i] * gain;
  return dst;
}

/**
 * A harmonic tone (partials 1..h with amplitude rolloff^(k-1)) of n samples at hz, built with the Chebyshev
 * recurrence sin((k+1)w) = 2 cos(w) sin(kw) - sin((k-1)w): two trig calls per sample, whatever the partial count.
 * Partials above 16 kHz are left out.
 */
export function harmonicTone(n, hz, partials = 6, rolloff = 0.6, phase = 0) {
  const out = new Float64Array(n);
  const step = (2 * Math.PI * hz) / SR;
  const top = Math.max(1, Math.min(partials, Math.floor(16000 / hz)));
  for (let i = 0; i < n; i += 1) {
    const w = phase + step * i;
    const s1 = Math.sin(w);
    const c2 = 2 * Math.cos(w);
    let prev = 0;
    let cur = s1;
    let amp = 1;
    let sum = 0;
    for (let k = 1; k <= top; k += 1) {
      sum += amp * cur;
      const next = c2 * cur - prev;
      prev = cur;
      cur = next;
      amp *= rolloff;
    }
    out[i] = sum;
  }
  return out;
}

/** A sine whose frequency glides exponentially from f0 to f1 with time constant tau (kick drums, drops). */
export function sweptSine(n, f0, f1, tauS) {
  const out = new Float64Array(n);
  let phase = 0;
  for (let i = 0; i < n; i += 1) {
    const f = f1 + (f0 - f1) * Math.exp(-i / (tauS * SR));
    phase += (2 * Math.PI * f) / SR;
    out[i] = Math.sin(phase);
  }
  return out;
}

/** An attack / release envelope over n samples (linear attack, exponential release from relS before the end). */
export function arEnvelope(x, attackS, releaseS) {
  const a = Math.max(1, samples(attackS));
  const r = Math.max(1, samples(releaseS));
  for (let i = 0; i < x.length; i += 1) {
    let g = i < a ? i / a : 1;
    const left = x.length - i;
    if (left < r) g *= left / r;
    x[i] *= g;
  }
  return x;
}

export function peakOf(channels) {
  let p = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i += 1) p = Math.max(p, Math.abs(ch[i]));
  return p;
}

/** Scale every channel so the sample peak is `peakDb` dBFS (a silent buffer stays silent). */
export function normalisePeak(channels, peakDb) {
  const p = peakOf(channels);
  if (p === 0) return channels;
  const g = dbToGain(peakDb) / p;
  for (const ch of channels) for (let i = 0; i < ch.length; i += 1) ch[i] *= g;
  return channels;
}

/** Shuffle a copy of `items` with the PRNG (Fisher-Yates). */
export function shuffled(items, rnd) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Round a float64 buffer to float32, the stored sample format. */
export function toFloat32(x) {
  return Float32Array.from(x);
}
