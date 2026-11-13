// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: the subjects eval's scoring. A head is found by a box that covers 80% of it and is at most 2.5 times
 * its area; each box finds one head; ignored heads count neither way; a face is found by a face box centred in
 * the head. The committed labels parse and name only the set's frames.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { headMatches, matchHeads, scoreSubjects, type LabelledFrame } from '../src/subjects/score';

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const SUBJECTS = join(dirname(fileURLToPath(import.meta.url)), '../src/subjects');

describe('subject scoring (FRM1-SUB)', () => {
  it('finds a head with a box that covers it without swallowing the frame', () => {
    const head = box(0.4, 0.2, 0.1, 0.2);
    expect(headMatches(head, box(0.38, 0.18, 0.14, 0.25))).toBe(true);
    // The face rectangle alone covers too little of the head.
    expect(headMatches(head, box(0.42, 0.28, 0.07, 0.1))).toBe(false);
    // A box over half the frame covers it but is far too big.
    expect(headMatches(head, box(0, 0, 0.6, 0.6))).toBe(false);
  });

  it('lets each box find one head, the closest first', () => {
    const near = box(0.4, 0.2, 0.1, 0.2);
    const beside = box(0.45, 0.2, 0.1, 0.2);
    const match = matchHeads([near, beside], [box(0.4, 0.2, 0.1, 0.2)]);
    expect(match.found).toEqual([true, false]);
    expect(match.iou[0]).toBeCloseTo(1, 6);
  });

  it('scores recall, false heads, faces and kinds, leaving ignored heads out', () => {
    const labels: Record<string, LabelledFrame> = {
      a: {
        heads: [
          { box: box(0.1, 0.1, 0.2, 0.3), face: 'frontal', tags: ['hat'] },
          { box: box(0.6, 0.1, 0.2, 0.3), face: 'none' },
          { box: box(0.9, 0.9, 0.02, 0.02), face: 'frontal', ignore: true },
        ],
      },
      b: { heads: [] },
    };
    const score = scoreSubjects(labels, {
      a: {
        heads: [box(0.09, 0.08, 0.22, 0.34), box(0.895, 0.895, 0.03, 0.03)],
        faces: [box(0.14, 0.2, 0.12, 0.12)],
      },
      b: { heads: [box(0.4, 0.4, 0.1, 0.1)], faces: [] },
    });
    expect(score.heads).toMatchObject({ total: 2, found: 1, recall: 0.5 });
    expect(score.falseHeadsPerFrame).toBe(0.5);
    expect(score.faces).toMatchObject({ total: 1, found: 1 });
    expect(score.byKind['tag:hat']).toEqual({ total: 1, found: 1 });
    expect(score.byKind['face:none']).toEqual({ total: 1, found: 0 });
    expect(score.headMisses).toEqual([{ frame: 'a', head: 1, face: 'none', tags: [] }]);
  });

  it('labels every frame of the set, and nothing else', () => {
    const set = JSON.parse(readFileSync(join(SUBJECTS, 'set.json'), 'utf8')) as { frames: { id: string }[] };
    const labels = JSON.parse(readFileSync(join(SUBJECTS, 'labels.json'), 'utf8')) as {
      frames: Record<string, LabelledFrame>;
    };
    expect(Object.keys(labels.frames).sort()).toEqual(set.frames.map((frame) => frame.id).sort());
    const heads = Object.values(labels.frames).flatMap((frame) => frame.heads);
    expect(heads.filter((head) => !head.ignore).length).toBeGreaterThanOrEqual(100);
    for (const head of heads) {
      expect(head.box.x).toBeGreaterThanOrEqual(0);
      expect(head.box.x + head.box.width).toBeLessThanOrEqual(1.001);
      expect(head.box.y + head.box.height).toBeLessThanOrEqual(1.001);
    }
  });
});
