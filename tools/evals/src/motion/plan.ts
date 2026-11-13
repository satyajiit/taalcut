// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The camera-motion eval set's plan (FRM1-MOT): every clip's move, camera path, subjects, size and split, from a
 * seeded generator, so the set rebuilds the same. A clip's label is the move it was made with; its numbers are the
 * path it was made with. Units are the final frame's: pan in frame widths a second (positive: the camera pans
 * right), tilt in frame heights a second (positive: down), zoom in log-scale a second (positive: pushes in).
 *
 * Nineteen clips per background photo: still, three with moving subjects in a still frame, two pans, a tilt, a
 * push-in, a pull-out, handheld, tracking (the frame follows a walking subject), tracking forward (the camera walks
 * behind the subject), two pans held by hand, a slow walk behind someone (the far background barely grows, the
 * walker drifts), a person standing in a still frame, a vlog held by hand, a hand's slow wander (under 1.5% of the
 * frame over the shot) and a stabilised phone's sway, both handheld. Durations are those of reel shots:
 * 0.8, 1.5 and 3 s.
 */
import type { CameraMotion } from '@taalcut/core';
import type { Split } from './sources';

export const MOVES = [
  'static',
  'staticSubject',
  'pan',
  'tilt',
  'pushIn',
  'pullOut',
  'handheld',
  'tracking',
  'trackForward',
  'panHandheld',
  'followWalk',
  'standing',
  'handheldPerson',
  'drift',
  'gimbal',
] as const;
export type Move = (typeof MOVES)[number];
export type Aspect = '16:9' | '9:16';
export type Speed = 'slow' | 'medium' | 'fast';

export const MOVE_LABEL: Readonly<Record<Move, CameraMotion>> = {
  static: 'static',
  staticSubject: 'static',
  pan: 'pan',
  tilt: 'tilt',
  pushIn: 'push-in',
  pullOut: 'pull-out',
  handheld: 'handheld',
  tracking: 'tracking',
  trackForward: 'tracking',
  panHandheld: 'pan',
  followWalk: 'tracking',
  standing: 'static',
  handheldPerson: 'handheld',
  drift: 'handheld',
  gimbal: 'handheld',
};

/** A sum of sines per axis: hand shake, as a share of the frame (position) and in degrees (roll). */
export interface Shake {
  /** Root-mean-square offset, as a share of the frame's width. */
  readonly rms: number;
  /** Root-mean-square roll in degrees. */
  readonly rollDegrees: number;
  /** Frequencies (Hz) and phases (radians), one list per axis. */
  readonly x: readonly (readonly [number, number])[];
  readonly y: readonly (readonly [number, number])[];
  readonly roll: readonly (readonly [number, number])[];
}

export interface CameraPath {
  /** Frame widths a second, positive right. */
  readonly pan: number;
  /** Frame heights a second, positive down. */
  readonly tilt: number;
  /** Log-scale a second, positive in. */
  readonly zoom: number;
  /** The move eases in over its first 0.3 s, as a person starts a pan. */
  readonly ease: boolean;
  readonly shake: Shake | null;
}

export interface SubjectPath {
  /** Which subject sprite. */
  readonly sprite: number;
  /** Height as a share of the frame's height. */
  readonly height: number;
  /** Centre at t = 0, as shares of the frame. */
  readonly x: number;
  readonly y: number;
  /** Frame widths and heights a second. */
  readonly vx: number;
  readonly vy: number;
  /** A walk's bob: share of the frame height, and Hz. */
  readonly bob: number;
  readonly bobHz: number;
  /** Slow wander round the centre (tracking: the operator's framing), share of the frame width. */
  readonly wander: number;
}

