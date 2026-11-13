// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { MascotDirection } from '@taalcut-vendor/page-mascot/mascot';
import { blinkOf, type KaatuFrame } from './kaatu-frames';
import type { KaatuMove } from './kaatu-moves';

/** One drawing held for a while, optionally with a body move as it starts. */
export interface Beat {
  frame: KaatuFrame;
  ms: number;
  move?: KaatuMove;
}

export type Clip = readonly Beat[];

/** How long each in-between of a head turn shows: about three frames at 60 Hz. */
export const TURN_MS = 45;

const twice = (clip: Clip): Clip => [...clip, ...clip];

/** A beat of the dance: head to one side, a music note, the body leaning with it. */
const BOP: Clip = [
  { frame: 'bop-left', ms: 320, move: 'sway-left' },
  { frame: 'bop-right', ms: 320, move: 'sway-right' },
];

/**
 * What Kaatu gets up to on its own while nothing is going on, one now and then
 * (DESIGN.md, Mascot). Each is a couple of seconds at most and ends looking out.
 */
export const ANTICS = {
  // A beaver's snack: a log held like a corn cob, chomped along.
  snack: [
    { frame: 'snack', ms: 560 },
    ...twice([
      { frame: 'chomp', ms: 170 },
      { frame: 'chomp-along', ms: 170 },
    ]),
    { frame: 'chomp', ms: 170 },
    { frame: 'chomp-along', ms: 220 },
    { frame: 'snack', ms: 420 },
    { frame: 'content', ms: 360 },
  ],
  yawn: [
    { frame: 'yawn-start', ms: 260 },
    { frame: 'yawn', ms: 900, move: 'stretch' },
    { frame: 'yawn-start', ms: 200 },
    { frame: 'drowsy', ms: 260 },
    { frame: 'blink', ms: 110 },
  ],
  wave: [
    ...twice([
      { frame: 'wave', ms: 190 },
      { frame: 'wave-out', ms: 190 },
    ]),
    { frame: 'wave', ms: 260 },
    { frame: 'content', ms: 320 },
  ],
  wonder: [{ frame: 'curious', ms: 1500 }],
  // Taal is rhythm: Kaatu bobs to a beat only it can hear.
  dance: [...twice(twice(BOP)), { frame: 'content', ms: 320 }],
  cheeky: [{ frame: 'cheeky', ms: 1000 }],
  wink: [{ frame: 'wink', ms: 800 }],
  // "Action!": the clapperboard, because Taalcut makes videos.
  action: [
    { frame: 'clapper', ms: 420 },
    { frame: 'clap', ms: 160 },
    { frame: 'clapper', ms: 220 },
    { frame: 'clap', ms: 460 },
  ],
  look: [
    { frame: 'glance-left', ms: 45 },
    { frame: 'left', ms: 560 },
    { frame: 'glance-left', ms: 45 },
    { frame: 'center', ms: 60 },
    { frame: 'glance-right', ms: 45 },
    { frame: 'right', ms: 560 },
    { frame: 'glance-up-right', ms: 45 },
    { frame: 'up-right', ms: 420 },
    { frame: 'glance-up-right', ms: 45 },
  ],
} satisfies Record<string, Clip>;

export type KaatuAntic = keyof typeof ANTICS;
export const ANTIC_NAMES = Object.keys(ANTICS) as KaatuAntic[];

/**
 * A poke's reactions, in turn: always a heart first, then round the rest. The
 * hop that goes with each is the player's, so none starts with a move of its own.
 */
export const POKES: readonly Clip[] = [
  [
    { frame: 'content', ms: 90 },
    { frame: 'heart', ms: 720 },
  ],
  [
    { frame: 'surprised', ms: 90 },
    { frame: 'laugh', ms: 760 },
  ],
  [
    { frame: 'peekaboo', ms: 560 },
    { frame: 'peek', ms: 480 },
    { frame: 'content', ms: 220 },
  ],
  [
    { frame: 'surprised', ms: 90 },
    { frame: 'starstruck', ms: 780 },
  ],
  [
    { frame: 'wave', ms: 170 },
    { frame: 'wave-out', ms: 170 },
    { frame: 'wave', ms: 170 },
    { frame: 'wave-out', ms: 170 },
    { frame: 'wave', ms: 220 },
  ],
  [
    { frame: 'content', ms: 90 },
    { frame: 'sparkle', ms: 720 },
  ],
  [
    { frame: 'clapper', ms: 280 },
    { frame: 'clap', ms: 150 },
    { frame: 'clapper', ms: 200 },
    { frame: 'clap', ms: 380 },
  ],
  [{ frame: 'wink', ms: 720 }],
];

/** Under reduced motion a poke is one face, which the base layer crossfades in: no flicker of frames. */
export const CALM_POKES: readonly Clip[] = (['heart', 'laugh', 'starstruck', 'sparkle'] as const).map(
  (frame) => [{ frame, ms: 900 }],
);

/** Four quick pokes: dizzy, and a wobble that dies away. */
export const DIZZY: Clip = [{ frame: 'dizzy', ms: 1100, move: 'wobble' }];

/** Nodding off, from idle into sleep. */
export const DOZE: Clip = [
  { frame: 'drowsy', ms: 520 },
  { frame: 'blink', ms: 280 },
  { frame: 'drowsy', ms: 460 },
  { frame: 'blink', ms: 380, move: 'nod' },
];

/** Waking up: a yawn and a stretch. */
export const WAKE: Clip = [
  { frame: 'drowsy', ms: 180 },
  { frame: 'yawn-start', ms: 220 },
  { frame: 'yawn', ms: 820, move: 'stretch' },
  { frame: 'yawn-start', ms: 160 },
  { frame: 'blink', ms: 110 },
];

/** A pointer resting on Kaatu: it goes shy. */
export const SHY: Clip = [
  { frame: 'content', ms: 140 },
  { frame: 'bashful', ms: 1500 },
];

/** One look while thinking, a beat each: up to one side, a nibble, up the other way, a nibble. */
export const THINKING: readonly KaatuFrame[] = ['up-left', 'nibble', 'up-right', 'nibble'];

/**
 * A blink wherever Kaatu is looking. Straight on, it passes through the drowsy
 * half-shut eyes both ways; sometimes it blinks twice.
 */
export function blinkClip(direction: MascotDirection, smooth: boolean, double: boolean): Clip {
  const shut = blinkOf(direction);
  const once: Clip =
    smooth && direction === 'center'
      ? [
          { frame: 'drowsy', ms: 40 },
          { frame: shut, ms: 80 },
          { frame: 'drowsy', ms: 40 },
        ]
      : [{ frame: shut, ms: 120 }];
  return double ? [...once, { frame: direction, ms: 110 }, ...once] : once;
}
