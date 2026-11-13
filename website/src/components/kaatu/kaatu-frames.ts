// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Kaatu's eight 3x3 sheets. The first six are the app's (packages/ui/src/brand/kaatu-frames.ts;
 * test/unit/kaatu-parity.test.ts holds them to the same map): head turns, the same turns with the eyes shut, small
 * turns (the in-betweens) around a drowsy face, faces, idle antics, and the playful reactions. The last two are the
 * site's (WEB2 lane L5), drawn with Codex for the Kaatu API's poses: creator poses and story poses. Every frame of
 * every sheet is lined up on the same body (design/mascot/web-atlas.py), so the player can cut between any two.
 * scripts/kaatu-atlas.mjs writes the atlases, 480 px cells, to public/kaatu/.
 */
export const APP_SHEETS = [
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

/** The site's own two sheets: each cell is the Kaatu API pose of the same name (kaatu-poses.ts). */
export const WEB_SHEETS = [
  ['film', 'snip', 'headphones', 'point', 'thumbs-up', 'hold-reel', 'cheer', 'selfie', 'type'],
  ['peek-left', 'peek-up', 'nap', 'carry-strip', 'jump', 'laptop', 'search', 'heart-hands', 'big-wave'],
] as const;

export const SHEETS = [...APP_SHEETS, ...WEB_SHEETS] as const;

/** The sheets' names, in SHEETS order: public/kaatu/kaatu-<name>.webp, and kaatu.css's layers. */
export const SHEET_NAMES = ['directions', 'blinks', 'glances', 'reactions', 'antics', 'tricks', 'web-creator', 'web-story'] as const;

/** The atlases as served, in SHEETS order. */
export const KAATU_SHEETS: readonly string[] = SHEET_NAMES.map((name) => `/kaatu/kaatu-${name}.webp`);

export type KaatuFrame = (typeof SHEETS)[number][number];

/** The nine ways the head can point. */
export type KaatuDirection = (typeof APP_SHEETS)[0][number];

/** One drawing: which sheet, and which of its nine cells (left to right, top to bottom). */
export interface KaatuPlace {
  readonly sheet: number;
  readonly cell: number;
}

const PLACES = new Map<KaatuFrame, KaatuPlace>(
  SHEETS.flatMap((names, sheet) => names.map((name, cell) => [name, { sheet, cell }] as const)),
);

export function locate(frame: KaatuFrame): KaatuPlace {
  return PLACES.get(frame) ?? { sheet: 0, cell: 4 };
}

const TURNED = new Set<string>(APP_SHEETS[0]);

/** Frames whose head can turn (the directions, their blinks and their in-betweens): only these follow a pointer. */
export function turnable(frame: KaatuFrame): boolean {
  return locate(frame).sheet <= 2;
}

/** Where the head points in a frame. Turns, their blinks and their in-betweens point; every face looks out. */
export function facing(frame: KaatuFrame): KaatuDirection {
  if (TURNED.has(frame)) return frame as KaatuDirection;
  const turned = frame.replace(/^(blink|glance)-/, '');
  return TURNED.has(turned) ? (turned as KaatuDirection) : 'center';
}

export function blinkOf(direction: KaatuDirection): KaatuFrame {
  return direction === 'center' ? 'blink' : `blink-${direction}`;
}

function glanceOf(direction: Exclude<KaatuDirection, 'center'>): KaatuFrame {
  return `glance-${direction}`;
}

const AROUND: readonly KaatuDirection[] = ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right'];

function neighbours(a: KaatuDirection, b: KaatuDirection): boolean {
  const gap = Math.abs(AROUND.indexOf(a) - AROUND.indexOf(b));
  return gap === 1 || gap === AROUND.length - 1;
}

/**
 * The in-between frames for a head turn, not counting where it ends. Out from the middle: the small turn first. Back
 * to the middle: the small turn last. Across (left to right): small turn, middle, small turn. Next door needs none.
 */
export function turnPath(from: KaatuDirection, to: KaatuDirection): KaatuFrame[] {
  if (from === to || (from !== 'center' && to !== 'center' && neighbours(from, to))) return [];
  const path: KaatuFrame[] = [];
  if (from !== 'center') path.push(glanceOf(from));
  if (from !== 'center' && to !== 'center') path.push('center');
  if (to !== 'center') path.push(glanceOf(to));
  return path;
}
