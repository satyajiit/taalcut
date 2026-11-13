// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: whole heads from the no-helper detector's poses and people: a pose's head on its ears, sized by its
 * shoulders, also seen from behind (no nose or eyes); its face only when the nose or an eye shows; a person without a
 * pose head gets one at the top of the box; people reach over their heads.
 */
import { describe, expect, it } from 'vitest';
import type { DetectedPose, PoseKeypoint } from '../../src/subjects/detector';
import { faceOfPose, headOfPerson, headOfPose, headsFrom } from '../../src/subjects/heads';

const at = (x: number, y: number, score = 0.9): PoseKeypoint => ({ x, y, score });
const none = at(0, 0, 0);
/** Ears at y 0.3, shoulders at y 0.4 and 0.2 apart; `face` adds the nose and eyes. */
function pose(face: boolean): DetectedPose {
  const keypoints = Array.from({ length: 17 }, () => none);
  if (face) {
    keypoints[0] = at(0.5, 0.31);
    keypoints[1] = at(0.48, 0.29);
    keypoints[2] = at(0.52, 0.29);
  }
  keypoints[3] = at(0.45, 0.3);
  keypoints[4] = at(0.55, 0.3);
  keypoints[5] = at(0.4, 0.4);
  keypoints[6] = at(0.6, 0.4);
  return { box: { x: 0.35, y: 0.25, width: 0.3, height: 0.7 }, confidence: 0.9, keypoints };
}

describe('heads from poses and people (FRM1-SUB)', () => {
  it('puts a head on the head keypoints, sized by face and body, seen from behind as from the front', () => {
    // From behind: the ears' spread says 0.1 / 0.63; the body the larger of 0.1 / 0.8 and 0.2 / 1.4; grown by 1.1.
    const back = headOfPose(pose(false), 1, 0.2)!;
    const height = (0.1 / 0.63) * 1.1;
    expect(back.box.height).toBeCloseTo(height, 9);
    expect(back.box.width).toBeCloseTo(1.12 * height, 9);
    expect(back.box.x + back.box.width / 2).toBeCloseTo(0.5, 9);
    expect(back.box.y).toBeCloseTo(0.3 - 0.6 * height, 9);
    // From the front the eyes narrow the face's say (the smaller of ears and eyes).
    const front = headOfPose(pose(true), 1, 0.2)!;
    expect(front.box.height).toBeCloseTo((0.04 / 0.26) * 1.1, 9);
    // Nothing to place it by without a head keypoint; nothing to size it by with one ear and no shoulders.
    const without = (drop: readonly number[]) => ({
      keypoints: pose(false).keypoints.map((point, index) => (drop.includes(index) ? none : point)),
    });
    expect(headOfPose(without([3, 4]), 1, 0.2)).toBeNull();
    expect(headOfPose(without([4, 5, 6]), 1, 0.2)).toBeNull();
  });

  it('reaches behind a profile towards its one ear', () => {
    const keypoints = pose(true).keypoints.map((point, index) => (index === 4 ? none : point));
    const head = headOfPose({ keypoints }, 1, 0.2)!;
    // The head keypoints' mean is at x (0.5 + 0.48 + 0.52 + 0.45) / 4; the ear is on the left.
    expect(head.box.x + head.box.width / 2).toBeCloseTo(0.4875 - 0.1 * head.box.width, 9);
  });

  it('gives a pose a face only when its nose or an eye shows', () => {
    const tuning = { keypointScore: 0.2, faceKeypointScore: 0.3 };
    expect(faceOfPose(pose(false), { width: 1000, height: 1000 }, tuning)).toBeNull();
    const face = faceOfPose(pose(true), { width: 1000, height: 1000 }, tuning)!;
    const head = headOfPose(pose(true), 1, 0.2)!;
    expect(face.box.width).toBeCloseTo(0.6 * head.box.width, 9);
    expect(face.box.x + face.box.width / 2).toBeCloseTo(0.5, 9);
    expect(face.box.y + face.box.height / 2).toBeCloseTo((0.31 + 0.29 + 0.29) / 3, 9);
  });

  it('puts a head at the top of a person, no taller than a quarter of the box', () => {
    const standing = headOfPerson({ x: 0.4, y: 0.2, width: 0.1, height: 0.7 }, 16 / 9);
    expect(standing.y).toBeCloseTo(0.2, 9);
    expect(standing.width).toBeCloseTo(0.035, 9);
    expect(standing.height).toBeCloseTo(0.035 * (16 / 9), 9);
    const close = headOfPerson({ x: 0, y: 0.1, width: 1, height: 0.9 }, 16 / 9);
    expect(close.height).toBeCloseTo(0.225, 9);
  });

  it('keeps one head per person and stretches the person over it', () => {
    const person = { box: { x: 0.33, y: 0.26, width: 0.34, height: 0.7 }, confidence: 0.8 };
    const found = headsFrom(
      { faces: [], people: [person], poses: [pose(false)] },
      { width: 1000, height: 1000 },
    );
    expect(found.heads).toHaveLength(1);
    expect(found.heads[0]!.confidence).toBeCloseTo(0.9, 9);
    // The person box and the pose's box are one person.
    expect(found.people).toHaveLength(1);
    expect(found.people[0]!.box.y).toBeLessThan(0.26);
    const alone = headsFrom({ faces: [], people: [person] }, { width: 1080, height: 1920 });
    expect(alone.heads).toHaveLength(1);
    expect(alone.heads[0]!.confidence).toBeCloseTo(0.64, 9);
  });
});
