// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Music-like clips: a drum pattern at a known tempo over a chord progression in a known key (pad, bass and an
 * optional arpeggio), all synthesised here. The planted truth (tempo, beat and bar times, key, chord changes)
 * goes into the clip manifest.
 */
import {
  arEnvelope,
  expDecay,
  filter,
  harmonicTone,
  highpass1,
  midiHz,
  mixAt,
  noise,
  prng,
  samples,
  SR,
  sweptSine,
} from './synth.mjs';

export const NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
/** Scale degrees (0-based) of each bar's chord. */
export const PROGRESSIONS = {
  major: [
    [0, 4, 5, 3],
    [0, 3, 4, 0],
    [0, 5, 3, 4],
  ],
  minor: [
    [0, 5, 2, 6],
    [0, 3, 4, 0],
    [0, 6, 5, 4],
  ],
};

export function kick(rnd) {
  const n = samples(0.35);
  const x = sweptSine(n, 160 + rnd() * 20, 48, 0.035);
  expDecay(x, 0.12);
  const click = noise(samples(0.004), rnd);
  mixAt(x, filter(click, 'highpass', 2000), 0, 0.3);
  return x;
}

export function snare(rnd) {
  const n = samples(0.25);
  const x = highpass1(noise(n, rnd), 900);
  expDecay(x, 0.06);
  const body = sweptSine(n, 240, 180, 0.02);
  mixAt(x, expDecay(body, 0.05), 0, 0.5);
  return x;
}

export function hat(rnd, open = false) {
  const x = filter(noise(samples(open ? 0.3 : 0.08), rnd), 'highpass', 7000, 0.9);
  return expDecay(x, open ? 0.09 : 0.018);
}

/** The triad of scale degree `deg` as MIDI notes, rooted near `base`. */
export function triad(root, mode, deg, base = 60) {
  const sc = SCALES[mode];
  const note = (d) => root + sc[d % 7] + 12 * Math.floor(d / 7);
  const r = note(deg);
  const shift = 12 * Math.round((base - r) / 12);
  return [r, note(deg + 2), note(deg + 4)].map((m) => m + shift);
}

export function chordName(root, mode, deg) {
  const [a, b] = triad(root, mode, deg);
  const minor = (b - a + 12) % 12 === 3;
  return `${NOTES[a % 12]}${minor ? 'm' : ''}`;
}

/**
 * Render a music clip. params: seconds, bpm, root (0 = C), mode, progression index, seed, startS (first beat),
 * drums ('full' | 'light' | 'none'), arp (bool), hats (8 | 16).
 */
export function renderMusic(p) {
  const n = samples(p.seconds);
  const out = new Float64Array(n);
  const rnd = prng(p.seed);
  const beat = 60 / p.bpm;
  const start = p.startS ?? 0.25;
  const prog = PROGRESSIONS[p.mode][p.progression ?? 0];
  const beats = [];
  for (let k = 0; start + k * beat < p.seconds - 0.05; k += 1) beats.push(start + k * beat);
  const drums = p.drums ?? 'full';
  const sounds = { kick: kick(rnd), snare: snare(rnd), hat: hat(rnd), open: hat(rnd, true) };
  beats.forEach((t, k) => {
    const pos = k % 4;
    const at = samples(t);
    const vel = 0.85 + 0.15 * rnd();
    if (drums !== 'none') {
      if (pos === 0 || pos === 2 || (drums === 'full' && pos === 3 && k % 8 === 7))
        mixAt(out, sounds.kick, pos === 3 ? samples(t + beat / 2) : at, 0.9 * vel);
      if (pos === 1 || pos === 3) mixAt(out, sounds.snare, at, (drums === 'full' ? 0.5 : 0.3) * vel);
      const per = p.hats === 16 ? 4 : 2;
      for (let h = 0; h < per; h += 1) {
        const ht = samples(t + (h * beat) / per);
        const accent = h === 0 ? 1 : 0.6;
        mixAt(
          out,
          k % 8 === 6 && h === 1 ? sounds.open : sounds.hat,
          ht,
          0.16 * accent * (0.8 + 0.2 * rnd()),
        );
      }
    }
  });
  const bars = [];
  for (let b = 0; b * 4 < beats.length; b += 1) bars.push(beats[b * 4]);
  const chords = bars.map((t, b) => {
    const deg = prog[b % prog.length];
    const end = b + 1 < bars.length ? bars[b + 1] : p.seconds;
    const len = samples(end - t + 0.12);
    for (const m of triad(p.root, p.mode, deg, 60)) {
      const tone = arEnvelope(harmonicTone(len, midiHz(m), 6, 0.55, rnd() * 6.28), 0.06, 0.18);
      mixAt(out, tone, samples(t), 0.09);
    }
    const bassNote = triad(p.root, p.mode, deg, 40)[0];
    for (let q = 0; q < 4 && b * 4 + q < beats.length; q += 1) {
      const bt = beats[b * 4 + q];
      const tone = expDecay(harmonicTone(samples(beat * 0.95), midiHz(bassNote), 3, 0.35), beat * 0.5);
      mixAt(out, arEnvelope(tone, 0.004, 0.03), samples(bt), 0.32);
    }
    if (p.arp) {
      const notes = triad(p.root, p.mode, deg, 72);
      for (let e = 0; e < 8 && b * 4 + e / 2 < beats.length; e += 1) {
        const et = t + (e * beat) / 2;
        const tone = expDecay(harmonicTone(samples(beat * 0.45), midiHz(notes[e % 3]), 4, 0.4), 0.12);
        mixAt(out, arEnvelope(tone, 0.003, 0.02), samples(et), 0.07);
      }
    }
    return { t: round3(t), chord: chordName(p.root, p.mode, deg) };
  });
  const truth = {
    bpm: p.bpm,
    key: `${NOTES[p.root]} ${p.mode}`,
    firstBeatS: round3(start),
    beats: beats.map(round3),
    downbeats: bars.map(round3),
    chords,
  };
  return { channels: [out], truth };
}

const round3 = (v) => Math.round(v * 1000) / 1000;

export { SR };
