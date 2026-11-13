// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The parity clip set: every clip's id, category and generator parameters, and `renderClip`, which makes one.
 * Generated clips are float32 WAV at 48 kHz and are never committed (tests regenerate them); the SFX clips are
 * renders of upstream earshot's own MIT sound bank, committed as 16-bit WAV (fixtures/clips/sfx).
 */
import { renderFilm } from './film.mjs';
import { renderMusic } from './music.mjs';
import { impact, padBed, pop, rain, roomTone } from './sounds.mjs';
import {
  dbToGain,
  fade,
  harmonicTone,
  mixAt,
  normalisePeak,
  prng,
  samples,
  SR,
  toFloat32,
} from './synth.mjs';
import { renderSpeech } from './voice.mjs';

const MUSIC_KEYS = [
  [80, 0, 'major', 0],
  [90, 9, 'minor', 0],
  [96, 7, 'major', 1],
  [100, 4, 'minor', 1],
  [110, 2, 'major', 2],
  [120, 5, 'major', 0],
  [124, 10, 'major', 1],
  [128, 2, 'minor', 2],
  [135, 3, 'major', 2],
  [140, 0, 'minor', 0],
  [150, 9, 'major', 1],
  [170, 6, 'minor', 2],
];
const NOTE_IDS = ['c', 'cs', 'd', 'eb', 'e', 'f', 'fs', 'g', 'ab', 'a', 'bb', 'b'];

export const MUSIC = MUSIC_KEYS.map(([bpm, root, mode, progression], i) => ({
  id: `music-${String(bpm).padStart(3, '0')}-${NOTE_IDS[root]}${mode === 'major' ? 'maj' : 'min'}`,
  category: 'music',
  kind: 'music',
  params: {
    seconds: 14 + (i % 4) * 2,
    bpm,
    root,
    mode,
    progression,
    seed: 1000 + i,
    startS: 0.15 + 0.05 * (i % 3),
    drums: i % 5 === 3 ? 'light' : 'full',
    arp: i % 2 === 0,
    hats: bpm < 100 ? 16 : 8,
    peakDb: -1 - (i % 4) * 2,
  },
}));

export const SPEECH = [
  [110, 1.0, 4.0, 6],
  [125, 1.05, 4.5, 7],
  [180, 1.18, 3.5, 5],
  [210, 1.22, 5.0, 8],
  [95, 0.97, 3.8, 6],
  [150, 1.1, 4.2, 9],
].map(([f0, scale, rate, seconds], i) => ({
  id: `speech-${String(i + 1).padStart(2, '0')}`,
  category: 'speech',
  kind: 'speech',
  params: {
    seconds,
    seed: 2000 + i,
    f0,
    scale,
    rate,
    pauseEvery: 5 + i,
    breath: 0.004 + 0.002 * (i % 3),
    peakDb: -3,
  },
}));

export const EDGE = [
  { id: 'edge-near-silent', kind: 'near-silent', params: { seconds: 6, peakDb: -76, seed: 3001 } },
  { id: 'edge-digital-silence', kind: 'digital-silence', params: { seconds: 3 } },
  { id: 'edge-pure-tone', kind: 'pure-tone', params: { seconds: 3, hz: 1000, peakDb: -6 } },
  { id: 'edge-clipped', kind: 'clipped', params: { seconds: 8, driveDb: 12, seed: 3004 } },
  { id: 'edge-dc-offset', kind: 'dc-offset', params: { seconds: 5, dc: 0.25, peakDb: -8, seed: 3005 } },
  { id: 'edge-very-short', kind: 'very-short', params: { seconds: 0.2, seed: 3006 } },
  { id: 'edge-long-70s', kind: 'long', params: { seconds: 70, seed: 3007 } },
].map((c) => ({ ...c, category: 'edge' }));

export const TEXTURE = [
  { id: 'texture-rain', category: 'texture', kind: 'rain', params: { seconds: 12, seed: 4001, peakDb: -6 } },
  {
    id: 'texture-room-tone',
    category: 'texture',
    kind: 'room',
    params: { seconds: 8, seed: 4002, peakDb: -40 },
  },
  {
    id: 'mix-speech-over-music',
    category: 'mix',
    kind: 'speech-over-music',
    params: { seconds: 12, seed: 4003, bpm: 104, peakDb: -2 },
  },
];

