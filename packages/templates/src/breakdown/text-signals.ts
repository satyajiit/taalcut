// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-SIGN: every signal a reading's composited-or-scene record can carry (text-scene.ts), in the order the SPEC
 * lists them; the config holds one weight for each.
 */
export const SCENE_SIGNALS = [
  'withPicture',
  'fixedOnPicture',
  'ownMove',
  'drift',
  'covered',
  'misread',
  'interrupted',
  'behindPerson',
  'tilt',
  'block',
  'vertical',
  'edge',
  'crosses',
  'withShot',
  'midShot',
  'short',
  'crowd',
  'replaced',
  'doubtful',
  'shape',
  'rendered',
] as const;
export type SceneSignal = (typeof SCENE_SIGNALS)[number];

/** What the pixels round a reading show (text-motion.ts measures it); here so text-scene.ts needs nothing from text-motion. */
export interface PixelEvidence {
  /** Frame pairs measured: the first settled frame against each later one. */
  readonly pairs: number;
  /**
   * Shares of the pairs where the picture moved (0–1, each pair weighted by how far, full from 4 pixels; damped
   * under a pair and a half): the words moved with it, or stayed put while it moved. And of all the pairs, those
   * where the words moved their own way.
   */
  readonly withPicture: number;
  readonly fixedOnPicture: number;
  readonly ownMove: number;
  /** The share of the words cut off from one side in the worst pair: something passed in front of them. */
  readonly covered: number;
  /** The share of the ring round the words that holds still and even across the frames: a fill. */
  readonly fill: number;
  /** That fill stops on every side within a few lines: a shape (a bubble, a pill, a box), not a wall. */
  readonly bounded: boolean;
  /** The words' contrast with what is behind them, 0–255. */
  readonly contrast: number;
}
