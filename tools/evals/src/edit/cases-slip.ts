// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-TRIM: the edit eval's cases for a slip: a clip plays another part of its shot, in its place, for its length.
 * Each clip starts three seconds into its ten-second file (timeline-doc.ts); in the coffee shot someone faces the
 * camera for its first six seconds (subjects.ts). The words are made up, shaped like a person's in the chat.
 */
import type { Clip } from '@taalcut/core';
import { defineCases } from './case-types';
import { all, clipNo, frames, near, shotByKey } from './check';
import { CLIP_FRAMES } from './timeline-doc';

const IN_POINT = 90;

/** The clip `index` still plays its shot for its length; its in-point in frames. */
function slipped(clip: Clip | undefined, index: number, key: string) {
  const inPoint = frames(clip?.sourceStart);
  const length = frames(clip?.duration);
  return {
    inPoint,
    kept: [
      [clip?.media.assetId === shotByKey(key).assetId, `clip ${index + 1} no longer plays the ${key} shot`],
      [length === CLIP_FRAMES[index], `clip ${index + 1} is ${length} frames, not ${CLIP_FRAMES[index]}`],
    ] as const,
  };
}

export const SLIP_CASES = defineCases([
  {
    id: 'slip-start-this',
    family: 'slip',
    pointed: true,
    request:
      "This one opens with me only just getting on the bike. Use a later part of the shot, once I'm riding.",
    select: [{ clip: 0 }],
    scope: { items: [0] },
    check: (_before, after) => {
      const { inPoint, kept } = slipped(clipNo(after, 0), 0, 'bike');
      return all(...kept, [
        inPoint >= IN_POINT + 15,
        `the bike clip starts at frame ${inPoint}, not later than 90`,
      ]);
    },
  },
  {
    id: 'slip-later-seconds',
    family: 'slip',
    request: 'Play the waves clip from two seconds later in its shot, keeping its length.',
    scope: { items: [3] },
    check: (_before, after) => {
      const { inPoint, kept } = slipped(clipNo(after, 3), 3, 'waves');
      return all(...kept, [near(inPoint, IN_POINT + 60, 3), `the waves start at frame ${inPoint}, not 150`]);
    },
  },
  {
    id: 'slip-face-this',
    family: 'slip',
    pointed: true,
    request: "I don't want my face in this clip. Use a part of the shot where it isn't showing.",
    select: [{ clip: 1 }],
    scope: { items: [1] },
    check: (_before, after) => {
      const { inPoint, kept } = slipped(clipNo(after, 1), 1, 'coffee');
      return all(...kept, [
        inPoint >= 180,
        `the coffee clip starts at frame ${inPoint}, where the face still shows`,
      ]);
    },
  },
  {
    id: 'slip-end-named',
    family: 'slip',
    // Not "that shot": "this", "it" and "that" point at the selection or the playhead's clip (EDT1-CTX), and the 9B
    // slipped clip 1, under the playhead, in three of five runs.
    request: "The dog clip ends just as the dog slows down and stops. Use an earlier part of the dog's shot.",
    scope: { items: [4] },
    check: (_before, after) => {
      const { inPoint, kept } = slipped(clipNo(after, 4), 4, 'dog');
      return all(...kept, [
        inPoint <= IN_POINT - 15,
        `the dog clip starts at frame ${inPoint}, not earlier than 90`,
      ]);
    },
  },
]);
