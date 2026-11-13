// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import {
  CAPTION_COMMANDS,
  captionCommandPayloads,
  newId,
  RationalTime,
  TIMELINE_COMMANDS,
  timelineCommandPayloads,
  type ClipReframe,
} from '@taalcut/core';
import {
  captionCoversFaceCheck,
  cropJitterCheck,
  facesOnCanvasAt,
  subjectInFrameCheck,
  type ReframedClip,
  type ReframeQaInput,
} from '../../src/qa/checks/reframe';
import { cropAt } from '../../src/reframe/crop-window';
import { planVisualFraming } from '../../src/reframe/framing';
import type { CropKey, SourceRect, VisualFraming } from '../../src/reframe/framing-types';
import { framingStyle } from '../../src/reframe/keyframes';
import type { ProbedTextBox, ProbedVisual } from '../../src/types';
import { RATE_30, samplesEvery, trackOf } from './support';

const target = { projectId: newId<'Project'>(), timelineId: newId<'Timeline'>() };
const canvas = { width: 1080, height: 1920 };
const source = { width: 1920, height: 1080 };
const whole = { x: 0, y: 0, width: 1, height: 1 };
const W = 0.31640625;
const auto: ClipReframe = { mode: 'auto', nudge: { x: 0.1, y: 0 }, scale: 1 };

type Crop = Extract<VisualFraming, { kind: 'crop' }>;
function crop(keys: CropKey[], subject: (SourceRect | null)[], faces = subject): Crop {
  return { kind: 'crop', reason: 'subject', keys, subject, scale: 1, faces, raw: keys.map(() => null) };
}

const clip = (framing: VisualFraming, visible = { start: 0, end: 60 }): ReframedClip => ({
  clipId: newId<'TimelineItem'>(),
  visible,
  framing,
  reframe: auto,
  source,
  extent: whole,
});
const input = (clips: ReframedClip[], extra: Partial<ReframeQaInput> = {}): ReframeQaInput => ({
  clips,
  canvas,
  rate: RATE_30,
  target,
  ...extra,
});

const still = (x: number): CropKey[] => [
  { frame: 0, rect: { x, y: 0, width: W, height: 1 } },
  { frame: 60, rect: { x, y: 0, width: W, height: 1 } },
];
const face = { x: 0.45, y: 0.3, width: 0.08, height: 0.14 };

describe('subjectInFrame', () => {
  it('passes when the subject stays inside the crop', () => {
    const result = subjectInFrameCheck(input([clip(crop(still(0.35), [face, face]))]));
    expect(result.status).toBe('pass');
    expect(result.measured).toEqual({ value: 100, unit: 'percent' });
  });

  it('fails a clip whose subject is out of frame, with the blurred-pad command fix', () => {
    const result = subjectInFrameCheck(input([clip(crop(still(0.0), [face, face]))]));
    expect(result.status).toBe('fail');
    expect(result.findings[0]?.measured).toEqual({ value: 0, unit: 'percent' });
    const fix = result.fixes[0];
    expect(fix?.kind === 'command' && fix.command).toBe(TIMELINE_COMMANDS.setReframe);
    if (fix?.kind !== 'command') return;
    const payload = timelineCommandPayloads[TIMELINE_COMMANDS.setReframe].parse(fix.payload);
    expect(payload.reframe).toEqual({ mode: 'blurPad', nudge: { x: 0, y: 0 }, scale: 1 });
  });

  it('skips renders without a subject to count (blurred pads, fits, no boxes)', () => {
    expect(subjectInFrameCheck(input([clip({ kind: 'blurPad', reason: 'wideStatic' })])).status).toBe(
      'skipped',
    );
    expect(subjectInFrameCheck(input([clip(crop(still(0.3), [null, null]))])).status).toBe('skipped');
  });

  it('accepts a probe that matches the plan and fails one that drifts by more than 1 px', () => {
    const framing = crop(still(0.35), [face, face]);
    const planned = clip(framing);
    const style = framingStyle({
      elementId: 'v-x',
      framing,
      extent: whole,
      canvas,
      sourceAspect: 16 / 9,
      visible: planned.visible,
      rate: RATE_30,
    });
    const position = /object-position: ([^;]+);/.exec(style.css[0] ?? '')?.[1] ?? '';
    const probe = (objectPosition: string): ProbedVisual => ({
      id: planned.clipId,
      frame: 15,
      objectPosition,
      scale: 'none',
      transformOrigin: '540px 960px',
      opacity: 1,
    });
    expect(subjectInFrameCheck(input([planned], { probed: [probe(position)] })).status).toBe('pass');
    const drifted = subjectInFrameCheck(input([planned], { probed: [probe('60% 50%')] }));
    expect(drifted.status).toBe('fail');
    expect(drifted.findings[0]?.measured?.unit).toBe('px');
    // Inside a transition the probe isn't the crop's: not compared.
    expect(
      subjectInFrameCheck(
        input([planned], { probed: [probe('60% 50%')], transitions: [{ start: 10, end: 20 }] }),
      ).status,
    ).toBe('pass');
  });
});

