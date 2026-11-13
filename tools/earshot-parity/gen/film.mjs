// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Fixture films: a picture of flat colour cards with hard cuts on frame boundaries, and a soundtrack with hits
 * planted at known offsets from those cuts (on the cut, +20, +60, +120 and -80 ms, swells peaking at the cut, and
 * cuts left without sound), over an optional bed. Every plant is listed in the truth with its cut.
 */
import { renderMusic } from './music.mjs';
import { ONE_SHOTS, padBed, swell } from './sounds.mjs';
import { dbToGain, fade, mixAt, normalisePeak, peakOf, prng, samples, shuffled, SR } from './synth.mjs';
import { renderSpeech } from './voice.mjs';

export const FPS = 30;
export const WIDTH = 180;
export const HEIGHT = 320;

/** Planted answers to a cut: offset of the attack (or of a swell's peak) from the cut, in ms; null = no sound. */
export const PLANTS = {
  on: { offsetMs: 0, kind: 'hit' },
  late20: { offsetMs: 20, kind: 'hit' },
  late60: { offsetMs: 60, kind: 'hit' },
  late120: { offsetMs: 120, kind: 'hit' },
  late180: { offsetMs: 180, kind: 'hit' },
  early80: { offsetMs: -80, kind: 'hit' },
  swell: { offsetMs: 0, kind: 'swell' },
  swell200: { offsetMs: 200, kind: 'swell', smooth: true },
  none: { offsetMs: null, kind: 'none' },
};
const PLANT_ORDER = Object.keys(PLANTS);

/** Card colours, far apart in luma so every cut is a clear frame difference. */
const PALETTE = [
  [240, 240, 235],
  [25, 25, 30],
  [220, 60, 50],
  [40, 90, 200],
  [250, 200, 40],
  [30, 140, 80],
  [150, 150, 150],
  [120, 40, 140],
];
const luma = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Cut frames: the first at ~0.6 s, then every 0.7-1.6 s, until `minCuts` cuts and at least `minSeconds`. */
export function cutPlan(seed, minCuts = 32, minSeconds = 38) {
  const rnd = prng(seed ^ 0x9e3779b9);
  const frames = [18];
  while (frames.length < minCuts || frames.at(-1) / FPS < minSeconds)
    frames.push(frames.at(-1) + 21 + Math.floor(rnd() * 28));
  const cards = [];
  let prev = PALETTE[0];
  cards.push({ frame: 0, rgb: prev });
  for (const f of frames) {
    const options = PALETTE.filter((c) => Math.abs(luma(c) - luma(prev)) >= 40);
    prev = options[Math.floor(rnd() * options.length)];
    cards.push({ frame: f, rgb: prev });
  }
  return { frames, cards, totalFrames: frames.at(-1) + 45 };
}

/**
 * params: seed, bed ('pad' | 'drums' | 'none' | 'pad+speech'), bpm, bedDb and hitDb (peaks before the master),
 * shiftMs (moves every plant), introS (bed and plants start no earlier), fadeS, mono, masterPeakDb, clip (drive in
 * dB into a hard clip at full scale), plants (kinds to cycle, default all).
 */
