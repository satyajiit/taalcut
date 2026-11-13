// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Templates stated shot by shot (LRN1-STY), with known style statistics: every shot length, text, transition and
 * sound is given, so a set's profile can be worked out by hand. profileOf's tests build their golden set with it,
 * and the style-profile eval (tools/evals) writes its synthetic labels with it. Ids are fixed per index, so a set
 * builds the same way every time, and every result passes core's templateSchema. Nothing here is a fake: the
 * documents are real Template v1, only their content is made up.
 */
import {
  FrameRate,
  RationalTime,
  templateSchema,
  type AudioProfile,
  type ShotType,
  type Template,
  type TemplateId,
  type TextOverlay,
  type Transition,
} from '@taalcut/core';

type TransitionKind = Transition['kind'];

export interface SyntheticText {
  /** The slot it starts in (at the slot's start), 0-based. */
  readonly slot: number;
  readonly text: string;
  /** The box's top (its height is 0.1). */
  readonly y?: number;
  readonly size?: number;
  readonly reveal?: TextOverlay['reveal'];
  readonly role?: TextOverlay['role'];
  readonly case?: TextOverlay['appearance']['case'];
  readonly background?: TextOverlay['appearance']['background'];
}

export interface SyntheticTemplateSpec {
  /** Fixes the template's id (and its slots' and texts' ids). */
  readonly index: number;
  /** Shot lengths in frames at `fps`. */
  readonly shots: readonly number[];
  readonly fps?: number;
  readonly canvas?: { readonly width: number; readonly height: number };
  readonly hookShotType?: ShotType | null;
  /** Each slot's transition in, from slot 1 (null: a plain cut). */
  readonly transitions?: readonly (TransitionKind | null)[];
  /** Slots with a speed ramp. */
  readonly ramps?: readonly number[];
  readonly texts?: readonly SyntheticText[];
  readonly audio?: {
    readonly kind: AudioProfile['kind'];
    readonly lufs: number | null;
    readonly peaks?: readonly number[];
  };
  /** The share of cuts on a beat the breakdown found; absent: no beat map. */
  readonly cutsOnBeat?: number;
}

/** A fixed ULID for the n-th thing of a kind (Crockford digits only). */
export function syntheticId<T extends string>(kind: number, n: number): T {
  return `01K8${String(kind).padStart(2, '0')}${String(n).padStart(20, '0')}` as T;
}

const TEMPLATE = 1;
const SLOT = 2;
const TEXT = 3;

function transitionInto(spec: SyntheticTemplateSpec, index: number, zero: RationalTime): Transition | null {
  const kind = index > 0 ? spec.transitions?.[index - 1] : null;
  return kind ? { kind, before: zero, after: zero, direction: null, confidence: 1 } : null;
}

export function syntheticTemplate(spec: SyntheticTemplateSpec): Template {
  const rate = FrameRate.of(spec.fps ?? 30);
  const at = (frames: number) => RationalTime.of(frames, rate);
  const id = syntheticId<TemplateId>(TEMPLATE, spec.index);
  let start = 0;
  const slots = spec.shots.map((length, index) => {
    const slot = {
      id: syntheticId<Template['slots'][number]['id']>(SLOT, spec.index * 1000 + index),
      name: null,
      role: index === 0 ? ('hook' as const) : ('body' as const),
      start: at(start),
      duration: at(length),
      intent: {
        text: `shot ${index + 1} of template ${spec.index}`,
        shotType: index === 0 ? (spec.hookShotType ?? null) : 'medium',
        motion: null,
        subject: null,
        people: null,
        place: null,
        energy: 0.5,
        source: 'analyst' as const,
      },
      beatAnchor: null,
      transitionIn: transitionInto(spec, index, at(0)),
      speedRamp: spec.ramps?.includes(index)
        ? {
            points: [
              { at: at(0), speed: 1 },
              { at: at(Math.max(1, length - 1)), speed: 2 },
            ],
            curve: 'ease' as const,
          }
        : null,
      cut: { method: 'both' as const, confidence: 1 },
      approved: false,
      frame: null,
    };
    start += length;
    return slot;
  });
  const total = start;
  const text: TextOverlay[] = (spec.texts ?? []).map((item, n) => {
    const slot = slots[item.slot];
    if (!slot) throw new RangeError(`no slot ${item.slot}`);
    return {
      id: syntheticId<TextOverlay['id']>(TEXT, spec.index * 1000 + n),
      text: item.text,
      role: item.role ?? 'title',
      start: slot.start,
      duration: slot.duration,
      slotId: slot.id,
      box: { x: 0.1, y: item.y ?? 0.1, width: 0.8, height: 0.1 },
      appearance: {
        size: item.size ?? 0.03,
        align: 'center',
        case: item.case ?? 'mixed',
        background: item.background ?? 'none',
      },
      styleKey: 'title',
      reveal: item.reveal ?? 'none',
      language: 'en',
      confidence: 1,
    };
  });
  const lengths = [...spec.shots].sort((a, b) => a - b);
  const audio = spec.audio ?? { kind: 'music' as const, lufs: -14 };
  const template: Template = {
    schemaVersion: 1,
    id,
    version: 1,
    parentVersion: null,
    createdAt: 1_760_000_000_000 + spec.index,
    origin: { kind: 'manual' },
    canvas: { width: spec.canvas?.width ?? 1080, height: spec.canvas?.height ?? 1920, rate },
    duration: at(total),
    slots,
    beatMap:
      spec.cutsOnBeat === undefined
        ? null
        : {
            rate,
            beats: [at(0)],
            downbeats: [],
            bpm: null,
            beatsPerBar: null,
            confidence: 1,
            source: 'tracker',
          },
    text,
    audio: {
      kind: audio.kind,
      loudnessLufs: audio.lufs,
      sound: null,
      speech: null,
      waveform: audio.peaks ? { rate: FrameRate.of(50), peaks: [...audio.peaks] } : null,
    },
    pacing: {
      shotCount: slots.length,
      meanShot: at(Math.round(total / slots.length)),
      medianShot: at(lengths[Math.floor(lengths.length / 2)] ?? 1),
      shortestShot: at(lengths[0] ?? 1),
      longestShot: at(lengths.at(-1) ?? 1),
      hookEnd: at(Math.min(spec.shots[0] ?? 1, 3 * (spec.fps ?? 30))),
      cutsOnBeat: spec.cutsOnBeat ?? null,
    },
    styleId: null,
    contactSheet: null,
    language: 'en',
  };
  // Synthetic or not, it must be a valid Template v1.
  return templateSchema.parse(template);
}
