// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/**
 * The reframe "Done when" on the synthetic eval clips with their recorded tracks: the subject stays inside the
 * frame on ≥ 95 % of frames and the path has no jitter above the smoothing threshold. (The labelled real-footage
 * set is human input: `tools/evals reframe`.)
 */
import { describe, expect, it } from 'vitest';
import { FrameRate, newId, RationalTime } from '@taalcut/core';
import { cropJitterCheck } from '../../src/qa/checks/reframe';
import { planVisualFraming, type FramingInput } from '../../src/reframe/framing';
import {
  LANDSCAPE_SUBJECT,
  PORTRAIT_SUBJECT,
  recordedTrack,
  subjectInFramePercent,
  type BlockClipSpec,
} from './fixtures';

const rate = FrameRate.of(30);
const PORTRAIT = { width: 1080, height: 1920, safe: { x: 120, y: 288, width: 540, height: 672 } };
const LANDSCAPE = { width: 1920, height: 1080, safe: { x: 96, y: 54, width: 1728, height: 972 } };

function frame(spec: BlockClipSpec, canvas: typeof PORTRAIT, seed: number, canvasChanged: boolean) {
  const frames = spec.seconds * spec.fps;
  const input: FramingInput = {
    visual: {
      kind: 'video',
      reframe: canvasChanged ? null : { mode: 'auto', nudge: { x: 0, y: 0 }, scale: 1 },
      visible: { start: 0, end: frames },
      cut: { start: 0, end: frames },
      sourceIn: RationalTime.zero(rate),
      speed: null,
    },
    source: { width: spec.width, height: spec.height },
    canvas: { width: canvas.width, height: canvas.height },
    safe: canvas.safe,
    captionBandTop: null,
    track: recordedTrack(spec, { seed }),
    rate,
    canvasChanged,
  };
  return { framing: planVisualFraming(input), frames };
}

describe('reframe eval set (synthetic, recorded tracks)', () => {
  it.each([1, 2, 3, 4, 5])(
    'keeps the walking subject in frame on ≥ 95 %% of frames (noise seed %i)',
    (seed) => {
      const { framing, frames } = frame(LANDSCAPE_SUBJECT, PORTRAIT, seed, false);
      expect(framing.kind).toBe('crop');
      expect(subjectInFramePercent(framing, LANDSCAPE_SUBJECT, frames)).toBeGreaterThanOrEqual(95);
      const jitter = cropJitterCheck({
        clips: [
          {
            clipId: 'c',
            visible: { start: 0, end: frames },
            framing,
            reframe: null,
            source: { width: 1920, height: 1080 },
            extent: { x: 0, y: 0, width: 1, height: 1 },
          },
        ],
        canvas: { width: 1080, height: 1920 },
        rate,
        target: { projectId: newId<'Project'>(), timelineId: newId<'Timeline'>() },
      });
      expect(jitter.status).toBe('pass');
    },
  );

  it('pads 9:16 footage of a standing person on a landscape canvas', () => {
    const { framing } = frame(PORTRAIT_SUBJECT, LANDSCAPE, 1, true);
    expect(framing).toEqual({ kind: 'blurPad', reason: 'subjectTooTall' });
  });
});