export interface ClipPlan {
  readonly id: string;
  readonly split: Split;
  readonly background: string;
  readonly aspect: Aspect;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly seconds: number;
  readonly move: Move;
  readonly label: CameraMotion;
  readonly speed: Speed | null;
  readonly camera: CameraPath;
  readonly subjects: readonly SubjectPath[];
  /** FFmpeg `noise` strength (0: none), as a camera's sensor adds. */
  readonly noise: number;
  /** A pan or tilt that moves the frame at least 3% along its axis, with no shake on top. */
  readonly clear: boolean;
}

/** mulberry32: small and seedable, so the plan is the same on every machine. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;
const between = (rng: Rng, low: number, high: number) => low + (high - low) * rng();
const sign = (rng: Rng) => (rng() < 0.5 ? -1 : 1);

const PAN_SPEED: Record<Speed, number> = { slow: 0.07, medium: 0.18, fast: 0.4 };
const TILT_SPEED: Record<Speed, number> = { slow: 0.07, medium: 0.15, fast: 0.3 };
const ZOOM_SPEED: Record<Speed, number> = { slow: 0.08, medium: 0.18, fast: 0.35 };
const SHAKE: Record<'gimbal' | 'light' | 'medium' | 'strong', { rms: number; roll: number }> = {
  /** A phone on a gimbal or with stabilisation on: a slow sway left of the hand. */
  gimbal: { rms: 0.0012, roll: 0.04 },
  light: { rms: 0.003, roll: 0.1 },
  medium: { rms: 0.006, roll: 0.25 },
  strong: { rms: 0.012, roll: 0.5 },
};

/** Hand shake: 0.6–5 Hz, most of it under 2 Hz, as a person holding a phone. */
function shakeOf(rng: Rng, level: keyof typeof SHAKE): Shake {
  const freqs = () =>
    [between(rng, 0.6, 1.2), between(rng, 1.4, 2.4), between(rng, 2.8, 4.8)].map(
      (hz) => [hz, between(rng, 0, 2 * Math.PI)] as const,
    );
  return { rms: SHAKE[level].rms, rollDegrees: SHAKE[level].roll, x: freqs(), y: freqs(), roll: freqs() };
}

const NO_MOVE: CameraPath = { pan: 0, tilt: 0, zoom: 0, ease: false, shake: null };

/** A subject crossing a still frame: from off one side, at walking speed for its size. */
function crossing(rng: Rng, sprite: number, height: number, seconds: number): SubjectPath {
  const direction = sign(rng);
  const speed = between(rng, 0.12, 0.5);
  const travel = speed * seconds;
  const x = direction > 0 ? between(rng, 0.15, 0.85 - travel * 0.6) : between(rng, 0.15 + travel * 0.6, 0.85);
  return {
    sprite,
    height,
    x,
    y: between(rng, 0.98 - height / 2 - 0.05, 0.98 - height / 2),
    vx: direction * speed,
    vy: between(rng, -0.03, 0.03),
    bob: height * 0.02,
    bobHz: between(rng, 1.6, 2.2),
    wander: 0,
  };
}

/** A subject the frame follows: near the centre, wandering a little as an operator's framing does. */
function followed(rng: Rng, sprite: number, height: number): SubjectPath {
  return {
    sprite,
    height,
    x: between(rng, 0.42, 0.58),
    y: Math.min(0.98 - height / 2, between(rng, 0.55, 0.65)),
    vx: 0,
    vy: 0,
    bob: height * 0.015,
    bobHz: between(rng, 1.6, 2.2),
    wander: between(rng, 0.005, 0.02),
  };
}

interface Draft {
  readonly move: Move;
  readonly speed: Speed | null;
  readonly camera: CameraPath;
  readonly subjects: readonly SubjectPath[];
}

