// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-OVL's graphicCoversFace: every text item is checked against every clip's heads on every probed
 * frame of its time (four a second and its last frame), whether or not a clip was reframed. A covered head fails
 * and may be overridden, as captionCoversFace; a clip with no subject track warns, never passes silently; no
 * probe with items on screen fails.
 */
import { describe, expect, it } from 'vitest';
import { FrameRate, type Rect } from '@taalcut/core';
import {
  FACE_COVER_THRESHOLDS,
  faceBoxesDump,
  faceProbeFrames,
  graphicCoversFaceCheck,
  type FaceBoxesDump,
} from '../../src/qa/checks/faces';
import { facesQaModule } from '../../src/qa/modules/faces';
import { QA_MODULES } from '../../src/qa/modules';
import { checkMeta } from '../../src/qa/result';
import type { ProbedTextBox } from '../../src/types';
import { qaPlan, runInput } from './support';

const head: Rect = { x: 400, y: 500, width: 260, height: 300 };
const probedAt = (
  id: string,
  frame: number,
  box: Rect,
  kind: 'graphic' | 'text' = 'graphic',
): ProbedTextBox => ({
  kind,
  id,
  frame,
  box,
  lines: 1,
  overflow: false,
  fontsReady: true,
  color: '#111111',
});
const over = { x: 450, y: 600, width: 300, height: 120 };
const clear = { x: 150, y: 1000, width: 300, height: 120 };
const items = [
  { id: 'bubble', span: { start: 0, end: 30 } },
  { id: 'title', span: { start: 15, end: 45 } },
];
const everywhere = () => [head];

describe('graphicCoversFace', () => {
  it('reads four frames a second over each item and its last frame', () => {
    expect(faceProbeFrames([{ id: 'a', span: { start: 0, end: 30 } }], FrameRate.of(30))).toEqual([
      0, 8, 16, 24, 29,
    ]);
    expect(FACE_COVER_THRESHOLDS.framesPerSecond).toBeGreaterThanOrEqual(4);
  });

  it('fails a graphic or a text item over a head, naming it and its frames', () => {
    const boxes = [
      probedAt('bubble', 0, clear),
      probedAt('bubble', 8, over),
      probedAt('title', 16, over, 'text'),
    ];
    const result = graphicCoversFaceCheck({ items, boxes, heads: everywhere, clips: 1, tracked: 1 });
    expect(result.status).toBe('fail');
    expect(result.measured).toEqual({ value: 2, unit: 'frames' });
    expect(result.findings.map((finding) => finding.target)).toEqual([
      { kind: 'text', id: 'bubble' },
      { kind: 'text', id: 'title' },
    ]);
  });

  it('passes items clear of every head, and ignores a head that is gone by then', () => {
    const boxes = [probedAt('bubble', 0, clear), probedAt('title', 30, over, 'text')];
    const heads = (frame: number) => (frame < 20 ? [head] : []);
    expect(graphicCoversFaceCheck({ items, boxes, heads, clips: 2, tracked: 2 }).status).toBe('pass');
  });

  it('a box only touching a head (rounding) is clear', () => {
    const touching = { x: head.x + head.width - 1, y: head.y, width: 200, height: 100 };
    const boxes = [probedAt('bubble', 0, touching)];
    expect(graphicCoversFaceCheck({ items, boxes, heads: everywhere, clips: 1, tracked: 1 }).status).toBe(
      'pass',
    );
  });

  it('warns when a clip had no subject track, never a silent pass', () => {
    const result = graphicCoversFaceCheck({
      items,
      boxes: [probedAt('bubble', 0, clear)],
      heads: everywhere,
      clips: 3,
      tracked: 2,
    });
    expect(result.status).toBe('warn');
    expect(result.findings[0]).toEqual({
      target: { kind: 'file', id: 'subjectTrack' },
      measured: { value: 1, unit: 'count' },
    });
  });

  it('is skipped with nothing on screen, and may be overridden like captionCoversFace', () => {
    expect(
      graphicCoversFaceCheck({ items: [], boxes: [], heads: everywhere, clips: 1, tracked: 1 }).status,
    ).toBe('skipped');
    expect(checkMeta('graphicCoversFace')).toMatchObject({ overridable: true, preflight: false });
    expect(checkMeta('captionCoversFace')).toMatchObject({ overridable: true });
  });
});

describe('the faces module', () => {
  const plan = qaPlan({
    texts: [
      { id: 'bubble', span: { start: 0, end: 30 }, probeFrame: 15 },
      { id: 'title', span: { start: 15, end: 45 }, probeFrame: 20 },
    ],
  });
  const run = runInput('/nowhere.mp4', plan);
  const heads = { at: () => [head], clips: 1, tracked: 1 };
  const wanted = new Set(['graphicCoversFace'] as const);

  it('is in the gate, and asks the probe for every item’s frames on a render with no reframed clip', () => {
    expect(QA_MODULES).toContain(facesQaModule);
    const frames = facesQaModule.probeFrames({ run, facts: { heads } });
    expect(frames).toEqual(expect.arrayContaining([0, 8, 16, 24, 29, 15, 23, 31, 39, 44]));
  });

  it('fails a head under a text item, and fails without a probe', async () => {
    const probed = { boxes: [probedAt('bubble', 8, over, 'text')], visuals: [] };
    const [covered] = await facesQaModule.run({ run, facts: { heads }, probed }, wanted);
    expect(covered?.status).toBe('fail');
    const [blind] = await facesQaModule.run({ run, facts: { heads }, probed: null }, wanted);
    expect(blind?.status).toBe('fail');
  });

  it('hands a gate what it saw: each probed frame’s boxes and the heads around it', async () => {
    const dumps: FaceBoxesDump[] = [];
    const probed = {
      boxes: [
        probedAt('bubble', 8, over, 'text'),
        probedAt('title', 16, clear, 'text'),
        probedAt('cue', 8, over),
      ],
      visuals: [],
    };
    const watched = { ...run, onFaceBoxes: (dump: FaceBoxesDump) => void dumps.push(dump) };
    await facesQaModule.run({ run: watched, facts: { heads }, probed }, wanted);
    expect(dumps).toHaveLength(1);
    expect(dumps[0]?.frames).toEqual([
      { frame: 8, boxes: [{ id: 'bubble', kind: 'text', box: over }], heads: [head] },
      { frame: 16, boxes: [{ id: 'title', kind: 'text', box: clear }], heads: [head] },
    ]);
    expect(dumps[0]?.items.map((item) => item.id)).toEqual(['bubble', 'title']);
    expect(faceBoxesDump({ items: [], boxes: [], heads: () => [], clips: 0, tracked: 0 }).frames).toEqual([]);
  });

  it('a render without heads is unseen: it warns', async () => {
    const probed = { boxes: [probedAt('bubble', 8, over, 'text')], visuals: [] };
    const [result] = await facesQaModule.run({ run, facts: {}, probed }, wanted);
    expect(result?.status).toBe('warn');
  });
});
