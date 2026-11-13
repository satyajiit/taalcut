// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-QA: captionSafeZone on a text item hands back the nearest box that passes, as a ready timeline.moveText, so
 * one fix round clears it. The probe measures the text as laid out, not the item's box: a right-aligned title sits
 * at its box's right edge, words wrapped in a narrow box run below it. `layout` below lays a made-up title out the
 * way render's CSS does (the box's left, top and width; height auto; text-align), so applying the fix and measuring
 * again is what the next draft's QA would see.
 */
import { describe, expect, it } from 'vitest';
import {
  TIMELINE_COMMANDS,
  newId,
  timelineCommandPayloads,
  type Box,
  type QaFix,
  type Rect,
  type TextTrackItem,
} from '@taalcut/core';
import { adaptPlan } from '../../src/plan/canvas';
import { planTimeline } from '../../src/plan/render-plan';
import { planQa } from '../../src/plan/qa-plan';
import { presetFor, safeRectFor } from '../../src/presets/presets.v1';
import { captionSafeZoneCheck } from '../../src/qa/checks/captions';
import { planTextMove } from '../../src/qa/text-move';
import type { ProbedTextBox } from '../../src/types';
import { makeTimeline } from '../support/timeline';
import { qaPlan, target } from './support';

const CANVAS = { width: 1080, height: 1920 };
/** Explicit cross-post rect: x 120–780, y 288–1248 (Shorts ∩ Reels ∩ TikTok). */
const SAFE = safeRectFor([]);
const ID = newId<'TimelineItem'>();

type Align = 'left' | 'center' | 'right';

/** The text's laid-out rect for `box`: `text` pixels wide and tall, placed by the alignment, from the box's top. */
function layout(box: Box, align: Align, text: { width: number; height: number }): Rect {
  const left = box.x * CANVAS.width;
  const width = box.width * CANVAS.width;
  const x =
    align === 'left' ? left : align === 'right' ? left + width - text.width : left + (width - text.width) / 2;
  return {
    x: Math.floor(x),
    y: Math.floor(box.y * CANVAS.height),
    width: Math.ceil(text.width),
    height: Math.ceil(text.height),
  };
}

const probed = (rect: Rect, frame = 40): ProbedTextBox => ({
  kind: 'text',
  id: ID,
  frame,
  box: rect,
  lines: 1,
  overflow: false,
  fontsReady: true,
  color: '#ffffff',
});

function check(box: Box, align: Align, rects: readonly Rect[]) {
  const plan = qaPlan({ texts: [{ id: ID, span: { start: 20, end: 60 }, probeFrame: 40, box, align }] });
  return captionSafeZoneCheck({
    plan,
    captions: null,
    boxes: rects.map((rect, i) => probed(rect, 30 + i)),
    safe: SAFE,
    target,
  });
}

/** The fix's box, after checking it is a ready timeline.moveText the Reviewer's check accepts. */
function movedBox(fixes: readonly QaFix[]): Box {
  expect(fixes).toHaveLength(1);
  const fix = fixes[0]!;
  if (fix.kind !== 'command') throw new Error(`expected a ready command, got an ${fix.kind} fix`);
  expect(fix.command).toBe(TIMELINE_COMMANDS.moveText);
  expect(fix.labelKey).toBe('qa.fixes.moveText');
  const payload = timelineCommandPayloads[TIMELINE_COMMANDS.moveText].parse(fix.payload);
  expect(payload).toMatchObject({ ...target, itemId: ID });
  return payload.box;
}

