// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { MascotDirection, MascotFrame } from '@taalcut-vendor/page-mascot/mascot';
import antics from './kaatu-antics.webp';
import blinks from './kaatu-blinks.webp';
import directions from './kaatu-directions.webp';
import glances from './kaatu-glances.webp';
import reactions from './kaatu-reactions.webp';
import tricks from './kaatu-tricks.webp';

/**
 * Kaatu's six 3x3 sheets (design/mascot/README.md), every frame lined up on the
 * same body so the player can cut between any two. In order: head turns, the same
 * turns with the eyes shut, small turns (the in-betweens) around a drowsy face,
 * faces, idle antics, and the playful reactions a poke gets.
 */
const SHEETS = [
  ['up-left', 'up', 'up-right', 'left', 'center', 'right', 'down-left', 'down', 'down-right'],
  [
    'blink-up-left',
    'blink-up',
    'blink-up-right',
    'blink-left',
    'blink',
    'blink-right',
    'blink-down-left',
    'blink-down',
    'blink-down-right',
  ],
  [
    'glance-up-left',
    'glance-up',
    'glance-up-right',
    'glance-left',
    'drowsy',
    'glance-right',
    'glance-down-left',
    'glance-down',
    'glance-down-right',
  ],
  ['content', 'heart', 'sparkle', 'surprised', 'nibble', 'bashful', 'sleepy', 'dizzy', 'delighted'],
  ['snack', 'chomp', 'chomp-along', 'yawn-start', 'yawn', 'curious', 'wave', 'wave-out', 'cheeky'],
  ['bop-left', 'bop-right', 'laugh', 'peekaboo', 'peek', 'starstruck', 'clapper', 'clap', 'wink'],
] as const;

export const KAATU_SHEETS: readonly string[] = [directions, blinks, glances, reactions, antics, tricks];

/**
 * What Kaatu is doing. `idle` turns its head toward the pointer, blinks, and gets up
 * to an antic now and then; `thinking` looks up-left, nibbles, looks up-right and
 * nibbles again, one beat a second; `happy` grins; `oops` looks bashful (never dizzy:
 * that one is a game, not a failure); `sleep` dozes; `poke` plays a click reaction once.
 */
export type MascotMood = 'idle' | 'thinking' | 'happy' | 'oops' | 'sleep' | 'poke';

export type KaatuFrame = (typeof SHEETS)[number][number];

const PLACES = new Map<KaatuFrame, MascotFrame>(
  SHEETS.flatMap((names, sheet) => names.map((name, cell) => [name, { sheet, cell }] as const)),
);

export function locate(frame: KaatuFrame): MascotFrame {
  return PLACES.get(frame) ?? { sheet: 0, cell: 4 };
}

const TURNED = new Set<string>(SHEETS[0]);

/** Where the head points in a frame. Turns, their blinks and their in-betweens point; every face looks out. */
export function facing(frame: KaatuFrame): MascotDirection {
  if (TURNED.has(frame)) return frame as MascotDirection;
  const turned = frame.replace(/^(blink|glance)-/, '');
  return TURNED.has(turned) ? (turned as MascotDirection) : 'center';
}

/** What a frame is called on the element: the face when it is one, nothing while the head simply turns. */
export function reactionOf(frame: KaatuFrame): string | undefined {
  if (TURNED.has(frame) || frame.startsWith('glance-')) return undefined;
  return frame.startsWith('blink') ? 'blink' : frame;
}

export function blinkOf(direction: MascotDirection): KaatuFrame {
  return direction === 'center' ? 'blink' : `blink-${direction}`;
}

function glanceOf(direction: Exclude<MascotDirection, 'center'>): KaatuFrame {
  return `glance-${direction}`;
}

const AROUND: readonly MascotDirection[] = [
  'right',
  'down-right',
  'down',
  'down-left',
  'left',
  'up-left',
  'up',
  'up-right',
];

function neighbours(a: MascotDirection, b: MascotDirection): boolean {
  const gap = Math.abs(AROUND.indexOf(a) - AROUND.indexOf(b));
  return gap === 1 || gap === AROUND.length - 1;
}

/**
 * The in-between frames for a head turn, not counting where it ends. Out from
 * the middle: the small turn first. Back to the middle: the small turn last. Across
 * (left to right): small turn, middle, small turn. Next door (left to up-left) needs none.
 */
export function turnPath(from: MascotDirection, to: MascotDirection): KaatuFrame[] {
  if (from === to || (from !== 'center' && to !== 'center' && neighbours(from, to))) return [];
  const path: KaatuFrame[] = [];
  if (from !== 'center') path.push(glanceOf(from));
  if (from !== 'center' && to !== 'center') path.push('center');
  if (to !== 'center') path.push(glanceOf(to));
  return path;
}
