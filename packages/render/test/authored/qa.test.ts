// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { newId, RationalTime, unwrap } from '@taalcut/core';
import { createAuthoredTimeline } from '@taalcut/timeline';
import { planQa } from '../../src/plan/qa-plan';
import { planTimeline } from '../../src/plan/render-plan';
import { presetFor } from '../../src/presets/presets.v1';
import { graphicsQaModule, graphicFrames } from '../../src/qa/modules/graphics';
import type { ProbedTextBox } from '../../src/types';
import { runInput } from '../qa/support';
import { authoredFixture } from './support';
import { textBoxesOf } from '../../src/engine/stills';

const wanted = new Set(['graphicsSafeZone', 'graphicsOverlap', 'graphicsReadability'] as const);
function plan() {
  const program = authoredFixture();
  const time = (seconds: number) => RationalTime.of(seconds * 60, program.canvas.rate);
  program.chapters = [
    { id: 'open', name: 'Opening', start: time(0), duration: time(10) },
    { id: 'demo', name: 'Demo', start: time(10), duration: time(20) },
  ];
  const timeline = unwrap(createAuthoredTimeline({ projectId: newId<'Project'>(), program, name: 'Launch' }));
  const preset = {
    ...presetFor('device'),
    width: 1920,
    height: 1080,
    safe: { x: 100, y: 100, width: 1720, height: 880 },
  };
  return { plan: planQa(unwrap(planTimeline(timeline)), preset), preset };
}

async function check(words: 'safe' | 'outside' | 'none') {
  const fixture = plan();
  const frames = graphicFrames(fixture.plan);
  const id = fixture.plan.graphics![0]!.programItemId!;
  const boxes: ProbedTextBox[] = frames.map((frame) => ({
    kind: 'graphic',
    id,
    frame,
    box: { x: 0, y: 0, width: 1920, height: 1080 },
    lines: words === 'none' ? 0 : 1,
    overflow: false,
    fontsReady: true,
    color: '#ffffff',
    ...(words === 'none'
      ? {}
      : { minFontPx: 100, textBounds: { x: words === 'safe' ? 200 : 10, y: 200, width: 500, height: 100 } }),
  }));
  const run = { ...runInput('/unused.mp4', fixture.plan), preset: fixture.preset };
  return graphicsQaModule.run({ run, facts: {}, probed: { boxes, visuals: [] } }, wanted);
}

describe('authored chapter QA', () => {
  it('returns words rather than backgrounds to the production frame reviewer', () => {
    const background: ProbedTextBox = {
      kind: 'graphic',
      id: 'program',
      frame: 1,
      program: true,
      box: { x: 0, y: 0, width: 1920, height: 1080 },
      lines: 0,
      overflow: false,
      fontsReady: true,
      color: '#ffffff',
    };
    const safe = { x: 100, y: 100, width: 1720, height: 880 };
    expect(textBoxesOf([background], safe)).toEqual([]);
    expect(
      textBoxesOf(
        [{ ...background, lines: 1, textBounds: { x: 200, y: 200, width: 800, height: 100 } }],
        safe,
      ),
    ).toMatchObject([{ inSafeZone: true, box: { width: 800 } }]);
  });
  it('samples every chapter throughout its motion and near its handoff', () => {
    const fixture = plan();
    expect(fixture.plan.graphics).toHaveLength(2);
    const frames = graphicFrames(fixture.plan);
    expect(frames).toHaveLength(10);
    expect(frames.some((frame) => frame > 570 && frame < 600)).toBe(true);
    expect(frames.some((frame) => frame > 1770)).toBe(true);
  });

  it('measures typography without treating a fullframe background as a safe-zone violation', async () => {
    const results = await check('safe');
    expect(results.map((result) => result.status)).toEqual(['pass', 'pass', 'pass']);
    expect((await check('none')).map((result) => result.status)).toEqual(['pass', 'pass', 'pass']);
  });

  it('fails words outside the safe area and does not pass a missing probe', async () => {
    expect((await check('outside')).find((result) => result.id === 'graphicsSafeZone')?.status).toBe('fail');
    const fixture = plan();
    const run = {
      ...runInput('/unused.mp4', fixture.plan),
      probeFrame: async () => {
        throw new Error('capture unavailable');
      },
    };
    const results = await graphicsQaModule.run({ run, facts: {}, probed: null }, wanted);
    expect(results.every((result) => result.status === 'fail')).toBe(true);
  });
});
