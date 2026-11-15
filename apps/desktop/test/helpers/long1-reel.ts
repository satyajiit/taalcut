// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LONG1's synthetic reel, for the test that goes from its samples to the mixed sound (long1-reel-music.test.ts):
 * the sound (a drum loop with known bars), a float WAV writer and reader, and the owner's timeline over it.
 */
import {
  DEFAULT_MIX,
  FrameRates,
  newId,
  RationalTime,
  TIMELINE_SCHEMA_VERSION,
  TimeRange,
  timelineSchema,
  type Clip,
  type FrameRate,
  type TemplateId,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';

const SR = 48_000;
/** 470 frames at 30 a second. */
export const REEL_SAMPLES = 752_000;
/** One beat: eight of them (two bars) are 4.3 s, 129 frames. */
const BEAT = 4.3 / 8;
const FIRST_BAR = 1.5;
const DROP = 10.1;

/** mulberry32: the same noise on every run. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Adds a sound to `out` from `at` seconds: a sine (hz) or seeded noise, `amp` high, dying away over `decay`. */
function hit(
  out: Float32Array,
  at: number,
  sound: { readonly hz?: number; readonly seed?: number; readonly seconds: number; readonly decay?: number },
  amp: number,
) {
  const next = random(sound.seed ?? 1);
  const start = Math.round(at * SR);
  const length = Math.round(sound.seconds * SR);
  for (let i = 0; i < length && start + i < out.length; i++) {
    const wave = sound.hz ? Math.sin((2 * Math.PI * sound.hz * i) / SR) : next() * 2 - 1;
    const fall = sound.decay ? Math.exp(-i / (sound.decay * SR)) : 1;
    out[start + i] = (out[start + i] ?? 0) + amp * wave * fall;
  }
}

/**
 * The reel's sound, mono at 48 kHz: four beats to the bar, a kick on one and three, a noise snare on two and four,
 * a hat between the beats, a bass note that changes with each bar over a two-bar phrase; from the drop at 10.1 s
 * everything is louder and a pad joins. The beats before the first bar (1.5 s) are a pickup.
 */
export function reelLoop(): Float32Array {
  const out = new Float32Array(REEL_SAMPLES);
  hit(out, 0, { seed: 11, seconds: REEL_SAMPLES / SR }, 0.0005);
  const pickup = Math.floor(FIRST_BAR / BEAT + 1e-9);
  const first = FIRST_BAR - pickup * BEAT;
  const end = REEL_SAMPLES / SR - 0.05;
  for (let index = 0, at = first; at < end; index++, at = first + index * BEAT) {
    const inBar = (((index - pickup) % 4) + 4) % 4;
    const bar = Math.floor((index - pickup) / 4);
    const loud = at >= DROP - 1e-6 ? 1.6 : 1;
    if (inBar % 2 === 0)
      hit(out, at, { hz: 60, seconds: 0.25, decay: 0.07 }, 0.5 * loud * (inBar === 0 ? 1 : 0.8));
    else hit(out, at, { seed: 30 + inBar, seconds: 0.12, decay: 0.03 }, 0.25 * loud);
    hit(out, at + BEAT / 2, { seed: 50, seconds: 0.03, decay: 0.008 }, 0.08 * loud);
    if (inBar === 0)
      hit(out, at, { hz: bar % 2 === 0 ? 110 : 146.83, seconds: 4 * BEAT, decay: 1.2 }, 0.12 * loud);
  }
  hit(out, DROP, { hz: 330, seconds: REEL_SAMPLES / SR - DROP }, 0.1);
  return out;
}

/** A stereo 32-bit float WAV at 48 kHz with the sound on both channels (a mono file is upmixed 3 dB down). */
export function wavOf(mono: Float32Array): Buffer {
  const data = mono.length * 8;
  const out = Buffer.alloc(44 + data);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + data, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(3, 20); // IEEE float
  out.writeUInt16LE(2, 22);
  out.writeUInt32LE(SR, 24);
  out.writeUInt32LE(SR * 8, 28);
  out.writeUInt16LE(8, 32);
  out.writeUInt16LE(32, 34);
  out.write('data', 36);
  out.writeUInt32LE(data, 40);
  for (let i = 0; i < mono.length; i++) {
    out.writeFloatLE(mono[i] ?? 0, 44 + i * 8);
    out.writeFloatLE(mono[i] ?? 0, 48 + i * 8);
  }
  return out;
}

/** The left channel of a 32-bit float WAV (render's mix: stereo at 48 kHz). */
export function readLeft(wav: Buffer): Float32Array {
  const channels = wav.readUInt16LE(22);
  let offset = 12;
  while (wav.toString('latin1', offset, offset + 4) !== 'data') offset += 8 + wav.readUInt32LE(offset + 4);
  const start = offset + 8;
  // FFmpeg writes a size of 0xFFFFFFFF or the true one: the samples run to the file's end either way.
  const frames = Math.floor((wav.length - start) / (4 * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = wav.readFloatLE(start + i * 4 * channels);
  return out;
}

function clip(frames: number, rate: FrameRate, sourceStart: number, available: number): Clip {
  return {
    type: 'clip',
    id: newId<'TimelineItem'>(),
    media: {
      kind: 'video',
      assetId: newId<'Asset'>(),
      shotId: newId<'Shot'>(),
      available: TimeRange.of(RationalTime.of(0, rate), RationalTime.of(available, rate)),
    },
    sourceStart: RationalTime.of(sourceStart, rate),
    duration: RationalTime.of(frames, FrameRates.fps30),
    speed: null,
    slotId: newId<'TemplateSlot'>(),
    syncPoint: null,
    beatAnchor: null,
    fit: 'cover',
    audio: { gainDb: 0, muted: true },
    locked: false,
    enabled: true,
    stillMotion: null,
    reframe: null,
  };
}

/**
 * The owner's video over the reel: the creator's clip in the first slot (303 frames of a 22.5 s file at 60 frames
 * a second, in at frame 514 so that 18.4 s is its frame 295), then the reel's own footage from its frame 303 to
 * its end, on the reel's own music.
 */
export function ownerTimeline(templateId: TemplateId): { timeline: Timeline; personClip: TimelineItemId } {
  const person = clip(303, FrameRates.fps60, 514, 1350);
  const film = clip(167, FrameRates.fps30, 303, 470);
  const parts = {
    intent: 0.7,
    motion: 1,
    quality: 0.8,
    subject: 0.5,
    energy: 0.9,
    hook: null,
    rerank: null,
    penalty: 0,
  };
  const slot = (item: Clip, note: 'reelKept' | null) => ({
    slotId: item.slotId,
    clipId: item.id,
    pick: {
      assetId: item.media.assetId,
      shotId: item.media.kind === 'video' ? item.media.shotId : null,
      sourceStart: item.sourceStart,
      syncPoint: null,
      score: 0.7,
      parts,
    },
    alternates: [],
    confidence: 0.8,
    needsRerank: false,
    note,
  });
  const timeline = timelineSchema.parse({
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    id: newId<'Timeline'>(),
    projectId: newId<'Project'>(),
    name: 'The owner’s make',
    revision: 1,
    canvas: { width: 1080, height: 1920, rate: FrameRates.fps30 },
    template: { id: templateId, version: 1 },
    beatMap: null,
    tracks: [{ kind: 'video', id: 'V1', name: 'V1', enabled: true, items: [person, film] }],
    markers: [],
    cast: {
      castId: newId<'Cast'>(),
      mode: 'template',
      variantIndex: 0,
      variantCount: 1,
      configVersion: 'casting.v4',
      sequenceConfidence: 0.9,
      slots: [slot(person, null), slot(film, 'reelKept')],
    },
    captions: null,
    music: { path: 'referenceAudio', templateId, gainDb: 0 },
    styleId: null,
    voiceover: null,
    mix: DEFAULT_MIX,
    createdAt: 0,
    updatedAt: 0,
  });
  return { timeline, personClip: person.id };
}
