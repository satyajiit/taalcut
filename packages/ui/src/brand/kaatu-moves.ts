// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Kaatu's body moves: transforms on the stage that holds the drawing, scaled from
 * its seat (the stage's transform origin), played with the Web Animations API so
 * they never touch React state. Each keyframe carries its own easing and the effect
 * itself runs linear: an easing on the effect would reinterpret every offset.
 * The mascot is DESIGN.md's one exception to "no bounce" (DESIGN.md, Mascot).
 */
export type KaatuMove = 'hop' | 'boop' | 'sway-left' | 'sway-right' | 'wobble' | 'stretch' | 'nod' | 'droop';

const OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const IN = 'cubic-bezier(0.32, 0, 0.67, 0)';
const IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)';

interface Pose {
  /** Sideways and up, as a share of Kaatu's size in percent. */
  x?: number;
  y?: number;
  /** Degrees, clockwise. */
  turn?: number;
  /** Width and height, 1 as drawn. */
  w?: number;
  h?: number;
}

/** One keyframe: a pose, and the easing toward the next. */
function pose({ x = 0, y = 0, turn = 0, w = 1, h = 1 }: Pose, easing?: string, offset?: number): Keyframe {
  return {
    // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS transform, never UI copy
    transform: `translate(${x}%, ${y}%) rotate(${turn}deg) scale(${w}, ${h})`,
    ...(easing ? { easing } : {}),
    ...(offset === undefined ? {} : { offset }),
  };
}

const MOVES: Record<KaatuMove, { frames: Keyframe[]; ms: number }> = {
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
    frames: [
      pose({}, OUT),
      pose({ w: 0.97, h: 1.06 }, IN_OUT, 0.4),
      pose({ w: 0.97, h: 1.06 }, IN_OUT, 0.65),
      pose({}),
    ],
  },
  // Nodding off.
  nod: {
    ms: 700,
    frames: [pose({}, IN_OUT), pose({ y: 3, turn: 2 }, IN_OUT, 0.55), pose({})],
  },
  // A run failed: shrink a little, then sit back up.
  droop: {
    ms: 900,
    frames: [
      pose({}, OUT),
      pose({ y: 2, w: 1.03, h: 0.95 }, IN_OUT, 0.3),
      pose({ y: 2, w: 1.03, h: 0.95 }, IN_OUT, 0.7),
      pose({}),
    ],
  },
};

/** Plays a move on the stage, replacing one still going. jsdom has no Element.animate: then nothing moves. */
export function playMove(stage: HTMLElement | null, move: KaatuMove): void {
  if (!stage || typeof stage.animate !== 'function') return;
  for (const running of stage.getAnimations?.() ?? []) running.cancel();
  const { frames, ms } = MOVES[move];
  stage.animate(frames, { duration: ms, easing: 'linear' });
}