export function renderFilm(p) {
  const rnd = prng(p.seed);
  const plan = cutPlan(p.seed);
  const seconds = plan.totalFrames / FPS;
  const n = samples(seconds);
  const left = new Float64Array(n);
  const right = new Float64Array(n);
  const bed = makeBed(p, seconds, rnd);
  if (bed) {
    const at = samples(p.introS ?? 0);
    normalisePeak([bed], p.bedDb ?? -18);
    mixAt(left, bed, at);
    mixAt(right, bed, at + 12, 0.95);
  }
  const kinds = p.plants ?? PLANT_ORDER;
  const order = [];
  while (order.length < plan.frames.length) order.push(...shuffled(kinds, rnd));
  const shots = Object.keys(ONE_SHOTS);
  const plants = plan.frames.map((frame, i) => {
    const cutS = frame / FPS;
    const name = order[i];
    const plant = PLANTS[name];
    const row = { cut: i, frame, t: round4(cutS), plant: name, kind: plant.kind, offsetMs: plant.offsetMs };
    if (plant.offsetMs === null || cutS < (p.introS ?? 0))
      return { ...row, plant: 'none', kind: 'none', offsetMs: null };
    const offsetMs = plant.offsetMs + (p.shiftMs ?? 0);
    const pan = 0.5 + 0.3 * (rnd() - 0.5);
    const level = dbToGain((p.hitDb ?? -6) - 3 * rnd());
    if (plant.kind === 'swell') {
      const s = plant.smooth ? swell(rnd, 1 + 0.3 * rnd(), 0.45, true) : swell(rnd, 0.45 + 0.3 * rnd(), 0.2);
      const at = samples(cutS + offsetMs / 1000 - s.peakS);
      mixAt(left, s.x, at, level * 0.8 * (1 - pan) * 2);
      mixAt(right, s.x, at, level * 0.8 * pan * 2);
      return { ...row, offsetMs, sound: 'swell', eventS: round4(cutS + offsetMs / 1000) };
    }
    const sound = shots[i % shots.length];
    const s = ONE_SHOTS[sound](rnd);
    const at = samples(cutS + offsetMs / 1000);
    mixAt(left, s.x, at, level * (1 - pan) * 2);
    mixAt(right, s.x, at, level * pan * 2);
    return { ...row, offsetMs, sound, eventS: round4(at / SR) };
  });
  const channels = [left, right];
  if (p.fadeS) for (const ch of channels) fade(ch, p.fadeS, p.fadeS);
  normalisePeak(channels, p.masterPeakDb ?? -1);
  if (p.clip) {
    const g = dbToGain(p.clip);
    for (const ch of channels) for (let i = 0; i < n; i += 1) ch[i] = Math.max(-1, Math.min(1, ch[i] * g));
  }
  if (p.mono) for (let i = 0; i < n; i += 1) right[i] = left[i] = (left[i] + right[i]) / 2;
  return {
    channels,
    truth: {
      fps: FPS,
      width: WIDTH,
      height: HEIGHT,
      frames: plan.totalFrames,
      cuts: plan.frames.map((f) => round4(f / FPS)),
      cards: plan.cards,
      plants,
      peakDbfs: Math.round(20 * Math.log10(Math.max(peakOf(channels), 1e-12)) * 10) / 10,
    },
  };
}

function makeBed(p, seconds, rnd) {
  const bedS = seconds - (p.introS ?? 0);
  if (p.bed === 'none' || bedS <= 0.5) return null;
  if (p.bed === 'drums') {
    const music = renderMusic({
      seconds: bedS,
      bpm: p.bpm ?? 120,
      root: p.root ?? 9,
      mode: p.mode ?? 'minor',
      progression: 0,
      seed: p.seed + 101,
      drums: 'light',
      startS: 0.1,
    });
    return music.channels[0];
  }
  const bed = padBed(bedS, rnd);
  if (p.bed === 'pad+speech') {
    for (const [i, start] of [3, 14, 26].entries()) {
      if (start + 5 > bedS) continue;
      const voice = renderSpeech({
        seconds: 5,
        seed: p.seed + 7 * i,
        f0: 115 + 30 * i,
        rate: 4,
        scale: 1 + 0.08 * i,
      });
      normalisePeak(voice.channels, -4);
      mixAt(bed, voice.channels[0], samples(start), 0.5);
    }
  }
  return bed;
}

/** One RGB24 frame of the film's picture (flat card). */
export function frameRgb(cards, frame) {
  let card = cards[0];
  for (const c of cards) if (c.frame <= frame) card = c;
  const buf = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let i = 0; i < WIDTH * HEIGHT; i += 1) {
    buf[3 * i] = card.rgb[0];
    buf[3 * i + 1] = card.rgb[1];
    buf[3 * i + 2] = card.rgb[2];
  }
  return buf;
}

const round4 = (v) => Math.round(v * 10000) / 10000;
