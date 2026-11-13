// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A stand-in SubjectSource (FRM1-SUB's port): made-up heads per asset over time, detect samples at 4 Hz. */
import {
  ok,
  RationalTime,
  type SubjectClipRange,
  type SubjectSample,
  type SubjectSource,
} from '@taalcut/core';

export interface FakeBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FakeSubjects extends SubjectSource {
  readonly ensured: SubjectClipRange[];
  readonly read: SubjectClipRange[];
}

/** A head's face inside it (brow to chin), as Vision's face box sits in a whole head. */
const faceIn = (head: FakeBox): FakeBox => ({
  x: head.x + head.width / 6,
  y: head.y + (0.55 * head.height) / 1.7,
  width: head.width / 1.5,
  height: head.height / 1.7,
});

export function fakeSubjects(
  heads: (assetId: string, seconds: number) => readonly FakeBox[],
  options: { readonly measured?: boolean; readonly frame?: { width: number; height: number } | null } = {},
): FakeSubjects {
  const ensured: SubjectClipRange[] = [];
  const read: SubjectClipRange[] = [];
  const measured = options.measured ?? true;
  return {
    ensured,
    read,
    async ensure(ranges) {
      ensured.push(...ranges);
      return ok(undefined);
    },
    async over(range) {
      read.push(range);
      const from = RationalTime.toSeconds(range.start);
      const to = RationalTime.toSeconds(range.end);
      const samples: SubjectSample[] = [];
      for (let seconds = Math.ceil(from * 4) / 4; seconds < to; seconds += 0.25) {
        const boxes = heads(range.assetId, seconds);
        const first = boxes[0];
        samples.push({
          t: RationalTime.fromSeconds(seconds, range.start.rate),
          source: 'detect',
          faces: boxes.map((box) => ({ box: faceIn(box), confidence: 0.9, roll: 0, yaw: 0, pitch: 0 })),
          humans: [],
          saliency: [],
          ...(measured ? { heads: boxes.map((box) => ({ box, confidence: 0.9 })), people: [] } : {}),
          subject: {
            kind: first ? 'face' : 'none',
            box: first ?? null,
            focus: first ? { x: first.x + first.width / 2, y: first.y + first.height / 2 } : null,
            confidence: first ? 0.9 : 0,
          },
        });
      }
      const frame = options.frame === undefined ? { width: 1080, height: 1920 } : options.frame;
      return ok({ frame, detector: 'vision', samples });
    },
  };
}