describe('cropJitter', () => {
  it('passes a planned path of a walking subject', () => {
    const walk = (t: number) => ({
      face: { x: 0.15 + 0.1 * t, y: 0.3, width: 0.08, height: 0.14 },
      human: { x: 0.13 + 0.1 * t, y: 0.25, width: 0.14, height: 0.7 },
    });
    const framing = planVisualFraming({
      visual: {
        kind: 'video',
        reframe: auto,
        visible: { start: 0, end: 150 },
        cut: { start: 0, end: 150 },
        sourceIn: RationalTime.zero(RATE_30),
        speed: null,
      },
      source,
      canvas,
      safe: { x: 120, y: 288, width: 540, height: 672 },
      captionBandTop: null,
      track: trackOf(samplesEvery(12, 6, walk), 6),
      rate: RATE_30,
      canvasChanged: false,
    });
    const result = cropJitterCheck(input([clip(framing, { start: 0, end: 150 })]));
    expect(result.status).toBe('pass');
    expect(result.measured).toEqual({ value: 0, unit: 'count' });
  });

  it('fails a wobbling path with the centre-crop fix that keeps the nudge', () => {
    const keys: CropKey[] = Array.from({ length: 13 }, (_, index) => ({
      frame: index * 5,
      rect: { x: 0.3 + (index % 2) * 0.002, y: 0, width: W, height: 1 },
    }));
    const result = cropJitterCheck(
      input([
        clip(
          crop(
            keys,
            keys.map(() => face),
          ),
        ),
      ]),
    );
    expect(result.status).toBe('fail');
    const fix = result.fixes[0];
    if (fix?.kind !== 'command') throw new Error('expected a command fix');
    expect(timelineCommandPayloads[TIMELINE_COMMANDS.setReframe].parse(fix.payload).reframe).toEqual({
      mode: 'centre',
      nudge: { x: 0.1, y: 0 },
      scale: 1,
    });
  });

  it('skips when nothing moves', () => {
    expect(cropJitterCheck(input([clip({ kind: 'fit' })])).status).toBe('skipped');
  });
});

describe('captionCoversFace', () => {
  const framing = crop(still(0.3), [face, face]);
  const faceOnCanvas = facesOnCanvasAt([clip(framing)], 30, canvas)[0];
  const cueBox = (y: number): ProbedTextBox => ({
    kind: 'caption',
    id: 'cue-1',
    frame: 30,
    box: { x: 150, y, width: 780, height: 140 },
    lines: 2,
    overflow: false,
    fontsReady: true,
    color: '#ffffff',
  });
  const safe = { x: 120, y: 288, width: 840, height: 1300 };

  it('maps the face through the crop onto the canvas', () => {
    expect(faceOnCanvas?.x).toBe(Math.floor(((0.45 - 0.3) / W) * 1080));
    expect(cropAt(framing.keys, 30).x).toBe(0.3);
  });

  it('fails a cue over a face, with an anchor fix that clears it', () => {
    const y = faceOnCanvas?.y ?? 0;
    const result = captionCoversFaceCheck({ ...input([clip(framing)]), captions: [cueBox(y)], safe });
    expect(result.status).toBe('fail');
    const fix = result.fixes[0];
    if (fix?.kind !== 'command') throw new Error('expected a command fix');
    expect(fix.command).toBe(CAPTION_COMMANDS.setStyle);
    const { style } = captionCommandPayloads[CAPTION_COMMANDS.setStyle].parse(fix.payload);
    const top = (style.anchorY ?? 0) * 1920 - 70;
    expect(top).toBeGreaterThanOrEqual((faceOnCanvas?.y ?? 0) + (faceOnCanvas?.height ?? 0));
  });

  it('passes a cue clear of the face, and skips without captions', () => {
    const clear = captionCoversFaceCheck({ ...input([clip(framing)]), captions: [cueBox(1500)], safe });
    expect(clear.status).toBe('pass');
    expect(captionCoversFaceCheck({ ...input([clip(framing)]), captions: [], safe }).status).toBe('skipped');
  });
});
