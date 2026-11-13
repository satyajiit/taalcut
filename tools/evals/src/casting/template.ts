// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Template v1 documents for synthetic casting cases: slots back to back on a
 * beat grid, each with an intent written the way the Analyst writes one.
 * Every result passes core's templateSchema.
 */
import {
  FrameRate,
  newId,
  RationalTime,
  templateSchema,
  type CameraMotion,
  type SlotId,
  type Template,
  type TemplateSlot,
} from '@taalcut/core';

export interface FixtureSlot {
  readonly frames: number;
  readonly intent: string;
  readonly motion: CameraMotion | null;
  readonly energy: number;
}

const BEAT_RATE = FrameRate.of(1000);

/** A 30 fps, 1080×1920 template whose every slot starts on a beat. */
export function fixtureTemplate(defs: readonly FixtureSlot[]): Template {
  const rate = FrameRate.of(30);
  const at = (frames: number) => RationalTime.of(frames, rate);
  const starts: number[] = [];
  let start = 0;
  const slots: TemplateSlot[] = defs.map((def, index) => {
    starts.push(start);
    const slot: TemplateSlot = {
      id: newId<'TemplateSlot'>() as SlotId,
      name: null,
      role: index === 0 ? 'hook' : index === defs.length - 1 ? 'outro' : 'body',
      start: at(start),
      duration: at(def.frames),
      intent: {
        text: def.intent,
        shotType: null,
        motion: def.motion,
        subject: null,
        people: null,
        place: null,
        energy: def.energy,
        source: 'analyst',
      },
      beatAnchor: { beatIndex: index, offset: at(0) },
      transitionIn: null,
      speedRamp: null,
      cut: { method: 'both', confidence: 1 },
      approved: false,
      frame: null,
    };
    start += def.frames;
    return slot;
  });
  const lengths = defs.map((def) => def.frames).sort((a, b) => a - b);
  return templateSchema.parse({
    schemaVersion: 1,
    id: newId<'Template'>(),
    version: 1,
    parentVersion: null,
    createdAt: 0,
    origin: { kind: 'manual' },
    canvas: { width: 1080, height: 1920, rate },
    duration: at(start),
    slots,
    beatMap: {
      rate: BEAT_RATE,
      beats: [...starts, start].map((frame) => RationalTime.rescale(at(frame), BEAT_RATE, 'round')),
      downbeats: [0],
      bpm: null,
      beatsPerBar: null,
      confidence: 1,
      source: 'tracker',
    },
    text: [],
    audio: { kind: 'music', loudnessLufs: -14, sound: null, speech: null, waveform: null },
    pacing: {
      shotCount: slots.length,
      meanShot: at(Math.round(start / slots.length)),
      medianShot: at(lengths[Math.floor(lengths.length / 2)] ?? 0),
      shortestShot: at(lengths[0] ?? 0),
      longestShot: at(lengths.at(-1) ?? 0),
      hookEnd: at(defs[0]?.frames ?? 0),
      cutsOnBeat: 1,
    },
    styleId: null,
    contactSheet: null,
    language: null,
  });
}
