// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Speech-like clips by formant synthesis: a jittered glottal pulse train through three formant resonators that
 * glide between vowels, syllable envelopes, fricative and plosive noise, and pauses between phrases. No recording
 * and no text-to-speech is involved.
 */
import { biquad, biquadRun, biquadState, filter, gauss, mixAt, noise, prng, samples, SR } from './synth.mjs';

/** F1-F3 (Hz) of five vowels, an adult-male set; `scale` raises them for a higher voice. */
const VOWELS = {
  a: [730, 1090, 2440],
  e: [530, 1840, 2480],
  i: [270, 2290, 3010],
  o: [570, 840, 2410],
  u: [300, 870, 2240],
};
const BANDWIDTHS = [90, 110, 170];
const BLOCK = 240;

/**
 * params: seconds, seed, f0 (Hz), scale (formant scale), rate (syllables per second), pauseEvery (syllables per
 * phrase), breath (aspiration level). Returns mono channels and the planted syllable and phrase times.
 */
export function renderSpeech(p) {
  const n = samples(p.seconds);
  const rnd = prng(p.seed);
  const g = gauss(prng(p.seed ^ 0x5bd1e995));
  const plan = syllables(p, rnd);
  const env = new Float64Array(n);
  const f1 = new Float64Array(Math.ceil(n / BLOCK) + 1);
  const targets = [f1, new Float64Array(f1.length), new Float64Array(f1.length)];
  let last = VOWELS.a;
  for (const s of plan) {
    const a = samples(s.start);
    const b = Math.min(n, samples(s.end));
    const len = b - a;
    for (let i = 0; i < len; i += 1) {
      const u = i / len;
      env[a + i] = Math.max(env[a + i], Math.min(1, u / 0.2) * Math.min(1, (1 - u) / 0.35) * s.level);
    }
    const v = VOWELS[s.vowel].map((f) => f * (p.scale ?? 1));
    for (let k = Math.floor(a / BLOCK); k * BLOCK < b; k += 1) {
      const u = Math.min(1, (k * BLOCK - a) / (0.25 * len));
      for (let f = 0; f < 3; f += 1) targets[f][k] = last[f] + (v[f] - last[f]) * Math.max(0, u);
    }
    last = v;
  }
  for (let k = 1; k < f1.length; k += 1)
    for (let f = 0; f < 3; f += 1) if (targets[f][k] === 0) targets[f][k] = targets[f][k - 1] || last[f];
  const src = glottal(n, p, plan, rnd, g);
  for (let i = 0; i < n; i += 1) src[i] = src[i] * env[i] + (p.breath ?? 0.005) * g() * env[i];
  const out = new Float64Array(n);
  for (let f = 0; f < 3; f += 1) {
    const band = Float64Array.from(src);
    const st = biquadState();
    for (let k = 0; k * BLOCK < n; k += 1) {
      const hz = Math.max(150, targets[f][k] || last[f]);
      biquadRun(
        band,
        biquad('bandpass', hz, hz / BANDWIDTHS[f]),
        st,
        k * BLOCK,
        Math.min(n, (k + 1) * BLOCK),
      );
    }
    mixAt(out, band, 0, [1, 0.7, 0.35][f]);
  }
  for (const s of plan) if (s.consonant) consonant(out, s, rnd);
  filter(out, 'lowpass', 6500, 0.7);
  const phrases = [];
  for (const s of plan) {
    const cur = phrases.at(-1);
    if (cur && s.phrase === cur.phrase) cur.end = round3(s.end);
    else phrases.push({ phrase: s.phrase, start: round3(s.start), end: round3(s.end) });
  }
  return {
    channels: [out],
    truth: {
      f0Hz: p.f0,
      syllables: plan.length,
      phrases: phrases.map(({ start, end }) => ({ start, end })),
      vowels: plan.map((s) => s.vowel).join(''),
    },
  };
}

function syllables(p, rnd) {
  const plan = [];
  const names = Object.keys(VOWELS);
  let t = 0.3 + rnd() * 0.2;
  let phrase = 0;
  let count = 0;
  while (t < p.seconds - 0.4) {
    const len = (0.6 + 0.8 * rnd()) / p.rate;
    plan.push({
      start: t,
      end: Math.min(p.seconds - 0.2, t + len),
      vowel: names[Math.floor(rnd() * names.length)],
      level: 0.6 + 0.4 * rnd(),
      consonant: rnd() < 0.45 ? (rnd() < 0.75 ? 'fricative' : 'plosive') : null,
      phrase,
    });
    t += len + 0.02 + 0.05 * rnd();
    count += 1;
    if (count % (p.pauseEvery ?? 7) === 0) {
      t += 0.35 + 0.4 * rnd();
      phrase += 1;
    }
  }
  return plan;
}

/**
 * A Rosenberg glottal pulse train (rising 40% of the period, closing in 16%), differentiated for lip radiation.
 * f0 falls 20% over each phrase, with an accent on some syllables and 1% jitter.
 */
function glottal(n, p, plan, rnd, g) {
  const x = new Float64Array(n);
  const accent = plan.map(() => (rnd() < 0.3 ? 1.15 : 1));
  const phraseSpan = new Map();
  for (const s of plan) {
    const span = phraseSpan.get(s.phrase) ?? [s.start, s.end];
    phraseSpan.set(s.phrase, [Math.min(span[0], s.start), Math.max(span[1], s.end)]);
  }
  let phase = 0;
  let k = 0;
  let prev = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / SR;
    while (k < plan.length - 1 && t > plan[k].end + 0.03) k += 1;
    const s = plan[k];
    const [a, b] = phraseSpan.get(s.phrase);
    const u = Math.min(1, Math.max(0, (t - a) / Math.max(0.1, b - a)));
    const inSyl = t >= s.start - 0.03 && t <= s.end + 0.03;
    const f0 = p.f0 * (1.08 - 0.2 * u) * (inSyl ? accent[k] : 1) * (1 + 0.01 * g());
    phase += f0 / SR;
    if (phase >= 1) phase -= 1;
    const pulse =
      phase < 0.4
        ? 0.5 * (1 - Math.cos((Math.PI * phase) / 0.4))
        : phase < 0.56
          ? Math.cos((Math.PI / 2) * ((phase - 0.4) / 0.16))
          : 0;
    x[i] = pulse - prev;
    prev = pulse;
  }
  return filter(x, 'highpass', 60);
}

function consonant(out, s, rnd) {
  if (s.consonant === 'fricative') {
    const burst = filter(noise(samples(0.07 + 0.05 * rnd()), rnd), 'bandpass', 4800, 1.2);
    for (let i = 0; i < burst.length; i += 1) burst[i] *= Math.sin((Math.PI * i) / burst.length);
    mixAt(out, burst, samples(s.start) - burst.length, 0.04 * s.level);
  } else {
    const burst = filter(noise(samples(0.02), rnd), 'bandpass', 1500, 0.7);
    for (let i = 0; i < burst.length; i += 1) burst[i] *= Math.sin((Math.PI * i) / burst.length);
    mixAt(out, burst, samples(s.start) - samples(0.025), 0.12 * s.level);
  }
}

const round3 = (v) => Math.round(v * 1000) / 1000;