describe('captionSafeZone on a text item (FIX-QA)', () => {
  it('moves a right-aligned title off the action rail in one round, keeping its size', () => {
    // A box running to x 842 on a 1080-wide frame: its words end there, 62 px past the rect’s 780.
    const box = { x: 0.5, y: 0.5, width: 0.28, height: 0.03 };
    const text = { width: 210, height: 52 };
    const first = check(box, 'right', [layout(box, 'right', text)]);
    expect(first.status).toBe('fail');
    expect(first.measured?.value).toBe(60);
    const moved = movedBox(first.fixes);
    expect(moved.width).toBeCloseTo(box.width, 4);
    expect(moved.y).toBeCloseTo(box.y, 4);
    // The nearest place: its right edge just inside the rect, not somewhere in the middle.
    expect((moved.x + moved.width) * 1080).toBeGreaterThan(SAFE.x + SAFE.width - 8);
    expect(check(moved, 'right', [layout(moved, 'right', text)]).status).toBe('pass');
  });

  it('lifts words wrapped into a column below the rect by what they overrun, not by the box', () => {
    // A box 65 px wide holding a title that wrapped into a column: the box is inside, its text runs 40 px below.
    const box = { x: 0.58, y: 0.5, width: 0.06, height: 0.025 };
    const text = { width: 60, height: 1248 + 40 - 960 };
    const first = check(box, 'right', [layout(box, 'right', text)]);
    expect(first.status).toBe('fail');
    const moved = movedBox(first.fixes);
    expect(moved.x).toBeCloseTo(box.x, 4);
    expect(moved.y).toBeLessThan(box.y);
    expect(check(moved, 'right', [layout(moved, 'right', text)]).status).toBe('pass');
  });

  it('narrows a box wider than the rect and keeps every frame the probe read inside', () => {
    const box = { x: 0.02, y: 0.08, width: 0.96, height: 0.05 };
    const text = { width: 520, height: 90 };
    // The text reveals word by word: a narrower rect at the first frame, the whole line later.
    const rects = [layout(box, 'center', { width: 300, height: 90 }), layout(box, 'center', text)];
    const first = check(box, 'center', rects);
    expect(first.status).toBe('fail');
    const moved = movedBox(first.fixes);
    expect(moved.width * 1080).toBeLessThanOrEqual(SAFE.width);
    expect(moved.x * 1080).toBeGreaterThanOrEqual(SAFE.x);
    const after = [layout(moved, 'center', { width: 300, height: 90 }), layout(moved, 'center', text)];
    expect(check(moved, 'center', after).status).toBe('pass');
  });

  it('centres text that can never fit, and leaves the Editor its judgment when the plan has no box', () => {
    const huge = planTextMove({
      box: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 },
      align: 'left',
      probed: [{ x: 108, y: 192, width: 540, height: 1100 }],
      safe: SAFE,
      canvas: CANVAS,
    });
    const top = huge.y * 1920;
    expect(top + 1100 - (SAFE.y + SAFE.height)).toBeCloseTo(SAFE.y - top, 0);
    // Refitted onto another canvas: the drawn box isn't the item's own, so no ready box.
    const plan = qaPlan({ texts: [{ id: ID, span: { start: 20, end: 60 }, probeFrame: 40 }] });
    const result = captionSafeZoneCheck({
      plan,
      captions: null,
      boxes: [probed({ x: 700, y: 900, width: 200, height: 50 })],
      safe: SAFE,
      target,
    });
    expect(result.fixes).toEqual([
      { kind: 'agent', instructionKey: 'qa.fixes.moveText', params: { textId: ID } },
    ]);
  });

  it("carries the timeline item's box and alignment into the QA plan, except when refitted for another canvas", () => {
    const timeline = makeTimeline({
      items: [{ frames: 60 }],
      texts: [{ start: 0, frames: 60, text: 'Made up' }],
    });
    const box = { x: 0.5, y: 0.4, width: 0.3, height: 0.05 };
    const tracks = timeline.tracks.map((track) =>
      track.kind !== 'text'
        ? track
        : {
            ...track,
            items: track.items.map((item): TextTrackItem =>
              item.type === 'text'
                ? { ...item, box, appearance: { ...item.appearance, align: 'right' } }
                : item,
            ),
          },
    );
    const plan = planTimeline({ ...timeline, tracks });
    if (!plan.ok) throw new Error(plan.error.code);
    expect(planQa(plan.value, presetFor('device')).texts[0]).toMatchObject({ box, align: 'right' });
    const landscape = planTimeline({ ...timeline, tracks });
    if (!landscape.ok) throw new Error(landscape.error.code);
    expect(
      planQa(adaptPlan(landscape.value, presetFor('landscape')), presetFor('landscape')).texts[0]?.box,
    ).toBeUndefined();
  });
});
