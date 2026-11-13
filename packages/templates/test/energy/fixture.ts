// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A 30 fps template on a 120 BPM grid (one beat = 15 frames) for the energy-curve tests. */
import {
  FrameRates,
  newId,
  RationalTime,
  templateSchema,
  type Template,
  type TemplateSlot,
} from '@taalcut/core';
import { computePacing } from '../../src/edits/timing';

const rate = FrameRates.fps30;
export const BEAT = 15;

export interface SlotSpec {
  readonly frames: number;
  readonly role: TemplateSlot['role'];
  readonly energy: number;
}

export function gridTemplate(
  specs: readonly SlotSpec[],
  overlays: readonly { readonly start: number; readonly frames: number; readonly slot: number }[] = [],
): Template {
  let cursor = 0;
  const slots: TemplateSlot[] = specs.map((spec) => {
    const start = cursor;
    cursor += spec.frames;
    return {
      id: newId(),
      name: null,
      role: spec.role,
      start: RationalTime.of(start, rate),
      duration: RationalTime.of(spec.frames, rate),
      intent: {
        text: spec.role,
        shotType: 'wide',
        motion: 'static',
        subject: null,
        people: null,
        place: null,
        energy: spec.energy,
        source: 'user',
      },
      beatAnchor: { beatIndex: start / BEAT, offset: RationalTime.of(0, rate) },
      transitionIn: null,
      speedRamp: null,
      cut: { method: 'user', confidence: 1 },
      approved: false,
      frame: null,
    };
  });
  const beats = [];
  for (let frame = 0; frame < cursor; frame += BEAT) beats.push(RationalTime.of(frame, rate));
  const beatMap = {
    rate,
    beats,
    downbeats: beats.map((_, index) => index).filter((index) => index % 4 === 0),
    bpm: 120,
    beatsPerBar: 4,
    confidence: 1,
    source: 'user' as const,
  };
  const text = overlays.map((overlay) => {
    const slot = slots[overlay.slot];
    if (!slot) throw new Error('overlay slot');
    return {
      id: newId<'TextOverlay'>(),
      text: 'caption',
      role: 'label' as const,
      start: RationalTime.of(overlay.start, rate),
      duration: RationalTime.of(overlay.frames, rate),
      slotId: slot.id,
      box: { x: 0.13, y: 0.28, width: 0.4, height: 0.05 },
      appearance: { size: 0.03, align: 'left' as const, case: 'mixed' as const, background: 'none' as const },
      styleKey: 'label',
      reveal: 'fade' as const,
      language: null,
      confidence: 1,
    };
  });
  return templateSchema.parse({
    schemaVersion: 1,
    id: newId(),
    version: 1,
    parentVersion: null,
    createdAt: 5,
    origin: { kind: 'manual' },
    canvas: { width: 1080, height: 1920, rate },
    duration: RationalTime.of(cursor, rate),
    slots,
    beatMap,
    text,
    audio: { kind: 'music', loudnessLufs: null, sound: null, speech: null, waveform: null },
    pacing: computePacing(slots, beatMap, rate),
    styleId: null,
    contactSheet: null,
    language: null,
  });
}
