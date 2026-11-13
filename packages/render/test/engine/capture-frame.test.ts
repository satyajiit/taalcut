// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * captureFrame's pure parts (stills.ts): what is on screen at a frame, the
 * still timeline, seek times, picture sizes, the preset layer and the text
 * boxes the contract returns.
 */
import { FrameRate, RationalTime } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  frameSeekSeconds,
  MAX_TEXT_BOXES,
  overlayFilters,
  scaledSize,
  stillSeconds,
  stillTimeline,
  textBoxesOf,
  visibleAt,
} from '../../src/engine/stills';
import { planTimeline } from '../../src/plan/render-plan';
import { presetFor } from '../../src/presets/presets.v1';
import type { ProbedTextBox } from '../../src/types';
import { captionTrackOf, makeTimeline } from '../support/timeline';

const rate = FrameRate.of(30);

function sample() {
  const timeline = makeTimeline({
    rate,
    items: [{ frames: 30 }, { frames: 30, transition: { kind: 'dissolve', inFrames: 5, outFrames: 5 } }],
    texts: [{ start: 10, frames: 20, text: 'Hi' }],
    captions: captionTrackOf(rate, [
      [0, 15, 'one two'],
      [15, 15, 'three four'],
    ]),
  });
  const plan = planTimeline(timeline);
  if (!plan.ok) throw new Error(plan.error.code);
  return { timeline, plan: plan.value };
}

const probed = (box: ProbedTextBox['box'], id = 'cue'): ProbedTextBox => ({
  kind: 'caption',
  id,
  frame: 0,
  box,
  lines: 1,
  overflow: false,
  fontsReady: true,
  color: '#ffffff',
});

describe('visibleAt', () => {
  it('lists the clips, cues and texts on screen, both clips inside a transition', () => {
    const { plan } = sample();
    const [first, second] = plan.visuals;
    expect(visibleAt(plan, 0)).toEqual({
      clips: [first!.id],
      captions: [plan.captions!.cues[0]!.id],
      texts: [],
    });
    const overlap = second!.visible.start;
    expect(overlap).toBeLessThan(first!.visible.end);
    expect(visibleAt(plan, overlap).clips).toEqual([first!.id, second!.id]);
    expect(visibleAt(plan, 12).texts).toEqual([plan.texts[0]!.id]);
    // Half-open: a cue ending at 15 is gone at 15.
    expect(visibleAt(plan, 15).captions).toEqual([plan.captions!.cues[1]!.id]);
    expect(visibleAt(plan, 59).clips).toEqual([second!.id]);
  });
});

describe('stillTimeline', () => {
  it('turns every video clip into a still of its asset and keeps ids and windows', () => {
    const { timeline, plan } = sample();
    const still = planTimeline(stillTimeline(timeline));
    if (!still.ok) throw new Error(still.error.code);
    expect(still.value.visuals.map((visual) => visual.kind)).toEqual(['image', 'image']);
    expect(still.value.visuals.map((visual) => [visual.id, visual.assetId, visual.visible])).toEqual(
      plan.visuals.map((visual) => [visual.id, visual.assetId, visual.visible]),
    );
    expect(still.value.texts).toEqual(plan.texts);
    expect(still.value.durationFrames).toBe(plan.durationFrames);
  });
});

describe('seek times', () => {
  it('reads a clip a quarter frame before the instant it shows', () => {
    const { plan } = sample();
    const visual = plan.visuals[0]!;
    const at = visual.visible.start + 3;
    expect(stillSeconds(visual, at, rate)).toBeCloseTo(
      RationalTime.toSeconds(visual.sourceIn) + 2.75 / 30,
      9,
    );
  });

  it('selects frame k of a file half a frame early, never before zero', () => {
    expect(frameSeekSeconds(0, rate)).toBe(0);
    expect(frameSeekSeconds(10, rate)).toBeCloseTo(9.5 / 30, 12);
    expect(frameSeekSeconds(10, FrameRate.of(30000, 1001))).toBeCloseTo((9.5 * 1001) / 30000, 12);
  });
});

describe('picture size and preset layer', () => {
  it('fits the long side, keeps even sizes and never enlarges', () => {
    const canvas = { width: 1080, height: 1920 };
    expect(scaledSize(canvas, 768)).toEqual({ width: 432, height: 768 });
    expect(scaledSize(canvas, 1920)).toEqual({ width: 1080, height: 1920 });
    expect(scaledSize(canvas, 100)).toEqual({ width: 56, height: 100 });
  });

  it('draws each overlay as a fill and the safe rect as an outline, scaled', () => {
    expect(overlayFilters(null, 1)).toEqual([]);
    const shorts = presetFor('shorts');
    const filters = overlayFilters(shorts, 0.5);
    expect(filters).toHaveLength(shorts.overlays.length + 1);
    expect(filters[0]).toBe('drawbox=x=0:y=0:w=540:h=144:color=black@0.35:t=fill');
    expect(filters.at(-1)).toBe('drawbox=x=24:y=144:w=420:h=480:color=0x22c55e@0.95:t=2');
  });
});

describe('textBoxesOf', () => {
  it('says whether each box sits inside the safe rect and caps the list', () => {
    const safe = presetFor('device').safe;
    const inside = probed({ x: safe.x + 10, y: safe.y + 10, width: 100, height: 50 });
    const outside = probed({ x: safe.x - 1, y: safe.y + 10, width: 100, height: 50 }, 'x'.repeat(80));
    const boxes = textBoxesOf([inside, outside], safe);
    expect(boxes.map((box) => box.inSafeZone)).toEqual([true, false]);
    expect(boxes[1]!.id).toHaveLength(64);
    expect(
      textBoxesOf(
        Array.from({ length: 40 }, () => inside),
        safe,
      ),
    ).toHaveLength(MAX_TEXT_BOXES);
  });
});
