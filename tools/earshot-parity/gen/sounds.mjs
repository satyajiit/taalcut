// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One-shots and textures made here: the hits planted in the fixture films, the edge clips and the ambient beds.
 * Each one-shot reports where its attack starts (`onsetS`), so a film can place that attack on a planned time.
 */
import {
  expDecay,
  filter,
  gauss,
  harmonicTone,
  highpass1,
  lowpass1,
  mixAt,
  noise,
  prng,
  samples,
  SR,
  sweptSine,
} from './synth.mjs';

/** A short bright click (2 ms burst, ringing at ~3 kHz). */
export function click(rnd) {
  const x = filter(noise(samples(0.06), rnd), 'bandpass', 2800 + 600 * rnd(), 4);
  expDecay(x, 0.01);
  return { x: scale(x, 1), onsetS: 0 };
}

/** A low impact: a pitched sweep with a noise transient and a dark tail. */
export function impact(rnd) {
  const n = samples(0.9);
  const x = sweptSine(n, 120, 42, 0.06);
  expDecay(x, 0.28);
  const crack = lowpass1(noise(samples(0.03), rnd), 4000);
  expDecay(crack, 0.008);
  mixAt(x, crack, 0, 0.8);
  return { x: scale(x, 1), onsetS: 0 };
}

/** A round pop: a fast downward pitch blip. */
export function pop(rnd) {
  const x = sweptSine(samples(0.12), 900 + 200 * rnd(), 380, 0.012);
  expDecay(x, 0.03);
  return { x: scale(x, 1), onsetS: 0 };
}

/** A tonal tick: a short bell partial set. */
export function tick(rnd) {
  const x = harmonicTone(samples(0.25), 1760 + 220 * Math.floor(rnd() * 4), 3, 0.3);
  expDecay(x, 0.05);
  return { x: scale(x, 1), onsetS: 0 };
}

/**
 * A swell (whoosh / riser): band-passed noise rising for `riseS`, peaking, then falling for `fallS`. `peakS` is
 * the time of the loudest moment from the start of the buffer. `smooth` rounds the peak and falls on a half
 * cosine instead of an exponential, so no attack marks the peak (a build-up an onset detector misses).
 */
export function swell(rnd, riseS = 0.6, fallS = 0.25, smooth = false) {
  const n = samples(riseS + fallS);
  const x = noise(n, rnd);
  filter(x, 'bandpass', smooth ? 1200 : 1800, 0.7);
  if (smooth) filter(x, 'lowpass', 3000);
  const a = samples(riseS);
  for (let i = 0; i < n; i += 1) {
    let g;
    if (smooth)
      g =
        i < a
          ? Math.pow(Math.sin((Math.PI / 2) * (i / a)), 4)
          : 0.5 * (1 + Math.cos((Math.PI * (i - a)) / (n - a)));
    else g = i < a ? Math.pow(i / a, 3) : Math.exp(-(i - a) / (0.06 * SR));
    x[i] *= g;
  }
  return { x: scale(x, 1), onsetS: 0, peakS: riseS };
}

/** A soft sustained pad bed (no attacks after its fade-in): chords of the film's key, crossfaded. */
export function padBed(seconds, rnd, root = 57) {
  const n = samples(seconds);
  const out = new Float64Array(n);
  const chords = [
    [0, 4, 7],
    [5, 9, 12],
    [7, 11, 14],
    [-3, 0, 4],
  ];
  const len = samples(4);
  for (let c = 0; c * len < n; c += 1) {
    const span = Math.min(n - c * len, len + samples(1.5));
    for (const st of chords[c % chords.length]) {
      const tone = harmonicTone(span, 440 * Math.pow(2, (root + st - 69) / 12), 4, 0.45, rnd() * 6.28);
      for (let i = 0; i < span; i += 1) {
        const u = i / span;
        tone[i] *= Math.min(1, u / 0.3) * Math.min(1, (1 - u) / 0.3);
      }
      mixAt(out, tone, c * len, 0.12);
    }
  }
  return out;
}

/** Rain-like texture: pink-ish noise with sparse droplets. */
export function rain(seconds, seed) {
  const rnd = prng(seed);
  const n = samples(seconds);
  const out = lowpass1(noise(n, rnd), 3000);
  highpass1(out, 200);
  for (let i = 0; i < n; i += 1) out[i] *= 0.6;
  const drops = Math.floor(seconds * 25);
  for (let d = 0; d < drops; d += 1) {
    const drop = filter(noise(samples(0.02), rnd), 'bandpass', 2500 + 3000 * rnd(), 3);
    expDecay(drop, 0.004);
    mixAt(out, drop, Math.floor(rnd() * n), 0.3 + 0.5 * rnd());
  }
  return out;
}

/** Room tone: very soft low-passed noise with a faint mains hum. */
export function roomTone(seconds, seed) {
  const rnd = prng(seed);
  const g = gauss(rnd);
  const n = samples(seconds);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) out[i] = g();
  lowpass1(out, 800);
  const hum = harmonicTone(n, 50, 4, 0.5);
  mixAt(out, hum, 0, 0.02);
  return out;
}

/** Normalise a one-shot to a sample peak of `peak`. */
function scale(x, peak) {
  let p = 0;
  for (let i = 0; i < x.length; i += 1) p = Math.max(p, Math.abs(x[i]));
  if (p > 0) for (let i = 0; i < x.length; i += 1) x[i] *= peak / p;
  return x;
}

export const ONE_SHOTS = { click, impact, pop, tick };
