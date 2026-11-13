// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Transitions, speed ramps, audio kind, the contact-sheet layout and draft → template. */
import { describe, expect, it } from 'vitest';
import { FrameRate, RationalTime, templateSchema } from '@taalcut/core';
import {
  BREAKDOWN_CONFIG,
  buildAudioProfile,
  buildTemplate,
  classifyAudioKind,
  classifyTransition,
  detectSpeedRamp,
  envelopeWaveform,
  resolveCuts,
  sheetLayout,
  speechCoverage,
  tileFrames,
} from '../src/index';
import { energyShape, flattenedWaveform } from '../src/profiles/profile-parts';
import { json, sequentialIds } from './helpers/fixtures';
import { draftFixture } from './helpers/draft';
import { onsetEnvelope, QUIET } from './helpers/onset-envelope';

const config = BREAKDOWN_CONFIG;
const series = (from: number, to: number, value: (frame: number) => number) =>
  Array.from({ length: to - from }, (_, i) => ({ frame: from + i, value: value(from + i) }));

describe('transitions', () => {
  const cut = { frame: 46, start: 40, end: 51, distance: 0.6 };
  it('a luma dip is a fade, a motion peak a whip, otherwise a dissolve', () => {
    const dark = series(30, 60, (f) => (f >= 44 && f <= 47 ? 0.02 : 0.5));
    expect(classifyTransition(cut, { luma: dark }, config)).toMatchObject({
      kind: 'fade',
      before: 6,
      after: 6,
    });
    const whip = series(0, 100, (f) => (f >= 40 && f <= 51 ? 9 : 1));
    expect(classifyTransition(cut, { motion: whip }, config)?.kind).toBe('whip');
    expect(classifyTransition(cut, {}, config)?.kind).toBe('dissolve');
  });

  it('stays a plain cut when short or unsure', () => {
    expect(classifyTransition({ ...cut, start: 45, end: 46 }, {}, config)).toBeNull();
    expect(classifyTransition({ ...cut, distance: 0.1 }, {}, config)).toBeNull();
  });

  it('finds a sustained 2× change of motion confirmed by the frame difference', () => {
    const motion = series(0, 90, (f) => (f < 45 ? 1 : 2.5));
    const diff = series(0, 90, (f) => (f < 45 ? 0.5 : 1.5));
    const ramp = detectSpeedRamp({ start: 0, end: 90 }, motion, diff, 30, config.ramp);
    expect(ramp?.points).toEqual([
      { at: 0, speed: 1 },
      { at: 45, speed: 2.5 },
    ]);
    // Unconfirmed by the frame difference: no ramp.
    expect(
      detectSpeedRamp(
        { start: 0, end: 90 },
        motion,
        series(0, 90, () => 1),
        30,
        config.ramp,
      ),
    ).toBeNull();
    expect(detectSpeedRamp({ start: 0, end: 20 }, motion, diff, 30, config.ramp)).toBeNull();
  });
});

describe('audio kind', () => {
  const beats = (confidence: number) => ({
    rate: FrameRate.of(50),
    beats: [RationalTime.of(0, FrameRate.of(50)), RationalTime.of(25, FrameRate.of(50))],
    downbeats: [0],
    bpm: 120,
    beatsPerBar: 4,
    confidence,
    source: 'tracker' as const,
  });
  it.each([
    ['music', -14, beats(0.9), 0.05],
    ['voice', -18, null, 0.7],
    ['mixed', -14, beats(0.9), 0.4],
    ['original', -20, null, 0],
    ['silent', -65, null, 0],
    ['silent', null, null, 0],
  ] as const)('%s', (kind, integratedLufs, beatMap, speech) => {
    expect(classifyAudioKind({ integratedLufs, beatMap, speech }, config.audio)).toBe(kind);
  });

  it('measures speech coverage once over overlaps and keeps a profile within its limits', () => {
    expect(
      speechCoverage(
        [
          { startMs: 0, endMs: 600, text: 'a' },
          { startMs: 400, endMs: 1000, text: 'b' },
        ],
        2000,
      ),
    ).toBe(0.5);
    const profile = buildAudioProfile({
      integratedLufs: -16,
      beatMap: null,
      speech: { language: 'en', segments: [{ startMs: 0, endMs: 1500, text: ' hello ' }] },
      peaks: [0.2, 1.4],
      sound: null,
      durationMs: 2000,
      config: config.audio,
    });
    expect(profile).toMatchObject({
      kind: 'voice',
      speech: { coverage: 0.75, segments: [{ text: 'hello' }] },
    });
    expect(profile.waveform?.peaks).toEqual([0.2, 1]);
  });

  it('keeps the shape of the tracker’s onset envelope, scaled to its loudest frame (REF1, gate finding 7)', () => {
    const envelope = onsetEnvelope();
    // The clamp this replaces: nearly every frame read 1.
    expect(envelope.filter((value) => Math.min(1, value) === 1).length / envelope.length).toBeGreaterThan(
      0.95,
    );
    const peaks = envelopeWaveform(envelope);
    expect(peaks).toHaveLength(envelope.length);
    const max = Math.max(...envelope);
    peaks.forEach((peak, frame) => expect(peak).toBeCloseTo(envelope[frame]! / max, 12));
    expect(peaks.filter((peak) => peak === 1).length).toBeLessThan(envelope.length * 0.02);
    const mean = (from: number, to: number) =>
      peaks.slice(from, to).reduce((sum, peak) => sum + peak, 0) / (to - from);
    expect(mean(QUIET.from, QUIET.to)).toBeLessThan(mean(0, QUIET.from) / 3);
    // The profile keeps it as it is, and the style profile reads a shape from it, the quiet bridge included.
    const profile = buildAudioProfile({
      integratedLufs: -14,
      beatMap: null,
      speech: null,
      peaks,
      sound: null,
      durationMs: 8000,
      config: config.audio,
    });
    expect(profile.waveform?.peaks).toEqual(peaks);
    const shape = energyShape(peaks)!;
    expect(Math.min(...shape)).toBeLessThan(0.5);
    expect(shape.indexOf(Math.min(...shape))).toBe(Math.floor((QUIET.from / envelope.length) * 10));
    expect(envelopeWaveform([0, 0, Number.NaN, -1])).toEqual([0, 0, 0, 0]);
  });

  it('reads no energy from a waveform flattened before the fix', () => {
    const flattened = onsetEnvelope().map((value) => Math.min(1, Math.max(0, value)));
    expect(flattenedWaveform(flattened)).toBe(true);
    expect(energyShape(flattened)).toBeNull();
    expect(flattenedWaveform(envelopeWaveform(onsetEnvelope()))).toBe(false);
  });
});

