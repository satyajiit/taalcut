// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EAR1-K0 fixtures: a listening of a 3-second reel at 30 fps, every optional field filled once. */
import {
  FrameRates,
  RationalTime,
  type CutSyncReport,
  type RenderListening,
  type SoundAuditReport,
  type SoundCritique,
  type SoundEvent,
  type SoundMeasures,
  type SoundRealness,
  type SoundSection,
  type SoundTag,
  type TemplateListening,
} from '@taalcut/core';

/** Listening times are at 48 kHz (sample-accurate); cuts at the picture's 30 fps. */
const hz = (value: number) => RationalTime.of(value, FrameRates.hz48000);
const frame = (value: number) => RationalTime.of(value, FrameRates.fps30);

export const MODEL = {
  clap: 'laion/larger_clap_general@16c8cc3',
  ast: 'MIT/ast-finetuned-audioset-10-10-0.4593@f826b80',
  dtype: 'fp16',
  configVersion: 'listen-1',
} as const;

export const whooshTag: SoundTag = {
  term: 'a fast air whoosh',
  category: 'transitions',
  cosine: 0.41,
  z: 3.12,
  verdict: 'strong',
  hint: false,
  borderline: true,
  pVsAlts: 0.82,
};

export const genreHint: SoundTag = {
  term: 'lo-fi hip hop',
  category: 'music_genre',
  cosine: 0.37,
  z: 2.7,
  verdict: null,
  hint: true,
  borderline: false,
};

export function measures(): SoundMeasures {
  return {
    duration: hz(144_000),
    lufs: -11.4,
    truePeakDbtp: -0.8,
    peakDbfs: -1.1,
    lraLu: null,
    crestLu: 4.2,
    noiseFloorDbfs: -62.5,
    nearSilent: false,
    bandwidthHz: 16_000,
    brightnessHz: 2450,
    bands: { sub: -18.2, low: -6.1, lowmid: -5.4, mid: -9.8, presence: -16.7, air: -24.3 },
    sideToMidDb: -9.6,
    tempo: { bpm: 120, alt: null, clarity: 0.42, confidence: 'clear' },
    key: { tonic: 'F#', mode: 'minor', confidence: 0.71 },
  };
}

/** A near-silent take: what can't be measured is null, and tempo and key were never asked for. */
export function silentMeasures(): SoundMeasures {
  return {
    duration: hz(4800),
    lufs: null,
    truePeakDbtp: -240,
    peakDbfs: -240,
    lraLu: null,
    crestLu: null,
    noiseFloorDbfs: -240,
    nearSilent: true,
    bandwidthHz: null,
    brightnessHz: null,
    bands: null,
    sideToMidDb: null,
  };
}

export function hit(): SoundEvent {
  return {
    at: hz(48_240),
    shape: 'hit',
    band: 'high',
    contrastDb: 18.4,
    prominenceDb: 14.1,
    bedDb: -31.5,
    peakDbfs: -3.2,
    lengthMs: 180,
    kind: 'whoosh',
    tags: [
      { term: 'a fast air whoosh', kind: 'whoosh', z: 3.4 },
      { term: 'a short swish', kind: 'whoosh', z: 2.1 },
    ],
    audioSet: [{ label: 'Whoosh, swoosh, swish', score: 0.62 }],
    exposed: true,
    beatOffsetMs: 5,
  };
}

export function swell(): SoundEvent {
  return {
    at: hz(95_520),
    shape: 'swell',
    band: 'full',
    contrastDb: 11,
    prominenceDb: 11,
    bedDb: -40.2,
    peakDbfs: -6.4,
    lengthMs: 420,
    riseMs: 650,
    exposed: false,
  };
}

export function section(): SoundSection {
  return {
    start: hz(0),
    end: hz(144_000),
    label: 'lo-fi hip hop, piano | also: whoosh (AST)',
    genre: [genreHint],
    mood: [{ ...genreHint, term: 'calm relaxing music', category: 'music_mood', z: 2.2 }],
    instruments: [{ ...genreHint, term: 'a piano', category: 'instruments', z: 2.9 }],
    ambience: [
      {
        term: 'a quiet room tone',
        category: 'ambience',
        cosine: 0.2,
        z: 1.1,
        verdict: 'no_match',
        hint: false,
        borderline: false,
      },
    ],
    voice: [],
    presence: { music: 0.91, speech: 0.04, silence: 0 },
    audioSet: [{ label: 'Music', score: 0.91 }],
    lufs: -11.6,
    silent: false,
  };
}

export function cutSync(): CutSyncReport {
  return {
    items: [
      {
        cutIndex: 0,
        at: frame(30),
        status: 'ok',
        offsetMs: 5,
        eventAt: hz(48_240),
        prominenceDb: 14.1,
        accentOffsetMs: 5,
        beatOffsetMs: -2.5,
      },
      { cutIndex: 1, at: frame(60), status: 'swell', offsetMs: -10, eventAt: hz(95_520), prominenceDb: 11 },
      { cutIndex: 2, at: frame(75), status: 'none', offsetMs: null },
    ],
    cutsWithoutHit: [2],
    okShare: 1 / 3,
    nearShare: 1 / 3,
    chanceShare: 0.12,
    medianOffsetMs: 7.5,
    toleranceMs: 33.3,
    frameRate: FrameRates.fps30,
    onBeatShare: 0.67,
    onBeatChance: 0.2,
  };
}

export function audit(): SoundAuditReport {
  return {
    ok: false,
    findings: [
      { kind: 'click', severity: 'warning', at: hz(72_000), detail: '1 click at 1.500 s' },
      {
        kind: 'truncated_tail',
        severity: 'note',
        detail: 'tail cut at -40 dB re peak (the stop is the design)',
      },
    ],
  };
}

export function critique(): SoundCritique {
  return {
    profile: 'launch',
    verdict: 'close',
    score: 0.8,
    partial: true,
    metrics: [
      { id: 'lufsI', weight: 3, value: -11.4, range: { min: -16, max: -9 }, status: 'ok' },
      { id: 'truePeak', weight: 2, value: -0.8, range: { min: null, max: -1 }, status: 'high' },
      { id: 'pReal', weight: 3, value: null, range: null, status: 'na' },
    ],
    fixes: [
      {
        metricId: 'truePeak',
        messageKey: 'audio.critique.fix.truePeakHigh',
        params: { valueDb: -0.8, limitDb: -1, layer: 'music' },
        at: frame(30),
        command: { name: 'music.setDucking', payload: { projectId: 'p', ducking: { floorDb: -12 } } },
      },
      { messageKey: 'audio.critique.fix.addHitOnCut', params: { cut: 3 } },
    ],
  };
}

export function realness(): SoundRealness {
  return {
    pReal: 0.88,
    verdict: 'real',
    windows: [
      { start: hz(0), end: hz(96_000), pReal: 0.9 },
      { start: hz(96_000), end: hz(144_000), pReal: null },
    ],
  };
}

export function renderListening(): RenderListening {
  return {
    measures: measures(),
    events: [hit(), swell()],
    cutSync: cutSync(),
    audit: audit(),
    critique: critique(),
    realness: realness(),
    model: { ...MODEL },
  };
}

export function templateListening(): TemplateListening {
  return {
    version: 1,
    model: { ...MODEL },
    measures: measures(),
    events: [hit(), swell()],
    sections: [section()],
    cutSync: cutSync(),
    sfxAtCuts: [
      { cutIndex: 0, family: 'whoosh', soundHint: 'a fast air whoosh', offsetMs: 5 },
      { cutIndex: 1, family: 'riser', offsetMs: -10 },
    ],
    realness: realness(),
  };
}
