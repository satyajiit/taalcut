// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Kaatu's body moves: transforms on the stage that holds the drawing, scaled from its seat, played with the Web
 * Animations API so they never touch React state. Each keyframe carries its own easing and the effect itself runs
 * linear. `MOVES` is the app's set (packages/ui/src/brand/kaatu-moves.ts), held to the same timings by
 * test/unit/kaatu-parity.test.ts; `WEB_MOVES` are the site's, one or two per pose (kaatu-poses.ts). Kaatu is
 * DESIGN.md's one exception to "no bounce".
 */
export type AppMove = 'hop' | 'boop' | 'sway-left' | 'sway-right' | 'wobble' | 'stretch' | 'nod' | 'droop';
export type WebMove =
  | 'squeeze'
  | 'lean'
  | 'present'
  | 'tilt'
  | 'tap'
  | 'pulse'
  | 'jump'
  | 'march-left'
  | 'march-right'
  | 'scan-left'
  | 'scan-right'
  | 'waggle';
export type KaatuMove = AppMove | WebMove;

const OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const IN = 'cubic-bezier(0.32, 0, 0.67, 0)';
const IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)';

interface Pose {
  /** Sideways and up, as a share of Kaatu's size in percent. */
  readonly x?: number;
  readonly y?: number;
  /** Degrees, clockwise. */
  readonly turn?: number;
  /** Width and height, 1 as drawn. */
  readonly w?: number;
  readonly h?: number;
}

/** One keyframe: a pose, and the easing toward the next. */
function pose({ x = 0, y = 0, turn = 0, w = 1, h = 1 }: Pose, easing?: string, offset?: number): Keyframe {
  return {
    transform: `translate(${x}%, ${y}%) rotate(${turn}deg) scale(${w}, ${h})`,
    ...(easing ? { easing } : {}),
    ...(offset === undefined ? {} : { offset }),
  };
}

export interface Move {
  readonly frames: Keyframe[];
  readonly ms: number;
}

export const MOVES: Readonly<Record<AppMove, Move>> = {
  // Crouch, spring up tall, land squashed, settle: the poke's main beat.
  hop: {
    ms: 520,
    frames: [
      pose({}, IN),
      pose({ w: 1.08, h: 0.9 }, OUT, 0.16),
      pose({ y: -14, w: 0.95, h: 1.07 }, IN, 0.46),
      pose({ w: 1.07, h: 0.92 }, OUT, 0.72),
      pose({}),
    ],
  },
  // A small squash and settle, for a quick second poke.
  boop: {
    ms: 280,
    frames: [pose({}, IN), pose({ w: 1.06, h: 0.93 }, OUT, 0.35), pose({})],
  },
  // One beat of a dance, leaning with a little dip on the beat.
  'sway-left': {
    ms: 300,
    frames: [pose({}, OUT), pose({ x: -2, turn: -4, w: 1.03, h: 0.96 }, IN_OUT, 0.35), pose({})],
  },
  'sway-right': {
    ms: 300,
    frames: [pose({}, OUT), pose({ x: 2, turn: 4, w: 1.03, h: 0.96 }, IN_OUT, 0.35), pose({})],
  },
  // Dizzy: a wobble that dies away.
  wobble: {
    ms: 1000,
    frames: [
      pose({}, IN_OUT),
      pose({ turn: -9 }, IN_OUT, 0.15),
      pose({ turn: 8 }, IN_OUT, 0.33),
      pose({ turn: -6 }, IN_OUT, 0.5),
      pose({ turn: 4 }, IN_OUT, 0.67),
      pose({ turn: -2 }, IN_OUT, 0.84),
      pose({}),
    ],
  },
  // The big yawn: taller, then back down.
  stretch: {
    ms: 900,
    frames: [pose({}, OUT), pose({ w: 0.97, h: 1.06 }, IN_OUT, 0.4), pose({ w: 0.97, h: 1.06 }, IN_OUT, 0.65), pose({})],
  },
  // Nodding off.
  nod: {
    ms: 700,
    frames: [pose({}, IN_OUT), pose({ y: 3, turn: 2 }, IN_OUT, 0.55), pose({})],
  },
  // Something went wrong: shrink a little, then sit back up.
  droop: {
    ms: 900,
    frames: [pose({}, OUT), pose({ y: 2, w: 1.03, h: 0.95 }, IN_OUT, 0.3), pose({ y: 2, w: 1.03, h: 0.95 }, IN_OUT, 0.7), pose({})],
  },
};

