// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A timeline that uses the timeline's motion (SPEC G.9): a slide and a whip between clips, titles typed on, popped in
 * and slid in, and burnt-in captions with a pop highlight. HFW1 retire: a graphic is a composition with its own
 * motion, timed by the workspace's tests (test/workspace); the kit's eight components went with the kit.
 */
import { FrameRate, type Timeline } from '@taalcut/core';
import { captionTrackOf, makeTimeline } from '../support/timeline';

export const rate = FrameRate.of(30);

const CLIPS = [
  { frames: 120 },
  { frames: 240, transition: { kind: 'slide', inFrames: 8, outFrames: 8, direction: 'left' } },
  { frames: 240, transition: { kind: 'whip', inFrames: 6, outFrames: 6 } },
] as const;

const CUES: readonly (readonly [number, number, string])[] = [
  [0, 150, 'Meet the team that ships every Friday'],
  [150, 150, 'Sales grew forty percent this year'],
  [300, 150, 'Here are three tips to plan your week'],
  [450, 150, 'Follow for part two of the series'],
];

/** The titles of the first block: a typewriter's clip-path, a pop's scale, a slide's y. */
const TITLES = [
  { start: 20, frames: 90, text: 'Made-up words typed on', reveal: 'typewriter' },
  { start: 150, frames: 90, text: 'Made-up title popping in', reveal: 'pop' },
  { start: 300, frames: 90, text: 'Made-up title sliding in', reveal: 'slide' },
] as const;

/** A block's length, frames. */
const BLOCK = 600;

/**
 * 20 s on three clips (a slide at 4 s, a whip at 12 s), three titles and captions with a pop highlight. With
 * `blocks`, the clips and captions repeat that many times (the seek-cost timeline: 60 s, captions throughout).
 */
export async function motionTimeline(blocks = 1): Promise<{ timeline: Timeline }> {
  const repeat = Array.from({ length: blocks }, (_, block) => block);
  const timeline = makeTimeline({
    items: repeat.flatMap((block) =>
      CLIPS.map((clip, index) =>
        block > 0 && index === 0
          ? { ...clip, transition: { kind: 'slide', inFrames: 8, outFrames: 8, direction: 'right' } as const }
          : clip,
      ),
    ),
    texts: TITLES,
    captions: captionTrackOf(
      rate,
      repeat.flatMap((block) =>
        CUES.map(([at, frames, text]) => [block * BLOCK + at, frames, text] as const),
      ),
      { highlight: 'pop' },
    ),
  });
  return { timeline };
}
