// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** planTimeline and planQa: the timeline laid out on the frame grid, and what QA should expect. */
import { describe, expect, it } from 'vitest';
import { FrameRate, RationalTime } from '@taalcut/core';
import { meanSpeed, planTimeline, transitionEffect } from '../../src/plan/render-plan';
import { planQa } from '../../src/plan/qa-plan';
import { presetFor } from '../../src/presets/presets.v1';
import { beatMapOf, captionTrackOf, makeTimeline } from '../support/timeline';

const rate = FrameRate.of(30);

describe('planTimeline', () => {
  it('tiles clips and gaps and grows clips by their transition handles', () => {
    const timeline = makeTimeline({
      items: [
        { frames: 30 },
        { frames: 30, transition: { kind: 'dissolve', inFrames: 4, outFrames: 6 } },
        { gap: 15 },
        { frames: 20, enabled: false },
      ],
    });
    const plan = planTimeline(timeline);
    if (!plan.ok) throw new Error(plan.error.code);
    const [a, b, c] = plan.value.visuals;
    expect(plan.value.durationFrames).toBe(95);
    expect(a!.cut).toEqual({ start: 0, end: 30 });
    expect(a!.visible).toEqual({ start: 0, end: 36 });
    expect(b!.cut).toEqual({ start: 30, end: 60 });
    expect(b!.visible).toEqual({ start: 26, end: 60 });
    expect(RationalTime.toFrames(b!.sourceIn, rate)).toBe(26);
    expect(plan.value.transitions).toEqual([
      expect.objectContaining({ effect: 'crossfade', cut: 30, span: { start: 26, end: 36 } }),
    ]);
    expect(plan.value.gaps).toEqual([
      { start: 60, end: 75 },
      { start: 75, end: 95 },
    ]);
    expect(c!.enabled).toBe(false);
    // Clip sound: the first two clips, crossfading over the transition; the disabled clip is silent.
    expect(plan.value.audio.map((clip) => [clip.span, clip.fadeInFrames, clip.fadeOutFrames])).toEqual([
      [{ start: 0, end: 36 }, 0, 10],
      [{ start: 26, end: 60 }, 10, 0],
    ]);
  });

  it('draws unknown transition kinds as cuts and says so', () => {
    const timeline = makeTimeline({
      items: [{ frames: 20 }, { frames: 20, transition: { kind: 'glitch', inFrames: 2, outFrames: 2 } }],
    });
    const plan = planTimeline(timeline);
    if (!plan.ok) throw new Error(plan.error.code);
    expect(plan.value.transitions).toEqual([]);
    expect(plan.value.warnings).toHaveLength(1);
  });

  it('maps template kinds and directions to effects', () => {
    expect(transitionEffect('slide', 'up')).toBe('slideUp');
    expect(transitionEffect('slide', null)).toBe('slideLeft');
    expect(transitionEffect('zoom', 'down')).toBe('zoomOut');
    expect(transitionEffect('fade', null)).toBe('dipToBlack');
    expect(transitionEffect('other', null)).toBeNull();
  });

  it('integrates speed ramps for the mean speed', () => {
    const ramp = {
      points: [
        { at: RationalTime.of(0, rate), speed: 1 },
        { at: RationalTime.of(10, rate), speed: 3 },
      ],
      curve: 'linear' as const,
    };
    // 10 frames averaging 2, then 10 frames at 3.
    expect(meanSpeed(ramp, 20, rate)).toBeCloseTo(2.5);
    expect(meanSpeed({ ...ramp, curve: 'hold' }, 20, rate)).toBeCloseTo(2);
    expect(meanSpeed(null, 20, rate)).toBe(1);
  });
});

describe('planQa', () => {
  it('lists hard cuts with their beats, intended dark ranges, cue probes and audio windows', () => {
    const timeline = makeTimeline({
      beatMap: beatMapOf([1000, 2000]),
      items: [
        { frames: 30 },
        { frames: 30, beat: { beatIndex: 0 } },
        { frames: 30, transition: { kind: 'fade', inFrames: 3, outFrames: 3 }, beat: { beatIndex: 1 } },
        { gap: 10 },
      ],
      captions: captionTrackOf(rate, [[0, 30, 'hello there friends']], { highlight: 'pop' }),
    });
    const plan = planTimeline(timeline);
    if (!plan.ok) throw new Error(plan.error.code);
    const qa = planQa(plan.value, presetFor('device'));
    expect(qa.cuts).toEqual([expect.objectContaining({ frame: 30, beat: { beatIndex: 0, frame: 30 } })]);
    expect(qa.anchors).toEqual([
      expect.objectContaining({ frame: 30, beatFrame: 30 }),
      expect.objectContaining({ frame: 60, beatFrame: 60 }),
    ]);
    expect(qa.intendedDark).toEqual([
      { start: 57, end: 63 },
      { start: 90, end: 100 },
    ]);
    expect(qa.cues[0]!.probeFrames).toEqual([3, 13, 15, 23]);
    expect(qa.audio.silent).toBe(false);
    expect(qa.audio.windows.map((window) => window.startFrame)).toEqual([3, 30 + 3, 57 + 3]);
  });

  it('marks a platform-sound export with every clip muted as silent on purpose', () => {
    const timeline = makeTimeline({ items: [{ frames: 30, muted: true }] });
    const plan = planTimeline(timeline);
    if (!plan.ok) throw new Error(plan.error.code);
    expect(planQa(plan.value, presetFor('shorts')).audio).toMatchObject({ silent: true, windows: [] });
  });

  it('marks darkly-graded clips and dark-backdrop compositions as intended dark and static', () => {
    const timeline = makeTimeline({ items: [{ frames: 60 }, { frames: 30 }] });
    const plan = planTimeline(timeline);
    if (!plan.ok) throw new Error(plan.error.code);
    const graded = {
      ...plan.value,
      visuals: plan.value.visuals.map((visual, index) =>
        index === 0
          ? {
              ...visual,
              grades: [
                {
                  exposure: -1.75,
                  contrast: 0.12,
                  highlights: -0.4,
                  saturation: -0.45,
                  temperature: 0,
                  tint: 0,
                  look: null,
                  lookStrength: 1,
                },
              ],
            }
          : visual,
      ),
    };
    const qa = planQa(graded, presetFor('shorts'));
    expect(qa.intendedDark).toEqual([{ start: 0, end: 60 }]);
    expect(qa.intendedStatic).toEqual([{ start: 0, end: 60 }]);
  });
});
