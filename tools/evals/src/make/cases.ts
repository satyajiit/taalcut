// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH: eval:make's made-up reels. Each is a template as a reading leaves it (slots with their intent, needs,
 * face and camera move; where the reel's person stands; its chat bubbles) and the first draft's picks from the
 * made-up library (footage.ts), wrong where a first cast goes wrong: a shot that misses the need, a face where the
 * reel hides it, a move of another kind, a bubble out of place, a need no shot shows (that slot gets a reason). The
 * words are made up and generic.
 */
import {
  RationalTime,
  templateSchema,
  type CameraMotion,
  type OverlayDesign,
  type SlotId,
  type Template,
  type TextOverlay,
} from '@taalcut/core';
import { fixedId } from '../edit/ids';
import { FPS } from './footage';

export interface MakeSlotDef {
  readonly seconds: number;
  readonly text: string;
  readonly needs?: readonly string[];
  readonly face?: 'shown' | 'hidden';
  readonly motion?: CameraMotion;
  /** Where the reel's person's head is through the slot (shares of the frame); none: nobody shows. */
  readonly head?: { x: number; y: number; width: number; height: number };
}

export interface MakeBubbleDef {
  readonly slot: number;
  readonly words: string;
  readonly side: 'left' | 'right';
  /** Where the reel draws it (its shape, shares of the frame). */
  readonly shape: { x: number; y: number; width: number; height: number };
}

export interface MakeCase {
  readonly id: string;
  readonly slots: readonly MakeSlotDef[];
  readonly bubbles: readonly MakeBubbleDef[];
  /** The first draft: each slot's shot (footage.ts key) and its in-point in seconds. */
  readonly picks: readonly { readonly shot: string; readonly from: number }[];
  /** Each slot's alternates in the first cast. */
  readonly alternates: readonly (readonly string[])[];
  /** Where the first draft puts each bubble (shares of the frame); null: the draft has none. */
  readonly drawn: readonly ({ x: number; y: number; width: number; height: number } | null)[];
  /** Slots (numbers, from 1) no shot of the library can match: the right finish gives each a reason. */
  readonly unmatchable?: readonly number[];
}

export const MAKE_CASES: readonly MakeCase[] = [
  {
    id: 'phone-hook',
    slots: [
      {
        seconds: 2,
        text: 'Someone reads a message on their phone, their face kept out of frame',
        needs: ['someone looking at a phone'],
        face: 'hidden',
        motion: 'static',
        head: { x: 0.16, y: 0.26, width: 0.2, height: 0.12 },
      },
      { seconds: 2, text: 'A warm drink on a table', needs: ['a cup of coffee'], motion: 'static' },
      {
        seconds: 2,
        text: 'Someone heads out along a path',
        motion: 'tracking',
        head: { x: 0.4, y: 0.2, width: 0.2, height: 0.12 },
      },
    ],
    bubbles: [
      {
        slot: 0,
        words: 'Are you coming tonight?',
        side: 'left',
        shape: { x: 0.06, y: 0.56, width: 0.5, height: 0.05 },
      },
    ],
    picks: [
      { shot: 'street', from: 1 },
      { shot: 'coffee', from: 1 },
      { shot: 'beach', from: 1 },
    ],
    alternates: [['phone', 'laugh'], ['keys'], ['run', 'street']],
    drawn: [{ x: 0.46, y: 0.06, width: 0.5, height: 0.05 }],
  },
  {
    id: 'morning-chat',
    slots: [
      {
        seconds: 2,
        text: 'A drink on a table as the day starts',
        needs: ['a cup of coffee'],
        motion: 'static',
      },
      {
        seconds: 2.5,
        text: 'Someone laughs at the camera',
        face: 'shown',
        motion: 'handheld',
        head: { x: 0.4, y: 0.2, width: 0.2, height: 0.12 },
      },
      { seconds: 2, text: 'Keys picked up on the way out', needs: ['keys'], motion: 'static' },
    ],
    bubbles: [
      {
        slot: 1,
        words: 'Coffee first?',
        side: 'left',
        shape: { x: 0.06, y: 0.6, width: 0.38, height: 0.05 },
      },
      { slot: 2, words: 'Always', side: 'right', shape: { x: 0.6, y: 0.66, width: 0.3, height: 0.05 } },
    ],
    picks: [
      { shot: 'beach', from: 1 },
      { shot: 'phone', from: 5 },
      { shot: 'keys', from: 1 },
    ],
    alternates: [['coffee', 'bus'], ['laugh', 'street'], ['bus']],
    drawn: [{ x: 0.06, y: 0.6, width: 0.38, height: 0.05 }, null],
  },
  {
    id: 'beach-run',
    slots: [
      { seconds: 2, text: 'A dog runs along the sand', needs: ['a dog running on sand'], motion: 'pan' },
      { seconds: 2, text: 'A bus goes by in the rain', needs: ['a bus'], motion: 'pan' },
      {
        seconds: 2.5,
        text: 'Someone runs by the river, their face to the camera',
        face: 'shown',
        motion: 'tracking',
        head: { x: 0.4, y: 0.2, width: 0.2, height: 0.12 },
      },
    ],
    bubbles: [
      { slot: 2, words: 'On my way', side: 'right', shape: { x: 0.56, y: 0.64, width: 0.34, height: 0.05 } },
    ],
    picks: [
      { shot: 'beach', from: 1 },
      { shot: 'street', from: 2 },
      { shot: 'run', from: 1 },
    ],
    alternates: [['coffee'], ['laugh', 'bus'], ['street']],
    drawn: [{ x: 0.56, y: 0.64, width: 0.34, height: 0.05 }],
    unmatchable: [1],
  },
];

