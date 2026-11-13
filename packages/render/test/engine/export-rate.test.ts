// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FrameRate, RationalTime, unwrap } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { gatherExport } from '../../src/engine/export-inputs';
import { timelineAtExportRate } from '../../src/plan/export-rate';
import { speedCurve, sourceFramesAt } from '../../src/plan/speed-curve';
import { renderRow } from '../commands/support';
import { testEngine } from '../support/engine';
import { tempDir } from '../support/media';
import { captionTrackOf, makeTimeline } from '../support/timeline';

const rate = FrameRate.of(30);
const outputRate = FrameRate.of(60);
let work: Awaited<ReturnType<typeof tempDir>>;
beforeEach(async () => {
  work = await tempDir('export-rate');
});
afterEach(() => work.dispose());

describe('export sampling rate', () => {
  it('gathers the unchanged times on a doubled frame grid for picture, motion, captions and QA', async () => {
    const speed = {
      curve: 'linear' as const,
      points: [
        { at: RationalTime.of(0, rate), speed: 0.5 },
        { at: RationalTime.of(30, rate), speed: 1.5 },
      ],
    };
    const timeline = makeTimeline({
      items: [{ frames: 30, speed }, { frames: 30 }],
      texts: [{ start: 15, frames: 15, text: 'Airport' }],
      captions: captionTrackOf(rate, [[15, 30, 'City lights']]),
    });
    const before = structuredClone(timeline);
    const engine = testEngine(work.dir, {} as MediaContext, '/no-shell');
    engine.timelines.set(timeline.id, timeline);
    const base = renderRow({ projectId: timeline.projectId, timelineId: timeline.id });
    const inputs = unwrap(
      await gatherExport(engine.deps, {
        ...base,
        rate: outputRate,
        request: { ...base.request, rate: outputRate },
      }),
    );
    expect(inputs.timeline.canvas.rate).toEqual(outputRate);
    expect(inputs.plan).toMatchObject({ rate: outputRate, durationFrames: 120 });
    expect(inputs.plan.visuals.map((clip) => clip.cut)).toEqual([
      { start: 0, end: 60 },
      { start: 60, end: 120 },
    ]);
    expect(inputs.qaPlan).toMatchObject({
      rateNum: 60,
      rateDen: 1,
      durationFrames: 120,
      cuts: [{ frame: 60 }],
      cues: [{ span: { start: 30, end: 90 } }],
      texts: [{ span: { start: 30, end: 60 }, probeFrame: 45 }],
    });
    expect(inputs.plan.captions?.cues).toEqual(timeline.captions?.cues);
    expect(sourceFramesAt(speedCurve(speed, 0, outputRate), 30) / 60).toBe(
      sourceFramesAt(speedCurve(speed, 0, rate), 15) / 30,
    );
    expect(engine.timelines.get(timeline.id)).toEqual(before);
  });

  it('keeps fractional rates exact and refuses grids that would require changing edit times', () => {
    const fractional = makeTimeline({ rate: FrameRate.of(30000, 1001), items: [{ frames: 30 }] });
    expect(timelineAtExportRate(fractional, FrameRate.of(60000, 1001)).ok).toBe(true);
    const timeline = makeTimeline({ items: [{ frames: 31 }] });
    for (const target of [FrameRate.of(24), FrameRate.of(50), FrameRate.of(60000, 1001)]) {
      const result = timelineAtExportRate(timeline, target);
      expect(result.ok ? null : result.error.code).toBe('render.unsupported_frame_rate');
    }
  });
});
