// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REFRAME_CONFIG } from '@taalcut/render';
import { describe, expect, it } from 'vitest';
import { writeJson } from '../../src/files';
import { driftCase, REFRAME_CANVAS, REFRAME_FPS, REFRAME_SOURCE } from '../../src/reframe/fixtures';
import { INSIDE_AREA, MAX_SPEED_CROPS_PER_SECOND, scoreReframeClip } from '../../src/reframe/metric';
import { scoreReframe, scoreReframeDirs } from '../../src/reframe/run';
import type { ReframeClipLabel, ReframePrediction } from '../../src/reframe/schema';

function clip(samples: ReframeClipLabel['samples'], frames = samples.length): ReframeClipLabel {
  return {
    clipId: 'clip',
    synthetic: true,
    fps: REFRAME_FPS,
    frames,
    source: REFRAME_SOURCE,
    canvas: REFRAME_CANVAS,
    samples,
  };
}

function still(
  frames: number,
  crop: { x: number; y: number; w: number; h: number },
): ReframePrediction['centres'] {
  return Array.from({ length: frames }, () => ({
    x: crop.x + crop.w / 2,
    y: crop.y + crop.h / 2,
    w: crop.w,
    h: crop.h,
  }));
}

describe('reframe scorer', () => {
  it('matches the documented inside-area and speed limits', () => {
    expect(INSIDE_AREA).toBe(REFRAME_CONFIG.boxInsideShare);
    expect(MAX_SPEED_CROPS_PER_SECOND).toBe(REFRAME_CONFIG.maxSpeedCropsPerSecond);
  });

  it('scores the drift track at 8/10 and does not claim a synthetic pass', () => {
    const drift = driftCase();
    const dir = mkdtempSync(join(tmpdir(), 'reframe-'));
    const labels = join(dir, 'labels');
    const predictions = join(dir, 'predictions');
    writeJson(join(labels, 'drift.json'), [drift.label]);
    writeJson(join(predictions, 'drift.json'), [drift.prediction]);
    const report = scoreReframeDirs(labels, predictions);
    expect(report.metrics.find((metric) => metric.name === 'subjectInFrame')?.value).toBe(0.8);
    expect(report.metrics.find((metric) => metric.name === 'jitterFrames')?.value).toBe(0);
    expect(report.synthetic).toBe(true);
    expect(report.claimed).toBe(false);
    expect(report.gate.pass).toBe(false);
    expect(report.suite).toBe('reframe');
  });

  it('counts a box inside a stable crop and ignores a no-subject frame', () => {
    const crop = { x: 0, y: 0, w: 200, h: 200 };
    const label = clip([{ tFrame: 0, x: 10, y: 10, w: 40, h: 40 }, { tFrame: 1 }]);
    const score = scoreReframeClip(label, {
      clipId: 'clip',
      framing: 'subject',
      crops: [{ tFrame: 0, ...crop }],
      centres: still(2, crop),
      qaJitterFrames: [],
    });
    expect(score.inside).toBe(1);
    expect(score.boxed).toBe(1);
    expect(score.fallbackFrames).toBe(1);
    expect(score.jitterFrames).toBe(0);
  });

  it('passes at 19/20 and fails at 18/20', () => {
    const crop = { x: 0, y: 0, w: 100, h: 100 };
    const share = (inside: number) => {
      const samples = Array.from({ length: 20 }, (_, tFrame) =>
        tFrame < inside ? { tFrame, x: 10, y: 10, w: 20, h: 20 } : { tFrame, x: 500, y: 500, w: 20, h: 20 },
      );
      const report = scoreReframe(
        [clip(samples, 20)],
        new Map([
          [
            'clip',
            {
              clipId: 'clip',
              framing: 'subject',
              crops: samples.map((sample) => ({ tFrame: sample.tFrame, ...crop })),
              centres: still(20, crop),
              qaJitterFrames: [],
            },
          ],
        ]),
      );
      return report;
    };
    expect(share(19).gate.pass).toBe(true);
    expect(share(19).metrics.find((metric) => metric.name === 'subjectInFrame')?.value).toBe(0.95);
    expect(share(18).gate.pass).toBe(false);
  });

  it('flags a centre that jumps faster than one crop a second, not a legal reversal', () => {
    const label = clip(
      [
        { tFrame: 0, x: 0, y: 0, w: 10, h: 10 },
        { tFrame: 1, x: 0, y: 0, w: 10, h: 10 },
      ],
      2,
    );
    const fast = scoreReframeClip(label, {
      clipId: 'clip',
      framing: 'subject',
      crops: [],
      centres: [
        { x: 0, y: 50, w: 100, h: 100 },
        { x: 100, y: 50, w: 100, h: 100 },
      ],
      qaJitterFrames: [],
    });
    expect(fast.jitterFrames).toBeGreaterThanOrEqual(1);
    const step = 100 / REFRAME_FPS;
    const legal = scoreReframeClip(
      { ...label, frames: 3, samples: [...label.samples, { tFrame: 2, x: 0, y: 0, w: 10, h: 10 }] },
      {
        clipId: 'clip',
        framing: 'subject',
        crops: [],
        centres: [
          { x: 0, y: 50, w: 100, h: 100 },
          { x: step, y: 50, w: 100, h: 100 },
          { x: 0, y: 50, w: 100, h: 100 },
        ],
        qaJitterFrames: [],
      },
    );
    expect(legal.jitterFrames).toBe(0);
  });

  it('unions measureJitter frames into the speed count', () => {
    const crop = { x: 0, y: 0, w: 100, h: 100 };
    const score = scoreReframeClip(clip([{ tFrame: 0, x: 10, y: 10, w: 10, h: 10 }], 2), {
      clipId: 'clip',
      framing: 'subject',
      crops: [{ tFrame: 0, ...crop }],
      centres: still(2, crop),
      qaJitterFrames: [1],
    });
    expect(score.jitterFrames).toBe(1);
  });

  it('does not pass a set with no labelled subject, and fails a subjectless clip framed as a subject', () => {
    const empty = clip([{ tFrame: 0 }, { tFrame: 1 }], 2);
    const fellBack: ReframePrediction = {
      clipId: 'clip',
      framing: 'noSubject',
      crops: [],
      centres: [],
      qaJitterFrames: [],
    };
    const none = scoreReframe([empty], new Map([['clip', fellBack]]));
    expect(none.metrics.some((metric) => metric.name === 'subjectInFrame')).toBe(false);
    expect(none.gate.pass).toBe(false);
    expect(none.gate.detail).toContain('no subject frames');

    const followed = scoreReframeClip(empty, { ...fellBack, framing: 'subject' });
    expect(followed.fallbackMissed).toBe(true);
    expect(scoreReframeClip(empty, fellBack).fallbackMissed).toBe(false);
  });

  it('keeps claimed false when synthetic numbers would pass', () => {
    const crop = { x: 0, y: 0, w: 100, h: 100 };
    const report = scoreReframe(
      [clip([{ tFrame: 0, x: 10, y: 10, w: 20, h: 20 }], 1)],
      new Map([
        [
          'clip',
          {
            clipId: 'clip',
            framing: 'subject',
            crops: [{ tFrame: 0, ...crop }],
            centres: still(1, crop),
            qaJitterFrames: [],
          },
        ],
      ]),
    );
    expect(report.gate.pass).toBe(true);
    expect(report.claimed).toBe(false);
  });
});
