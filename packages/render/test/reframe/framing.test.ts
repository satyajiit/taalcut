// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { RationalTime, type ClipReframe } from '@taalcut/core';
import { REFRAME_CONFIG } from '../../src/reframe/config';
import { cropAt } from '../../src/reframe/crop-window';
import { planVisualFraming, type FramingInput } from '../../src/reframe/framing';
import { framingCoverage } from '../../src/reframe/subject-coverage';
import { RATE_30, noise, samplesEvery, trackOf } from './support';

const frames = 150;
const visual = (reframe: ClipReframe | null): FramingInput['visual'] => ({
  kind: 'video',
  reframe,
  visible: { start: 30, end: 30 + frames },
  cut: { start: 30, end: 30 + frames },
  sourceIn: RationalTime.zero(RATE_30),
  speed: null,
});
const auto: ClipReframe = { mode: 'auto', nudge: { x: 0, y: 0 }, scale: 1 };
const portrait = { width: 1080, height: 1920 };
const base = {
  source: { width: 1920, height: 1080 },
  canvas: portrait,
  safe: { x: 120, y: 288, width: 540, height: 672 },
  captionBandTop: null,
  rate: RATE_30,
  canvasChanged: false,
};

/** A face walking left to right over five seconds: x from 0.2 to 0.7 of the frame. */
const walkingFace = (t: number) => ({
  face: { x: 0.2 + 0.1 * t, y: 0.25, width: 0.08, height: 0.14 },
  human: { x: 0.18 + 0.1 * t, y: 0.2, width: 0.12, height: 0.7 },
});

describe('planVisualFraming', () => {
  it('leaves stills, same-aspect clips and reframe: null on the timeline canvas to fit', () => {
    expect(planVisualFraming({ ...base, visual: { ...visual(auto), kind: 'image' }, track: null })).toEqual({
      kind: 'fit',
    });
    expect(planVisualFraming({ ...base, source: portrait, visual: visual(auto), track: null })).toEqual({
      kind: 'fit',
    });
    expect(planVisualFraming({ ...base, visual: visual(null), track: null })).toEqual({ kind: 'fit' });
  });

  it('reframes reframe: null when the output canvas differs from the timeline', () => {
    const framing = planVisualFraming({ ...base, visual: visual(null), track: null, canvasChanged: true });
    expect(framing.kind).toBe('crop');
  });

  it('gives a centred crop with the noTrack reason without a subject track', () => {
    const framing = planVisualFraming({ ...base, visual: visual(auto), track: null });
    expect(framing.kind === 'crop' && framing.reason).toBe('noTrack');
    if (framing.kind !== 'crop') return;
    const rect = cropAt(framing.keys, 40);
    expect(rect.width).toBeCloseTo(0.31640625, 6);
    expect(rect.x + rect.width / 2).toBeCloseTo(0.5, 6);
  });

  it('follows a walking subject and keeps it in frame on at least 95 % of frames', () => {
    const track = trackOf(samplesEvery(12, 7, walkingFace), 7);
    const framing = planVisualFraming({ ...base, visual: visual(auto), track });
    expect(framing.kind === 'crop' && framing.reason).toBe('subject');
    const coverage = framingCoverage(framing, frames, (frame) => walkingFace(frame / 30).face);
    expect(coverage.share).toBeGreaterThanOrEqual(0.95);
    expect(coverage.counted).toBe(frames);
  });

  it('applies the punch-in to a same-aspect clip as a smaller window', () => {
    const framing = planVisualFraming({
      ...base,
      source: portrait,
      visual: visual({ mode: 'centre', nudge: { x: 0, y: -0.04 }, scale: 1.1 }),
      track: null,
    });
    expect(framing.kind).toBe('crop');
    if (framing.kind !== 'crop') return;
    expect(framing.scale).toBe(1.1);
    const rect = cropAt(framing.keys, 0);
    expect(rect.width).toBeCloseTo(1 / 1.1, 9);
    expect(rect.y + rect.height / 2).toBeCloseTo(0.5 - 0.04 / 1.1, 9);
    // A nudge past the edge is held inside the source.
    const edge = planVisualFraming({
      ...base,
      source: portrait,
      visual: visual({ mode: 'centre', nudge: { x: 0, y: -0.5 }, scale: 1.1 }),
      track: null,
    });
    expect(edge.kind === 'crop' && cropAt(edge.keys, 0).y).toBe(0);
  });

  it('pads a 9:16 talking head on a landscape canvas (the subject is too tall for the crop)', () => {
    const head = () => ({
      face: { x: 0.4, y: 0.2, width: 0.2, height: 0.1 },
      human: { x: 0.25, y: 0.12, width: 0.5, height: 0.85 },
    });
    const framing = planVisualFraming({
      ...base,
      source: portrait,
      canvas: { width: 1920, height: 1080 },
      safe: { x: 96, y: 54, width: 1728, height: 972 },
      visual: visual(null),
      canvasChanged: true,
      track: trackOf(samplesEvery(4, 6, head), 6),
    });
    expect(framing).toEqual({ kind: 'blurPad', reason: 'subjectTooTall' });
  });

  it('pads a wide static shot: no subject, or a small still one', () => {
    const tiny = () => ({ face: { x: 0.6, y: 0.3, width: 0.04, height: 0.07 } });
    expect(
      planVisualFraming({ ...base, visual: visual(auto), track: trackOf(samplesEvery(4, 6, tiny), 6) }),
    ).toEqual({
      kind: 'blurPad',
      reason: 'wideStatic',
    });
    const framing = planVisualFraming({
      ...base,
      visual: visual(auto),
      track: trackOf(
        samplesEvery(4, 6, () => ({})),
        6,
      ),
    });
    expect(framing).toEqual({ kind: 'blurPad', reason: 'wideStatic' });
  });

  it('eases to the centre after a second without a box, never snapping', () => {
    const lost = (t: number) => (t < 1 ? { face: { x: 0.8, y: 0.3, width: 0.08, height: 0.14 } } : {});
    const framing = planVisualFraming({
      ...base,
      visual: visual({ ...auto, mode: 'subject' }),
      track: trackOf(samplesEvery(12, 6, lost), 6),
    });
    expect(framing.kind).toBe('crop');
    if (framing.kind !== 'crop') return;
    const centres = Array.from({ length: frames }, (_, frame) => {
      const rect = cropAt(framing.keys, frame);
      return rect.x + rect.width / 2;
    });
    const maxStep = (REFRAME_CONFIG.maxSpeedCropsPerSecond * (framing.keys[0]?.rect.width ?? 0)) / 30;
    for (let frame = 1; frame < frames; frame++)
      expect(Math.abs((centres[frame] ?? 0) - (centres[frame - 1] ?? 0))).toBeLessThanOrEqual(maxStep + 1e-9);
    expect(centres[frames - 1]).toBeCloseTo(0.5, 2);
  });

  it('holds a still subject with detection noise exactly still', () => {
    const jitter = noise(11, 3 / 1920);
    const still = () => ({
      face: { x: 0.6 + jitter(), y: 0.3 + jitter(), width: 0.08, height: 0.14 },
      human: { x: 0.57 + jitter(), y: 0.25 + jitter(), width: 0.14, height: 0.7 },
    });
    const framing = planVisualFraming({
      ...base,
      visual: visual(auto),
      track: trackOf(samplesEvery(12, 7, still), 7),
    });
    if (framing.kind !== 'crop') throw new Error(`expected a crop, got ${framing.kind}`);
    const xs = new Set(framing.keys.map((key) => key.rect.x));
    expect(xs.size).toBe(1);
  });
});