const at = (seconds: number) => RationalTime.fromSeconds(seconds, FPS, 'round');

function bubbleDesign(side: 'left' | 'right', shape: MakeBubbleDef['shape']): OverlayDesign {
  return {
    kind: 'chatBubble',
    colors: { fill: side === 'left' ? '#ffffff' : '#d9fdd3', text: '#111111', stroke: null },
    cornerRadius: 0.36,
    tail: side,
    font: { class: 'sans', weight: 400 },
    motion: { enter: 'pop', exit: 'none', typing: false },
    shape,
    confidence: 0.9,
  };
}

/** The case's template: its slots back to back from 0, its reel subjects at 4 Hz, its bubbles in their slots. */
export function caseTemplate(made: MakeCase): Template {
  const ids = made.slots.map((_, index) => fixedId<'TemplateSlot'>('01K9MT', index + 1) as SlotId);
  const starts = made.slots.map((_, index) =>
    made.slots.slice(0, index).reduce((sum, slot) => sum + slot.seconds, 0),
  );
  const total = made.slots.reduce((sum, slot) => sum + slot.seconds, 0);
  const text: TextOverlay[] = made.bubbles.map((bubble, index) => {
    const start = starts[bubble.slot]! + 0.2;
    const { shape } = bubble;
    return {
      id: fixedId<'TextOverlay'>('01K9MQ', index + 1),
      text: bubble.words,
      role: 'caption',
      start: at(start),
      duration: at(made.slots[bubble.slot]!.seconds - 0.4),
      slotId: ids[bubble.slot]!,
      box: { x: shape.x + 0.04, y: shape.y + 0.012, width: shape.width - 0.08, height: shape.height - 0.024 },
      appearance: { size: 0.016, align: 'left', case: 'mixed', background: 'box' },
      styleKey: 'caption',
      reveal: 'none',
      design: bubbleDesign(bubble.side, shape),
      language: 'en',
      confidence: 0.9,
    };
  });
  const samples = made.slots.flatMap((slot, index) =>
    Array.from({ length: Math.round(slot.seconds * 4) }, (_, k) => ({
      t: at(starts[index]! + k / 4),
      heads: slot.head ? [{ box: slot.head, confidence: 0.9 }] : [],
      people: [],
    })),
  );
  return templateSchema.parse({
    schemaVersion: 1,
    id: fixedId<'Template'>('01K9MP', MAKE_CASES.indexOf(made) + 1),
    version: 1,
    parentVersion: null,
    createdAt: 0,
    origin: { kind: 'manual' },
    canvas: { width: 1080, height: 1920, rate: FPS },
    duration: at(total),
    slots: made.slots.map((slot, index) => ({
      id: ids[index],
      name: null,
      role: index === 0 ? 'hook' : index === made.slots.length - 1 ? 'outro' : 'body',
      start: at(starts[index]!),
      duration: at(slot.seconds),
      intent: {
        text: slot.text,
        shotType: null,
        motion: slot.motion ?? null,
        subject: null,
        people: slot.head ? 1 : 0,
        place: null,
        energy: 0.5,
        source: 'analyst',
        ...(slot.needs ? { needs: [...slot.needs] } : {}),
        ...(slot.face ? { face: slot.face } : {}),
      },
      beatAnchor: null,
      transitionIn: null,
      speedRamp: null,
      cut: { method: 'both', confidence: 1 },
      approved: false,
      frame: null,
    })),
    beatMap: null,
    text,
    audio: { kind: 'music', loudnessLufs: -14, sound: null, speech: null, waveform: null },
    pacing: {
      shotCount: made.slots.length,
      meanShot: at(total / made.slots.length),
      medianShot: at(total / made.slots.length),
      shortestShot: at(Math.min(...made.slots.map((slot) => slot.seconds))),
      longestShot: at(Math.max(...made.slots.map((slot) => slot.seconds))),
      hookEnd: at(made.slots[0]!.seconds),
      cutsOnBeat: 0,
    },
    styleId: null,
    contactSheet: null,
    language: 'en',
    subjects: { version: 1, detector: 'vision', hz: 4, samples },
  });
}
