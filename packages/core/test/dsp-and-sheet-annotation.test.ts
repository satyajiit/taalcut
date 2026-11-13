// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import {
  AUDIO_DSP_PRESETS,
  audioEffectChainSchema,
  captionPlacementAdviceSchema,
  contactSheetAnnotationOptionsSchema,
  frameVisualQaReportSchema,
  GROOVE_SUBDIVISIONS,
  grooveSubdivisionSchema,
  STEM_LOUDNESS_TARGETS,
  stemLoudnessReportSchema,
  SYNTH_SFX_CATEGORIES,
  synthSfxSpecSchema,
  tileAnnotationSchema,
} from '../src';

describe('audio DSP chain and loudness schemas', () => {
  it('validates Pedalboard-equivalent DSP chains and presets', () => {
    expect(AUDIO_DSP_PRESETS).toContain('voice-clarity');
    const parsed = audioEffectChainSchema.parse({
      preset: 'voice-clarity',
      nodes: [
        { kind: 'highpass', frequencyHz: 85 },
        { kind: 'compressor', thresholdDb: -18, ratio: 3 },
        { kind: 'equalizer', frequencyHz: 3200, gainDb: 2.5 },
        { kind: 'limiter', limitDb: -1.5 },
      ],
    });
    expect(parsed.preset).toBe('voice-clarity');
    expect(parsed.nodes).toHaveLength(4);
    expect(parsed.nodes[0]).toEqual({ kind: 'highpass', frequencyHz: 85, poles: 2 });
  });

  it('defines ITU-R BS.1770-4 stem loudness targets and validates reports', () => {
    expect(STEM_LOUDNESS_TARGETS.dialogue.targetLufs).toBe(-16);
    expect(STEM_LOUDNESS_TARGETS.master.targetLufs).toBe(-14);
    const report = stemLoudnessReportSchema.parse({
      role: 'dialogue',
      integratedLufs: -22.4,
      truePeakDbtp: -6.2,
      loudnessRangeLu: 5.8,
      momentaryMaxLufs: -17.1,
      shortTermMaxLufs: -19.5,
      targetLufs: -16,
      recommendedGainDb: 4.7,
      needsCompression: false,
    });
    expect(report.recommendedGainDb).toBeCloseTo(4.7);
  });

  it('validates procedural Tone.js SFX synthesis specs and groove subdivisions', () => {
    expect(SYNTH_SFX_CATEGORIES).toContain('synth-swell');
    expect(GROOVE_SUBDIVISIONS).toContain('1/4');
    const spec = synthSfxSpecSchema.parse({
      category: 'riser',
      durationMs: 1370,
      bpm: 128,
      pitchHz: 220,
    });
    expect(spec.brightness).toBe(0.5);
    expect(grooveSubdivisionSchema.parse('1/2')).toBe('1/2');
  });
});

describe('vision contact sheet annotation and OpenCV QA schemas', () => {
  it('validates Set-of-Mark tile annotations and sheet options', () => {
    const tile = tileAnnotationSchema.parse({
      badge: '#04 · 00:03.42',
      cornerTag: 'CUT?',
      highlight: true,
      boxes: [{ kind: 'face', x: 0.25, y: 0.15, width: 0.2, height: 0.3, label: 'F1' }],
      waveformBars: [0.2, 0.5, 0.9, 0.4],
    });
    expect(tile.highlight).toBe(true);
    expect(tile.boxes[0]?.label).toBe('F1');

    const opts = contactSheetAnnotationOptionsSchema.parse({
      safeZone: { x: 0.06, y: 0.1, width: 0.82, height: 0.72 },
    });
    expect(opts.badges).toBe(true);
  });

  it('validates caption clutter placement advice and visual QA reports', () => {
    const advice = captionPlacementAdviceSchema.parse({
      recommendedZone: 'top',
      recommendedAnchorY: 0.18,
      needsBackdropPill: true,
      recommendedBackdropOpacity: 0.68,
      zones: [
        {
          zone: 'top',
          anchorY: 0.18,
          edgeClutter: 0.12,
          lumaMean: 48,
          lumaStd: 14,
          contrastRatio: 9.2,
          obstructionOverlap: 0,
          needsBackdropPill: false,
          score: 0.88,
        },
        {
          zone: 'middle',
          anchorY: 0.5,
          edgeClutter: 0.41,
          lumaMean: 132,
          lumaStd: 52,
          contrastRatio: 2.8,
          obstructionOverlap: 0.35,
          needsBackdropPill: true,
          score: 0.31,
        },
        {
          zone: 'bottom',
          anchorY: 0.78,
          edgeClutter: 0.38,
          lumaMean: 190,
          lumaStd: 48,
          contrastRatio: 2.1,
          obstructionOverlap: 0.15,
          needsBackdropPill: true,
          score: 0.42,
        },
      ],
    });
    expect(advice.recommendedZone).toBe('top');

    const qa = frameVisualQaReportSchema.parse({
      laplacianSharpness: 142.5,
      lumaMean: 118,
      darkClippedShare: 0.01,
      brightClippedShare: 0.02,
      horizonTiltDegrees: 1.4,
      horizonConfidence: 0.82,
      skinToneShare: 0.14,
      pseFlashRisk: false,
      maxFlashesPerSecond: 1,
    });
    expect(qa.pseFlashRisk).toBe(false);
    const unmeasured = frameVisualQaReportSchema.parse({
      ...qa,
      pseFlashRisk: null,
      maxFlashesPerSecond: null,
    });
    expect(unmeasured.pseFlashRisk).toBeNull();
    expect(unmeasured.maxFlashesPerSecond).toBeNull();
  });
});
