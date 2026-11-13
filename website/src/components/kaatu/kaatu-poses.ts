// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Kaatu's poses for the Kaatu API (kaatu.tsx), each on its own drawing in the site's two sheets (web-creator and
 * web-story in kaatu-frames.ts, drawn with Codex for WEB2). A pose holds its frame; when it first comes on screen it
 * plays its short act POSE_REPEATS times, well under five seconds in all (WCAG 2.2.2), and the two peeks slide in
 * from their edge. `about` is the one line the gate reads to place each pose.
 */
import type { Clip } from './kaatu-acts';
import type { KaatuFrame } from './kaatu-frames';
import type { KaatuMove } from './kaatu-moves';

export const KAATU_POSES = [
  'film',
  'snip',
  'headphones',
  'point',
  'thumbs-up',
  'hold-reel',
  'cheer',
  'peek-left',
  'peek-up',
  'nap',
  'carry-strip',
  'jump',
  'laptop',
  'search',
  'heart-hands',
  'selfie',
  'big-wave',
  'type',
] as const;

export type KaatuPose = (typeof KAATU_POSES)[number];

/** How a pose arrives: in place, or sliding in from behind an edge (the box's left or bottom edge clips it). */
export type PoseEntrance = 'in-place' | 'from-left' | 'from-below';

export interface PoseScript {
  /** The frame the pose holds. */
  readonly frame: KaatuFrame;
  /** Played POSE_REPEATS times when the pose first comes on screen, then it holds `frame`. */
  readonly act?: Clip;
  readonly entrance: PoseEntrance;
  /** Breathes slower, asleep. */
  readonly asleep?: boolean;
  /** True: the pose has its own drawing. Every pose has one since WEB2 lane L5. */
  readonly drawn: boolean;
  /** One line on what Kaatu is doing, for whoever places it. */
  readonly about: string;
}

const beat = (frame: KaatuFrame, ms: number, move?: KaatuMove) => (move ? { frame, ms, move } : { frame, ms });

export const POSES: Readonly<Record<KaatuPose, PoseScript>> = {
  film: {
    frame: 'film',
    act: [beat('clapper', 360), beat('clap', 160, 'boop'), beat('film', 700, 'present')],
    entrance: 'in-place',
    drawn: true,
    about: 'Films with a phone held up to one eye, after an "action!" on the clapperboard.',
  },
  snip: {
    frame: 'snip',
    act: [beat('snip', 260, 'squeeze'), beat('snip', 260, 'squeeze'), beat('snip', 320, 'squeeze')],
    entrance: 'in-place',
    drawn: true,
    about: 'Snips a film strip with teal scissors; a cut piece falls away.',
  },
  headphones: {
    frame: 'headphones',
    act: [
      beat('headphones', 320, 'sway-left'),
      beat('headphones', 320, 'sway-right'),
      beat('headphones', 320, 'sway-left'),
      beat('headphones', 320, 'sway-right'),
    ],
    entrance: 'in-place',
    drawn: true,
    about: 'Bops along in violet headphones, eyes shut, a rose note by its head. The pose to dance with a beat.',
  },
  point: {
    frame: 'point',
    act: [beat('point', 760, 'lean')],
    entrance: 'in-place',
    drawn: true,
    about: 'Points to its right (the viewer’s right) and leans that way: place it left of what it shows.',
  },
  'thumbs-up': {
    frame: 'thumbs-up',
    act: [beat('thumbs-up', 620, 'hop')],
    entrance: 'in-place',
    drawn: true,
    about: 'A wink and a thumbs up, with a hop: for something done well.',
  },
  'hold-reel': {
    frame: 'hold-reel',
    act: [beat('hold-reel', 700, 'present')],
    entrance: 'in-place',
    drawn: true,
    about: 'Holds up a rose 9:16 reel card with a play triangle, proudly.',
  },
  cheer: {
    frame: 'cheer',
    act: [beat('cheer', 260, 'hop'), beat('starstruck', 220), beat('cheer', 420, 'boop')],
    entrance: 'in-place',
    drawn: true,
    about: 'Both arms up in a cheer, confetti in the four collar colours.',
  },
  'peek-left': {
    frame: 'peek-left',
    entrance: 'from-left',
    drawn: true,
    about: 'Peeks round an edge on its left, one paw gripping it; slides in from the box’s left edge.',
  },
  'peek-up': {
    frame: 'peek-up',
    entrance: 'from-below',
    drawn: true,
    about: 'Peeks up over a ledge, paws under its chin; slides up from the box’s bottom edge.',
  },
  nap: {
    frame: 'nap',
    act: [beat('nap', 760, 'nod')],
    entrance: 'in-place',
    asleep: true,
    drawn: true,
    about: 'Asleep hugging a teal clip like a pillow, a violet moon above; breathes slowly.',
  },
  'carry-strip': {
    frame: 'carry-strip',
    act: [beat('carry-strip', 380, 'march-left'), beat('carry-strip', 380, 'march-right')],
    entrance: 'in-place',
    drawn: true,
    about: 'Carries a film strip of teal, marigold and rose frames, marching in place.',
  },
  jump: {
    frame: 'jump',
    act: [beat('jump', 660, 'jump')],
    entrance: 'in-place',
    drawn: true,
    about: 'A star jump, arms flung wide, a real leap off the ground.',
  },
  laptop: {
    frame: 'laptop',
    act: [beat('laptop', 700, 'present')],
    entrance: 'in-place',
    drawn: true,
    about: 'Shows you a small laptop with a plain violet screen, pointing at it.',
  },
  search: {
    frame: 'search',
    act: [beat('search', 440, 'scan-left'), beat('search', 440, 'scan-right')],
    entrance: 'in-place',
    drawn: true,
    about: 'Looks through a teal magnifying glass, one big eye, scanning side to side.',
  },
  'heart-hands': {
    frame: 'heart-hands',
    act: [beat('heart-hands', 520, 'pulse'), beat('heart-hands', 520, 'pulse')],
    entrance: 'in-place',
    drawn: true,
    about: 'Heart hands at its chest, eyes happy, a rose heart above.',
  },
  selfie: {
    frame: 'selfie',
    act: [beat('selfie', 440, 'tilt'), beat('selfie', 360, 'boop')],
    entrance: 'in-place',
    drawn: true,
    about: 'Takes a selfie with a phone held high to its left, winking.',
  },
  'big-wave': {
    frame: 'big-wave',
    act: [beat('big-wave', 340, 'waggle'), beat('big-wave', 340, 'waggle'), beat('big-wave', 340, 'waggle')],
    entrance: 'in-place',
    drawn: true,
    about: 'A big wave, arm high, the other paw cupped by its mouth calling hello.',
  },
  type: {
    frame: 'type',
    act: [beat('type', 140, 'tap'), beat('type', 140, 'tap'), beat('type', 140, 'tap'), beat('type', 320)],
    entrance: 'in-place',
    drawn: true,
    about: 'Types on a small laptop on its lap, tongue out in concentration.',
  },
};

/** How many times a pose's act plays when it arrives: always well under five seconds of motion (WCAG 2.2.2). */
export const POSE_REPEATS = 2;