function draftFor(move: Move, rng: Rng, seconds: number, sprites: number, variant: number): Draft {
  const speed: Speed =
    seconds < 1 ? pick(rng, ['medium', 'fast'] as const) : pick(rng, ['slow', 'medium', 'fast']);
  const jitter = () => between(rng, 0.8, 1.2);
  const sprite = () => Math.floor(rng() * sprites);
  switch (move) {
    case 'static':
      return { move, speed: null, camera: NO_MOVE, subjects: [] };
    case 'staticSubject': {
      const heights = [0.3, 0.5, 0.7] as const;
      const height = heights[variant % 3]!;
      const subjects = [crossing(rng, sprite(), height, seconds)];
      if (variant % 3 === 1 && rng() < 0.6)
        subjects.push(crossing(rng, sprite(), between(rng, 0.25, 0.45), seconds));
      return { move, speed: null, camera: NO_MOVE, subjects };
    }
    case 'pan':
    case 'panHandheld': {
      const pan =
        sign(rng) * PAN_SPEED[move === 'panHandheld' && speed === 'slow' ? 'medium' : speed] * jitter();
      const shake =
        move === 'panHandheld' ? shakeOf(rng, pick(rng, ['light', 'medium', 'strong'] as const)) : null;
      const subjects = rng() < 0.3 ? [crossing(rng, sprite(), between(rng, 0.25, 0.5), seconds)] : [];
      return { move, speed, camera: { pan, tilt: 0, zoom: 0, ease: rng() < 0.5, shake }, subjects };
    }
    case 'tilt':
      return {
        move,
        speed,
        camera: {
          pan: 0,
          tilt: sign(rng) * TILT_SPEED[speed] * jitter(),
          zoom: 0,
          ease: rng() < 0.5,
          shake: null,
        },
        subjects: [],
      };
    case 'pushIn':
    case 'pullOut': {
      const zoom = (move === 'pushIn' ? 1 : -1) * ZOOM_SPEED[speed] * jitter();
      // A push-in rarely aims at the exact centre: a little drift along the way.
      const drift = between(rng, -0.02, 0.02);
      return {
        move,
        speed,
        camera: { pan: drift, tilt: -drift / 2, zoom, ease: rng() < 0.5, shake: null },
        subjects: [],
      };
    }
    case 'handheld': {
      const level = pick(rng, ['light', 'medium', 'strong'] as const);
      const subjects = rng() < 0.4 ? [crossing(rng, sprite(), between(rng, 0.3, 0.6), seconds)] : [];
      return { move, speed: null, camera: { ...NO_MOVE, shake: shakeOf(rng, level) }, subjects };
    }
    case 'tracking': {
      const pan = sign(rng) * between(rng, 0.1, 0.35);
      const tilt = rng() < 0.3 ? between(rng, -0.08, 0.08) : 0;
      const shake = rng() < 0.5 ? shakeOf(rng, 'light') : null;
      return {
        move,
        speed: null,
        camera: { pan, tilt, zoom: 0, ease: false, shake },
        subjects: [followed(rng, sprite(), between(rng, 0.4, 0.7))],
      };
    }
    case 'followWalk': {
      // Walking behind someone: the far background barely grows, the walker drifts a little in the frame.
      const shake = rng() < 0.5 ? shakeOf(rng, 'light') : null;
      const camera = {
        pan: between(rng, -0.03, 0.03),
        tilt: between(rng, -0.03, 0.03),
        zoom: between(rng, 0.03, 0.08),
        ease: false,
        shake,
      };
      const walker = followed(rng, sprite(), between(rng, 0.45, 0.7));
      return {
        move,
        speed: null,
        camera,
        subjects: [{ ...walker, vx: between(rng, -0.04, 0.04), wander: between(rng, 0.01, 0.025) }],
      };
    }
    case 'standing': {
      const person = followed(rng, sprite(), between(rng, 0.4, 0.7));
      return { move, speed: null, camera: NO_MOVE, subjects: [{ ...person, bob: 0.004, bobHz: 0.5 }] };
    }
    case 'handheldPerson': {
      // A vlog held at arm's length: the person stays with the camera, the room behind shakes.
      const person = followed(rng, sprite(), between(rng, 0.5, 0.75));
      const level = pick(rng, ['light', 'medium', 'strong'] as const);
      return { move, speed: null, camera: { ...NO_MOVE, shake: shakeOf(rng, level) }, subjects: [person] };
    }
    case 'drift': {
      // A hand that wanders a little the same way through a short shot: under 1.5% of the frame, no pan.
      const level = pick(rng, ['gimbal', 'light'] as const);
      const travel = between(rng, 0.006, 0.015);
      const across = rng() < 0.6;
      const rate = (sign(rng) * travel) / seconds;
      const camera = {
        pan: across ? rate : 0,
        tilt: across ? 0 : rate,
        zoom: 0,
        ease: false,
        shake: shakeOf(rng, level),
      };
      return {
        move,
        speed: null,
        camera,
        subjects: rng() < 0.5 ? [followed(rng, sprite(), between(rng, 0.4, 0.7))] : [],
      };
    }
    case 'gimbal': {
      const subjects = rng() < 0.5 ? [crossing(rng, sprite(), between(rng, 0.3, 0.6), seconds)] : [];
      return { move, speed: null, camera: { ...NO_MOVE, shake: shakeOf(rng, 'gimbal') }, subjects };
    }
    case 'trackForward': {
      const shake = rng() < 0.6 ? shakeOf(rng, pick(rng, ['light', 'medium'] as const)) : null;
      return {
        move,
        speed: null,
        camera: { pan: between(rng, -0.03, 0.03), tilt: 0, zoom: between(rng, 0.1, 0.3), ease: false, shake },
        subjects: [followed(rng, sprite(), between(rng, 0.45, 0.7))],
      };
    }
  }
}