/** Upstream bank sounds rendered with `earshot sfx render` (their own seed, default length), see README. */
export const SFX_SOUNDS = [
  'whoosh_fast/crisp',
  'riser/snatch',
  'pro_impact/short',
  'cut_hit/punch',
  'click/double',
  'pop/0',
  'ui_pop/boop',
  'pro_notify/ding_2045',
  'swipe/flick',
  'typing_key/thock',
  'pro_typing_key/soft',
  'glitch/hit',
  'pro_zip/up',
  'fit/tick/domino',
];
export const SFX = SFX_SOUNDS.map((sound) => ({
  id: `sfx-${sound.replaceAll('/', '-').replaceAll('_', '-')}`,
  category: 'sfx',
  kind: 'bank',
  params: { sound },
  file: `clips/sfx/sfx-${sound.replaceAll('/', '-').replaceAll('_', '-')}.wav`,
}));

const FILM_VARIANTS = [
  // The reference film. Seed 5019 of the first 30 makes upstream read every sync status (OK, near, swell, peak,
  // off, no sound) on at least 3 cuts.
  { bed: 'pad', bedDb: -20, hitDb: -6, masterPeakDb: -3, seed: 5019 },
  { bed: 'drums', bpm: 120, bedDb: -10, hitDb: -6, masterPeakDb: -1 },
  { bed: 'none', hitDb: -4, masterPeakDb: -2 },
  { bed: 'pad+speech', bedDb: -14, hitDb: -8, masterPeakDb: -2 },
  { bed: 'pad', bedDb: -16, hitDb: -8, masterPeakDb: -14 },
  { bed: 'drums', bpm: 100, bedDb: -8, hitDb: -4, masterPeakDb: 0, clip: 6 },
  { bed: 'pad', bedDb: -18, hitDb: -6, masterPeakDb: -1, introS: 3 },
  { bed: 'drums', bpm: 96, bedDb: -12, hitDb: -6, masterPeakDb: -1, fadeS: 2.5 },
  {
    bed: 'pad',
    bedDb: -20,
    hitDb: -6,
    masterPeakDb: -3,
    shiftMs: 120,
    plants: ['on', 'late20', 'swell', 'none'],
  },
  { bed: 'drums', bpm: 150, bedDb: -10, hitDb: -5, masterPeakDb: -1, mono: true },
];
export const FILMS = FILM_VARIANTS.map((v, i) => ({
  id: `film-${String(i).padStart(2, '0')}`,
  category: 'film',
  kind: 'film',
  params: { seed: 5000 + 17 * i, ...v },
}));

export const GENERATED = [...MUSIC, ...SPEECH, ...EDGE, ...TEXTURE];
export const CLIPS = [...GENERATED, ...SFX];
export const ALL = [...CLIPS, ...FILMS];

export function clipSpec(id) {
  const spec = ALL.find((c) => c.id === id);
  if (!spec) throw new Error(`no parity clip ${id}`);
  return spec;
}

/** Render a generated clip or film: { sampleRate, channels: Float32Array[], truth }. SFX clips are files. */
export function renderClip(spec) {
  const out = render(spec);
  return { sampleRate: SR, channels: out.channels.map(toFloat32), truth: out.truth ?? {} };
}

