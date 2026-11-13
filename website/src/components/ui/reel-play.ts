// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * When a reel frame's video plays (reel-frame.tsx), pure so test/unit/primitives.test.ts can hold it. The visitor's
 * own choice wins: Pause holds it paused wherever it scrolls, Play plays it whenever it is on screen. Before they
 * choose, it plays on its own only on screen, in a shown tab, and never under reduced motion.
 */
export type ReelIntent = 'auto' | 'paused' | 'playing';

export function reelShouldPlay(input: {
  readonly intent: ReelIntent;
  readonly autoPlay: boolean;
  readonly reduce: boolean;
  readonly onScreen: boolean;
  readonly tabShown: boolean;
}): boolean {
  if (!input.onScreen || !input.tabShown) return false;
  if (input.intent === 'paused') return false;
  if (input.intent === 'playing') return true;
  return input.autoPlay && !input.reduce;
}

/** The control's name: what pressing it does. */
export function reelControlLabel(playing: boolean): string {
  return playing ? 'Pause the reel' : 'Play the reel';
}