/** Clips per background: moves in this order (staticSubject three times, pan twice). */
const PER_BACKGROUND: readonly Move[] = [
  'static',
  'staticSubject',
  'staticSubject',
  'staticSubject',
  'pan',
  'pan',
  'tilt',
  'pushIn',
  'pullOut',
  'handheld',
  'tracking',
  'trackForward',
  'panHandheld',
  'panHandheld',
  // FRM1-MOT, added after the first fit: follows as a phone records them, and their two lookalikes.
  'followWalk',
  'standing',
  'handheldPerson',
  // …and two more after reading real phone footage: a hand's slow wander, and a stabilised phone's sway.
  'drift',
  'gimbal',
];

const SIZE: Record<Aspect, { width: number; height: number }> = {
  '16:9': { width: 640, height: 360 },
  '9:16': { width: 360, height: 640 },
};

/** The whole set: every background × PER_BACKGROUND, seeded by `seed`. */
export function planClips(
  backgrounds: readonly { readonly id: string; readonly split: Split }[],
  sprites: number,
  seed = 20261031,
): ClipPlan[] {
  const clips: ClipPlan[] = [];
  backgrounds.forEach((background, b) => {
    PER_BACKGROUND.forEach((move, m) => {
      const rng = random(seed + b * 1000 + m);
      const aspect: Aspect = (b + m) % 2 === 0 ? '16:9' : '9:16';
      const seconds = pick(rng, [0.8, 1.5, 3] as const);
      const draft = draftFor(move, rng, seconds, sprites, b + m);
      const { width, height } = SIZE[aspect];
      const axis = Math.max(Math.abs(draft.camera.pan), Math.abs(draft.camera.tilt)) * seconds;
      clips.push({
        id: `${background.id}-${String(m).padStart(2, '0')}-${move}`,
        split: background.split,
        background: background.id,
        aspect,
        width,
        height,
        fps: 30,
        seconds,
        move,
        label: MOVE_LABEL[move],
        speed: draft.speed,
        camera: draft.camera,
        subjects: draft.subjects,
        noise: rng() < 0.5 ? Math.round(between(rng, 3, 7)) : 0,
        clear: (move === 'pan' || move === 'tilt') && axis >= 0.03,
      });
    });
  });
  return clips;
}