function render({ kind, params: p }) {
  switch (kind) {
    case 'music': {
      const m = renderMusic(p);
      normalisePeak(m.channels, p.peakDb);
      return m;
    }
    case 'speech': {
      const v = renderSpeech(p);
      normalisePeak(v.channels, p.peakDb);
      return v;
    }
    case 'film':
      return renderFilm(p);
    case 'near-silent': {
      const m = renderMusic({ seconds: p.seconds, bpm: 100, root: 0, mode: 'major', seed: p.seed });
      return { channels: normalisePeak(m.channels, p.peakDb), truth: { peakDbfs: p.peakDb } };
    }
    case 'digital-silence':
      return { channels: [new Float64Array(samples(p.seconds))], truth: { peakDbfs: null } };
    case 'pure-tone': {
      const x = harmonicTone(samples(p.seconds), p.hz, 1);
      fade(x, 0.005, 0.005);
      return { channels: normalisePeak([x], p.peakDb), truth: { hz: p.hz, peakDbfs: p.peakDb } };
    }
    case 'clipped': {
      const m = renderMusic({ seconds: p.seconds, bpm: 118, root: 7, mode: 'major', seed: p.seed });
      const [x] = normalisePeak(m.channels, 0);
      const g = dbToGain(p.driveDb);
      let clipped = 0;
      for (let i = 0; i < x.length; i += 1) {
        const v = x[i] * g;
        if (Math.abs(v) >= 1) clipped += 1;
        x[i] = Math.max(-1, Math.min(1, v));
      }
      return { channels: [x], truth: { ...m.truth, driveDb: p.driveDb, clippedSamples: clipped } };
    }
    case 'dc-offset': {
      const [x] = normalisePeak([padBed(p.seconds, prng(p.seed))], p.peakDb);
      for (let i = 0; i < x.length; i += 1) x[i] += p.dc;
      return { channels: [x], truth: { dc: p.dc } };
    }
    case 'very-short': {
      const x = new Float64Array(samples(p.seconds));
      mixAt(x, pop(prng(p.seed)).x, samples(0.02), 0.7);
      return { channels: [x], truth: { onsetS: 0.02 } };
    }
    case 'long':
      return renderLong(p);
    case 'rain':
      return { channels: normalisePeak([rain(p.seconds, p.seed)], p.peakDb), truth: {} };
    case 'room':
      return { channels: normalisePeak([roomTone(p.seconds, p.seed)], p.peakDb), truth: {} };
    case 'speech-over-music': {
      const m = renderMusic({
        seconds: p.seconds,
        bpm: p.bpm,
        root: 5,
        mode: 'major',
        seed: p.seed,
        drums: 'light',
      });
      normalisePeak(m.channels, -14);
      const v = renderSpeech({ seconds: p.seconds, seed: p.seed + 1, f0: 140, rate: 4.2, scale: 1.08 });
      normalisePeak(v.channels, -4);
      mixAt(m.channels[0], v.channels[0], 0);
      normalisePeak(m.channels, p.peakDb);
      return { channels: m.channels, truth: { bpm: p.bpm, key: 'F major', speech: v.truth.phrases } };
    }
    default:
      throw new Error(`unknown clip kind ${kind}`);
  }
}

/** 70 s with four sections: music A, rain, speech, music B (0.5 s crossfades), plus an impact at 45.2 s. */
function renderLong(p) {
  const n = samples(p.seconds);
  const out = new Float64Array(n);
  const a = renderMusic({ seconds: 20.5, bpm: 110, root: 0, mode: 'major', seed: p.seed, arp: true })
    .channels[0];
  const r = rain(15.5, p.seed + 1);
  const v = renderSpeech({ seconds: 15.5, seed: p.seed + 2, f0: 120, rate: 4, scale: 1 }).channels[0];
  const b = renderMusic({ seconds: 20, bpm: 140, root: 9, mode: 'minor', seed: p.seed + 3 }).channels[0];
  const parts = [
    [a, 0, -3],
    [r, 20, -12],
    [v, 35, -6],
    [b, 50, -3],
  ];
  for (const [x, start, db] of parts) {
    normalisePeak([x], db);
    fade(x, 0.5, 0.5);
    mixAt(out, x, samples(start));
  }
  mixAt(out, impact(prng(p.seed + 4)).x, samples(45.2), 0.6);
  return {
    channels: [out],
    truth: {
      sections: [
        { start: 0, end: 20.5, kind: 'music', bpm: 110, key: 'C major' },
        { start: 20, end: 35.5, kind: 'rain' },
        { start: 35, end: 50.5, kind: 'speech' },
        { start: 50, end: 70, kind: 'music', bpm: 140, key: 'A minor' },
      ],
      impactS: 45.2,
    },
  };
}
