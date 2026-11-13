// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Synthetic Template v1 documents: slots on a beat grid, anchors on their cuts, optional ramps and text. */
import {
  FrameRate,
  FrameRates,
  newId,
  RationalTime,
  templateSchema,
  type CameraMotion,
  type SlotId,
  type SpeedRamp,
  type Template,
  type TemplateSlot,
  type TextOverlay,
  type TRANSITION_KINDS,
} from '@taalcut/core';

export interface SlotDef {
  readonly frames: number;
  readonly text?: string;
  readonly motion?: CameraMotion | null;
  readonly energy?: number;
  readonly people?: number | null;
  readonly subject?: string | null;
  readonly pending?: boolean;
  /** Default true: anchored on the beat at its start. */
  readonly anchor?: boolean;
  readonly transition?: {
    readonly kind: (typeof TRANSITION_KINDS)[number];
    readonly before: number;
    readonly after: number;
  };
  /** Ramp points as [frame, speed]. */
  readonly ramp?: readonly (readonly [number, number])[];
}

export interface OverlayDef {
  readonly start: number;
  readonly frames: number;
  readonly text: string;
  readonly slot?: number;
  /** BRK1-GFX: how the reel drew it. */
  readonly design?: TextOverlay['design'];
  /** Where the reel had it (default: a band across the top). */
  readonly box?: TextOverlay['box'];
}

export interface TemplateDef {
  readonly rate?: FrameRate;
  readonly slots: readonly SlotDef[];
  /** Beat interval in canvas frames; every slot starts on a beat. */
  readonly beatEvery?: number;
  readonly overlays?: readonly OverlayDef[];
  readonly beats?: boolean;
  readonly origin?: 'manual' | 'format';
}

const BEAT_RATE = FrameRate.of(1000);

export function buildTemplate(def: TemplateDef): Template {
  const rate = def.rate ?? FrameRates.fps30;
  const at = (frames: number) => RationalTime.of(frames, rate);
  const beatEvery = def.beatEvery ?? 15;
  const duration = def.slots.reduce((sum, slot) => sum + slot.frames, 0);
  const withBeats = def.beats ?? true;
  const beatFrames: number[] = [];
  for (let frame = 0; frame <= duration; frame += beatEvery) beatFrames.push(frame);
  const ids = def.slots.map(() => newId<'TemplateSlot'>());
  let start = 0;
  const slots: TemplateSlot[] = def.slots.map((slot, index) => {
    const ramp: SpeedRamp | null = slot.ramp
      ? { curve: 'linear', points: slot.ramp.map(([frame, speed]) => ({ at: at(frame), speed })) }
      : null;
    const beatIndex = beatFrames.indexOf(start);
    const anchored = withBeats && (slot.anchor ?? true) && beatIndex >= 0;
    const built: TemplateSlot = {
      id: ids[index] as SlotId,
      name: null,
      role: index === 0 ? 'hook' : index === def.slots.length - 1 ? 'outro' : 'body',
      start: at(start),
      duration: at(slot.frames),
      intent: {
        text: slot.pending ? '' : (slot.text ?? `slot ${index}`),
        shotType: null,
        motion: slot.motion ?? null,
        subject: slot.subject ?? null,
        people: slot.people ?? null,
        place: null,
        energy: slot.energy ?? 0.5,
        source: slot.pending ? 'pending' : 'analyst',
      },
      beatAnchor: anchored ? { beatIndex, offset: at(0) } : null,
      transitionIn: slot.transition
        ? {
            kind: slot.transition.kind,
            before: at(slot.transition.before),
            after: at(slot.transition.after),
            direction: null,
            confidence: 1,
          }
        : null,
      speedRamp: ramp,
      cut: { method: 'both', confidence: 1 },
      approved: false,
      frame: null,
    };
    start += slot.frames;
    return built;
  });
  const text: TextOverlay[] = (def.overlays ?? []).map((overlay) => ({
    id: newId<'TextOverlay'>(),
    text: overlay.text,
    role: 'title',
    start: at(overlay.start),
    duration: at(overlay.frames),
    slotId: overlay.slot === undefined ? null : (ids[overlay.slot] as SlotId),
    box: overlay.box ?? { x: 0.1, y: 0.1, width: 0.8, height: 0.1 },
    appearance: { size: 0.05, align: 'center', case: 'mixed', background: 'none' },
    styleKey: 'title',
    reveal: 'none',
    ...(overlay.design ? { design: overlay.design } : {}),
    language: 'en',
    confidence: 1,
  }));
  const lengths = def.slots.map((slot) => slot.frames).sort((a, b) => a - b);
  const template = {
    schemaVersion: 1,
    id: newId<'Template'>(),
    version: 1,
    parentVersion: null,
    createdAt: 0,
    origin:
      def.origin === 'format'
        ? { kind: 'format', formatId: 'vlog', formatVersion: '1', target: at(duration), brief: 'a vlog' }
        : { kind: 'manual' },
    canvas: { width: 1080, height: 1920, rate },
    duration: at(duration),
    slots,
    beatMap: withBeats
      ? {
          rate: BEAT_RATE,
          beats: beatFrames.map((frame) => RationalTime.rescale(at(frame), BEAT_RATE, 'round')),
          downbeats: beatFrames.flatMap((_, index) => (index % 4 === 0 ? [index] : [])),
          bpm: 120,
          beatsPerBar: 4,
          confidence: 1,
          source: 'tracker',
        }
      : null,
    text,
    audio: { kind: 'music', loudnessLufs: -14, sound: null, speech: null, waveform: null },
    pacing: {
      shotCount: slots.length,
      meanShot: at(Math.round(duration / slots.length)),
      medianShot: at(lengths[Math.floor(lengths.length / 2)] ?? 0),
      shortestShot: at(lengths[0] ?? 0),
      longestShot: at(lengths.at(-1) ?? 0),
      hookEnd: at(Math.min(def.slots[0]?.frames ?? 0, Math.round(FrameRate.toNumber(rate) * 3))),
      cutsOnBeat: 1,
    },
    styleId: null,
    contactSheet: null,
    language: null,
  };
  return templateSchema.parse(template);
}