describe('contact sheet', () => {
  it('lays tiles out at most 10 by 10, 180 px on the long side', () => {
    expect(sheetLayout(4, { width: 1080, height: 1920 }, config.contactSheet)).toEqual({
      columns: 2,
      rows: 2,
      tileWidth: 102,
      tileHeight: 180,
    });
    expect(sheetLayout(60, { width: 1920, height: 1080 }, config.contactSheet)).toMatchObject({
      columns: 8,
      rows: 8,
      tileWidth: 180,
    });
    expect(
      tileFrames(
        [
          { start: 0, end: 10 },
          { start: 10, end: 13 },
        ],
        60,
      ),
    ).toEqual([4, 11]);
    expect(
      tileFrames(
        Array.from({ length: 120 }, (_, i) => ({ start: i, end: i + 1 })),
        60,
      ),
    ).toHaveLength(60);
  });
});

describe('draft → slots → template', () => {
  it('confirmed cuts stay; disputes follow the verdict, else the rule', () => {
    const draft = draftFixture();
    const byRule = resolveCuts(draft, []);
    expect(byRule.cuts.map((cut) => [cut.frame, cut.method])).toEqual([
      [30, 'both'],
      [45, 'rule'],
      [90, 'both'],
    ]);
    expect(byRule.unconfirmed).toEqual([45]);
    const judged = resolveCuts(draft, [
      { at: 46, cut: false },
      { at: 70, cut: true },
    ]);
    expect(judged.cuts.map((cut) => [cut.frame, cut.method])).toEqual([
      [30, 'both'],
      [70, 'vision'],
      [90, 'both'],
    ]);
  });

  it('a one-frame shot merges into its neighbour unless both methods found both cuts', () => {
    const draft = draftFixture();
    draft.cuts.push({ frame: 31, method: 'scdet', score: 30, distance: null, transition: null });
    expect(resolveCuts(draft, []).cuts.map((cut) => cut.frame)).toEqual([30, 45, 90]);
    draft.cuts[draft.cuts.length - 1] = {
      frame: 31,
      method: 'both',
      score: 40,
      distance: 0.9,
      transition: null,
    };
    expect(resolveCuts(draft, []).cuts.map((cut) => cut.frame)).toEqual([30, 31, 45, 90]);
  });

  it('builds a valid version 1 with analyst and pending intents, anchors, a dissolve and the sheet', () => {
    const draft = draftFixture();
    const built = buildTemplate(
      draft,
      [{ at: 70, cut: true }],
      [
        {
          slotIndex: 0,
          intent: {
            text: 'face close-up',
            shotType: 'close',
            motion: 'push-in',
            subject: 'host',
            people: 1,
            place: null,
            energy: 0.9,
          },
        },
      ],
      sequentialIds(),
      { createdAt: 5, contactSheetAsset: 'b'.repeat(64) },
    );
    expect(built.ok).toBe(true);
    const template = built.ok ? built.value : (undefined as never);
    expect(templateSchema.safeParse(json(template)).success).toBe(true);
    expect(
      template.slots.map((slot) => [
        slot.start.value,
        slot.duration.value,
        slot.cut.method,
        slot.intent.source,
      ]),
    ).toEqual([
      [0, 30, 'rule', 'analyst'],
      [30, 15, 'both', 'pending'],
      [45, 25, 'rule', 'pending'],
      [70, 20, 'vision', 'pending'],
      [90, 30, 'both', 'pending'],
    ]);
    expect(template.slots[3]!.transitionIn).toMatchObject({
      kind: 'dissolve',
      before: { value: 5 },
      after: { value: 6 },
    });
    expect(template.slots.map((slot) => slot.beatAnchor?.beatIndex)).toEqual([0, 2, 3, 5, 6]);
    expect(template.text[0]!.slotId).toBe(template.slots[1]!.id);
    expect(template.contactSheet?.asset).toBe('b'.repeat(64));
    expect(template.slots.map((slot) => slot.frame)).toEqual([0, 1, 2, null, 3]);
    // The reel's link as intake keeps it (REF1): the bare /reel/<id>/.
    expect(template.origin).toMatchObject({
      kind: 'reference',
      url: 'https://www.instagram.com/reel/abc/',
      pipelineVersion: '1',
    });
    // Without a stored sheet, no tiles.
    const bare = buildTemplate(draft, [], [], sequentialIds(), { createdAt: 5 });
    expect(bare.ok && bare.value.contactSheet).toBeNull();
  });
});