export const WEB_MOVES: Readonly<Record<WebMove, Move>> = {
  // A snip of the scissors: a quick squeeze in and out.
  squeeze: {
    ms: 240,
    frames: [pose({}, IN), pose({ w: 1.04, h: 0.96, turn: -2 }, OUT, 0.4), pose({})],
  },
  // Leaning toward what it points at, then back.
  lean: {
    ms: 700,
    frames: [pose({}, OUT), pose({ x: 4, turn: 5 }, IN_OUT, 0.4), pose({ x: 4, turn: 5 }, IN_OUT, 0.7), pose({})],
  },
  // Holding something up for you to see: up on its toes, then down.
  present: {
    ms: 640,
    frames: [pose({}, OUT), pose({ y: -5, w: 0.98, h: 1.04 }, IN_OUT, 0.35), pose({ y: -5, w: 0.98, h: 1.04 }, IN_OUT, 0.6), pose({})],
  },
  // A head tilt for the camera.
  tilt: {
    ms: 520,
    frames: [pose({}, OUT), pose({ turn: -6 }, IN_OUT, 0.45), pose({})],
  },
  // Typing: a tiny bounce per key.
  tap: {
    ms: 140,
    frames: [pose({}, IN), pose({ y: 1, w: 1.02, h: 0.98 }, OUT, 0.4), pose({})],
  },
  // Heart hands: a soft swell.
  pulse: {
    ms: 520,
    frames: [pose({}, OUT), pose({ w: 1.06, h: 1.06 }, IN_OUT, 0.35), pose({})],
  },
  // A star jump: a deeper crouch and a higher leap than the hop.
  jump: {
    ms: 620,
    frames: [
      pose({}, IN),
      pose({ w: 1.1, h: 0.86 }, OUT, 0.18),
      pose({ y: -22, w: 0.94, h: 1.09 }, IN, 0.5),
      pose({ w: 1.08, h: 0.9 }, OUT, 0.76),
      pose({}),
    ],
  },
  // Carrying the strip: a step one way, a step the other.
  'march-left': {
    ms: 360,
    frames: [pose({}, OUT), pose({ x: -1.5, y: -2, turn: -3 }, IN_OUT, 0.4), pose({})],
  },
  'march-right': {
    ms: 360,
    frames: [pose({}, OUT), pose({ x: 1.5, y: -2, turn: 3 }, IN_OUT, 0.4), pose({})],
  },
  // Searching: leaning one way, then the other.
  'scan-left': {
    ms: 420,
    frames: [pose({}, OUT), pose({ x: -3, turn: -4 }, IN_OUT, 0.5), pose({})],
  },
  'scan-right': {
    ms: 420,
    frames: [pose({}, OUT), pose({ x: 3, turn: 4 }, IN_OUT, 0.5), pose({})],
  },
  // A big wave: the whole body rocks with the arm.
  waggle: {
    ms: 340,
    frames: [pose({}, IN_OUT), pose({ turn: 4 }, IN_OUT, 0.3), pose({ turn: -3 }, IN_OUT, 0.7), pose({})],
  },
};

export function moveOf(move: KaatuMove): Move {
  return (MOVES as Record<string, Move>)[move] ?? (WEB_MOVES as Record<string, Move>)[move] ?? MOVES.boop;
}

/** Plays a move on the stage, replacing one still going. Without Element.animate nothing moves. */
export function playMove(stage: HTMLElement | null, move: KaatuMove): void {
  if (!stage || typeof stage.animate !== 'function') return;
  for (const running of stage.getAnimations?.() ?? []) running.cancel();
  const { frames, ms } = moveOf(move);
  stage.animate(frames, { duration: ms, easing: 'linear' });
}
