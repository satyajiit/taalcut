// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { Template } from '@taalcut/core';

const FPS = { num: 30, den: 1 } as const;
const TRACKER = { num: 50, den: 1 } as const;
const at = (frames: number) => ({ value: frames, rate: FPS });
const id = <T>(n: number): T => `01K7C5M6Q8600000000000000${n}` as T;

/** A four-slot reel at 120 BPM (15 frames a beat): two beats, two, four, then two. */
const BEATS = [2, 2, 4, 2] as const;

export function templateFixture(overrides: Partial<Template> = {}): Template {
  let start = 0;
  let beat = 0;
  const slots = BEATS.map((beats, index) => {
    const duration = beats * 15;
    const slot: Template['slots'][number] = {
      id: id(index + 1),
      name: index === 2 ? 'The pour' : null,
      role: index === 0 ? 'hook' : index === 2 ? 'peak' : 'body',
      start: at(start),
      duration: at(duration),
      intent: {
        text: ['Hands lift the lid', 'Steam over the pot', 'Chai pours into a glass', 'A sip, then a smile'][
          index
        ]!,
        shotType: index === 2 ? 'close' : 'medium',
        motion: index === 1 ? 'pan' : 'static',
        subject: null,
        people: null,
        place: null,
        energy: 0.4 + index * 0.1,
        source: 'analyst',
      },
      beatAnchor: { beatIndex: beat, offset: at(0) },
      transitionIn: null,
      speedRamp: null,
      cut: index === 0 ? { method: 'rule', confidence: 1 } : { method: 'both', confidence: 0.9 },
      approved: index === 0,
      frame: index,
    };
    start += duration;
    beat += beats;
    return slot;
  });
  const frames = start;
  return {
    schemaVersion: 1,
    id: id(9),
    version: 1,
    parentVersion: null,
    createdAt: Date.UTC(2026, 9, 11),
    origin: {
      kind: 'reference',
      input: 'link',
      platform: 'reels',
      url: 'https://www.instagram.com/reel/C9xChai/',
      fingerprint: 'a'.repeat(64),
      source: { duration: at(frames), rate: FPS, width: 1080, height: 1920 },
      crop: null,
      pipelineVersion: '1.0.0',
      configVersion: 'breakdown-2026-10',
      analysedAt: Date.UTC(2026, 9, 11),
    },
    canvas: { width: 1080, height: 1920, rate: FPS },
    duration: at(frames),
    slots,
    beatMap: {
      rate: TRACKER,
      beats: Array.from({ length: beat }, (_, i) => ({ value: i * 25, rate: TRACKER })),
      downbeats: [0, 4, 8],
      bpm: 120,
      beatsPerBar: 4,
      confidence: 0.92,
      source: 'tracker',
    },
    text: [
      {
        id: id(8),
        text: 'Monsoon chai',
        role: 'title',
        start: slots[0]!.start,
        duration: slots[0]!.duration,
        slotId: slots[0]!.id,
        box: { x: 0.08, y: 0.18, width: 0.84, height: 0.08 },
        appearance: { size: 0.035, align: 'center', case: 'upper', background: 'none' },
        styleKey: 'title',
        reveal: 'pop',
        language: 'en',
        confidence: 0.93,
      },
    ],
    audio: {
      kind: 'music',
      loudnessLufs: -9.8,
      sound: null,
      speech: null,
      waveform: {
        rate: TRACKER,
        peaks: Array.from({ length: Math.round((frames / 30) * 50) }, (_, i) => (i % 25) / 25),
      },
    },
    pacing: {
      shotCount: slots.length,
      meanShot: at(Math.round(frames / slots.length)),
      medianShot: at(30),
      shortestShot: at(30),
      longestShot: at(60),
      hookEnd: at(30),
      cutsOnBeat: 1,
    },
    styleId: null,
    contactSheet: {
      asset: 'b'.repeat(64),
      mediaType: 'image/jpeg',
      columns: 4,
      rows: 1,
      tile: { width: 90, height: 160 },
      frames: slots.map((slot) => ({ at: at(slot.start.value + 5), slotId: slot.id })),
    },
    language: 'en',
    ...overrides,
  };
}
