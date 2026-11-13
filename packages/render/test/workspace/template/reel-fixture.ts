// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A made-up reel's template for HFW1 tpl's tests (the owner's case, with made-up words): a 9:16 reel at 30 fps,
 * beats every half second, two shots, a one-line incoming message (white, tail left) that pops in on a beat, and a
 * one-line reply with read ticks (green, tail right) that pops in a beat later, both read by the breakdown. Plus a
 * shop sign the reading calls footage and words on the picture, which get no composition.
 */
import {
  FrameRates,
  newId,
  RationalTime,
  templateSchema,
  type GraphicBrief,
  type OverlayDesign,
  type SlotId,
  type Template,
  type TextOverlay,
} from '@taalcut/core';

const rate = FrameRates.fps30;
const at = (frames: number) => RationalTime.of(frames, rate);
const BEAT_RATE = { num: 1000, den: 1 };

export const QUESTION_WORDS = 'Made-up question here?';
export const REPLY_WORDS = 'Sounds good to me';

const bubble = (side: 'left' | 'right'): OverlayDesign => ({
  kind: 'chatBubble',
  colors: { fill: side === 'left' ? '#ffffff' : '#d9fdd3', text: '#111111', stroke: null },
  cornerRadius: 0.36,
  tail: side,
  font: { class: 'sans', weight: 400 },
  motion: { enter: 'pop', exit: 'none', typing: false },
  ...(side === 'left'
    ? { shape: { x: 0.06, y: 0.38, width: 0.43, height: 0.045 } }
    : { shape: { x: 0.52, y: 0.46, width: 0.42, height: 0.045 }, receipt: true }),
  confidence: 0.9,
});

function overlay(
  text: string,
  start: number,
  frames: number,
  slotId: SlotId,
  box: TextOverlay['box'],
  design?: OverlayDesign,
): TextOverlay {
  return {
    id: newId<'TextOverlay'>(),
    text,
    role: 'caption',
    start: at(start),
    duration: at(frames),
    slotId,
    box,
    appearance: { size: 0.014, align: 'left', case: 'mixed', background: design ? 'box' : 'none' },
    styleKey: 'caption',
    reveal: 'none',
    ...(design ? { design } : {}),
    language: 'en',
    confidence: 0.9,
  };
}

const brief = (overlayId: TextOverlay['id'], kind: GraphicBrief['kind'], graphic = true): GraphicBrief => ({
  overlayId,
  graphic,
  reason: graphic ? null : 'A made-up shop sign in the shot.',
  kind,
  what: graphic ? 'A made-up message in a thread' : 'A sign',
  role: kind === 'outgoingMessage' ? 'answer' : 'question',
  answers: null,
  look: {
    words: 'A rounded bubble like a phone thread.',
    platform: 'whatsapp',
    shadow: false,
    avatar: false,
  },
  motion: { words: 'Pops in on the beat; cuts out with the shot.', typingSeconds: null },
  timing: { cue: 'beat', words: 'On the beat.' },
  people: { words: 'Beside the person, on the open side.' },
  source: 'model',
  confidence: 0.8,
});

/** The made-up reel's template; `question` and `reply` are its two messages. */
export function madeUpReel() {
  const slots = [newId<'TemplateSlot'>() as SlotId, newId<'TemplateSlot'>() as SlotId];
  const question = overlay(
    QUESTION_WORDS,
    30,
    90,
    slots[0]!,
    { x: 0.1, y: 0.392, width: 0.34, height: 0.02 },
    bubble('left'),
  );
  const reply = overlay(
    REPLY_WORDS,
    60,
    75,
    slots[1]!,
    { x: 0.56, y: 0.472, width: 0.27, height: 0.02 },
    bubble('right'),
  );
  const sign = overlay(
    'MADE-UP SHOP',
    10,
    120,
    slots[0]!,
    { x: 0.3, y: 0.1, width: 0.4, height: 0.04 },
    {
      ...bubble('left'),
      tail: 'none',
      kind: 'label',
    },
  );
  const words = overlay('Plain made-up words', 90, 45, slots[1]!, {
    x: 0.2,
    y: 0.8,
    width: 0.6,
    height: 0.03,
  });
  const beats = Array.from({ length: 11 }, (_, index) => index * 15);
  const template = templateSchema.parse({
    schemaVersion: 1,
    id: newId<'Template'>(),
    version: 1,
    parentVersion: null,
    createdAt: 0,
    origin: { kind: 'manual' },
    canvas: { width: 1080, height: 1920, rate },
    duration: at(150),
    slots: slots.map((id, index) => ({
      id,
      name: null,
      role: index === 0 ? 'hook' : 'outro',
      start: at(index * 60),
      duration: at(index === 0 ? 60 : 90),
      intent: {
        text: `made-up shot ${index}`,
        shotType: null,
        motion: null,
        subject: null,
        people: 1,
        place: null,
        energy: 0.5,
        source: 'analyst',
      },
      beatAnchor: { beatIndex: index * 4, offset: at(0) },
      transitionIn: null,
      speedRamp: null,
      cut: { method: 'both', confidence: 1 },
      approved: false,
      frame: null,
    })),
    beatMap: {
      rate: BEAT_RATE,
      beats: beats.map((frame) => RationalTime.rescale(at(frame), BEAT_RATE, 'round')),
      downbeats: [0, 4, 8],
      bpm: 120,
      beatsPerBar: 4,
      confidence: 1,
      source: 'tracker',
    },
    text: [sign, question, reply, words],
    audio: { kind: 'music', loudnessLufs: -14, sound: null, speech: null, waveform: null },
    pacing: {
      shotCount: 2,
      meanShot: at(75),
      medianShot: at(90),
      shortestShot: at(60),
      longestShot: at(90),
      hookEnd: at(60),
      cutsOnBeat: 1,
    },
    styleId: null,
    contactSheet: null,
    language: null,
    graphics: {
      uses: [],
      reading: {
        version: 1,
        prompt: 'graphic-brief/1',
        model: null,
        briefs: [
          brief(sign.id, 'label', false),
          brief(question.id, 'incomingMessage'),
          brief(reply.id, 'outgoingMessage'),
        ],
        system: {
          tokens: {
            platform: 'whatsapp',
            fills: ['#ffffff', '#d9fdd3'],
            text: ['#111111'],
            cornerRadius: 0.36,
            font: { class: 'sans', weight: 400 },
          },
          conversation: [
            { overlayId: question.id, side: 'left', speaker: 'them' },
            { overlayId: reply.id, side: 'right', speaker: 'me' },
          ],
          stack: { direction: 'down', gap: 0.035 },
          words: 'A made-up phone thread: theirs on the left, mine on the right.',
        },
      },
    },
  }) as Template;
  return { template, question, reply, sign, words };
}
