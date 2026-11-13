// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: a shot's subjects without the helper: grid frames at the detect rate inside the range, decoded at the
 * short side asked for, each through the detector, as `detect` samples at the asset's rate with heads, people and a
 * chosen subject. A synthetic reel and a fake detector; skipped without the development FFmpeg.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FrameRate, ok, RationalTime, subjectSampleSchema } from '@taalcut/core';
import { afterAll, describe, expect, it } from 'vitest';
import { detectFrames, detectSubjectsAlong } from '../../src/subjects/along';
import type { SubjectDetector } from '../../src/subjects/detector';
import { makeReel, testMedia } from '../helpers/reel';

describe('detectFrames', () => {
  it('takes a grid frame every 1 / detectHz from the start, short of the end', () => {
    expect(detectFrames({ startSeconds: 1, endSeconds: 2 }, 30, 4, 1000)).toEqual([30, 38, 45, 53]);
    // A rate above the grid's keeps each frame once; the last frame bounds it.
    expect(detectFrames({ startSeconds: 0, endSeconds: 0.1 }, 10, 40, 1000)).toEqual([0, 1]);
    expect(detectFrames({ startSeconds: 0, endSeconds: 10 }, 10, 1, 3)).toEqual([0, 2]);
  });
});

const media = await testMedia('subjects along');
const dir = mkdtempSync(join(tmpdir(), 'taalcut-along-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(media.skip !== '')(
  `detectSubjectsAlong${media.skip ? ` (skipped: ${media.skip})` : ''}`,
  () => {
    it('detects each sampled frame and keeps its people, head and subject', { timeout: 60_000 }, async () => {
      const ctx = media.ctx!;
      const reel = join(dir, 'reel.mp4');
      await makeReel(ctx, reel, [{ source: 'testsrc2', frames: 60 }], {
        width: 640,
        height: 360,
        rate: '30',
      });
      const sizes: string[] = [];
      const detector: SubjectDetector = {
        detect: (frame) => {
          sizes.push(`${frame.width}x${frame.height}`);
          return Promise.resolve(
            ok({
              faces: [],
              people: [{ box: { x: 0.4, y: 0.1, width: 0.2, height: 0.8 }, confidence: 0.8 }],
            }),
          );
        },
        backends: () => ({}),
        release: () => Promise.resolve(),
      };
      const rate = FrameRate.of(60);
      const along = await detectSubjectsAlong(
        {
          path: reel,
          range: { start: RationalTime.of(30, rate), duration: RationalTime.of(60, rate) },
          detectHz: 4,
          shortSide: 180,
        },
        { media: ctx, detector },
      );
      if (!along.ok) throw new Error(JSON.stringify(along.error));
      expect(along.value.frame).toEqual({ width: 320, height: 180 });
      expect(sizes).toEqual(['320x180', '320x180', '320x180', '320x180']);
      const samples = along.value.samples;
      expect(samples.map((sample) => sample.t.value)).toEqual([30, 46, 60, 76]);
      for (const sample of samples) {
        expect(subjectSampleSchema.safeParse(sample).success).toBe(true);
        expect(sample.source).toBe('detect');
        expect(sample.heads).toHaveLength(1);
        expect(sample.subject.kind).toBe('human');
      }
    });
  },
);
