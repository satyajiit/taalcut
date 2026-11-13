// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { FrameRate, type LookStats } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  analyseCaptionZones,
  composeGrid,
  detectPseFlashRisk,
  evaluateFrameVisualQa,
  measureHorizonTilt,
  measureSkinToneShare,
  reinhardMap,
  skinToneWeight,
  tileAnnotationsFor,
} from '../src';

describe('Set-of-Mark contact sheets and strips in @taalcut/vision', () => {
  it('generates strip annotations with R# badges, CUT? tags, and candidate highlight on offset 0', () => {
    const rate = FrameRate.of(30);
    // 5 tiles for 1 candidate row (offsets -2, -1, 0, +1, +2)
    const plan = [
      { frame: 28, row: 0 },
      { frame: 29, row: 0 },
      { frame: 30, row: 0 },
      { frame: 31, row: 0 },
      { frame: 32, row: 0 },
    ];
    const annotations = tileAnnotationsFor(plan, 'strips', rate, true);
    expect(annotations).toHaveLength(5);
    expect(annotations?.[0]?.badge).toBe('R1 -2F');
    expect(annotations?.[0]?.highlight).toBe(false);
    expect(annotations?.[2]?.badge).toBe('R1 0F');
    expect(annotations?.[2]?.cornerTag).toBe('CUT?');
    expect(annotations?.[2]?.highlight).toBe(true);
    expect(annotations?.[4]?.badge).toBe('R1 +2F');
  });

  it('burns Set-of-Mark badges onto tiles in composeGrid without mutating caller buffers', () => {
    const tileData = new Uint8Array(64 * 64 * 3).fill(80);
    const grid = composeGrid(
      [{ index: 0, width: 64, height: 64, data: tileData }],
      1,
      { width: 64, height: 64 },
      [{ badge: '#1 · 00:01.0', highlight: true, boxes: [] }],
    );
    // Original buffer stays untouched
    expect(tileData[0]).toBe(80);
    // Grid top-left border is highlighted in amber [251, 191, 36]
    expect([grid.rgb[0], grid.rgb[1], grid.rgb[2]]).toEqual([251, 191, 36]);
  });
});

describe('OpenCV-style caption clutter, visual QA, and skin-tone protected LUT', () => {
  it('recommends a clean dark zone over a cluttered or obstructed bottom zone', () => {
    const width = 120;
    const height = 160;
    const rgb = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 3;
        if (y < height * 0.4) {
          // Clean dark top zone -> high contrast for white text, zero edge clutter
          rgb[p] = 24;
          rgb[p + 1] = 28;
          rgb[p + 2] = 34;
        } else {
          // High-clutter bright checkerboard in middle and bottom zones
          const v = (x + y) % 2 === 0 ? 250 : 30;
          rgb[p] = v;
          rgb[p + 1] = v;
          rgb[p + 2] = v;
        }
      }
    }

    const advice = analyseCaptionZones(rgb, width, height, {
      preferredZone: 'bottom',
      obstructions: [{ x: 0.2, y: 0.72, width: 0.6, height: 0.14 }],
    });
    expect(advice.recommendedZone).toBe('top');
    expect(advice.zones[0]?.needsBackdropPill).toBe(false);
    expect(advice.zones[2]?.needsBackdropPill).toBe(true);
    expect(advice.zones[2]?.obstructionOverlap).toBeGreaterThan(0.5);
  });

  it('measures horizon tilt, skin-tone share, and PSE flash risk', () => {
    const width = 64;
    const height = 64;
    const rgb = new Uint8Array(width * height * 3);
    // Fill upper half with warm skin tone (R=215, G=162, B=134) and lower half dark
    const slope = Math.tan((4 * Math.PI) / 180);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 3;
        const lineY = 32 + (x - 32) * slope;
        if (y < lineY) {
          rgb[p] = 215;
          rgb[p + 1] = 162;
          rgb[p + 2] = 134;
        } else {
          rgb[p] = 20;
          rgb[p + 1] = 25;
          rgb[p + 2] = 30;
        }
      }
    }

    expect(measureSkinToneShare(rgb, width, height)).toBeGreaterThan(0.4);
    const tilt = measureHorizonTilt(rgb, width, height);
    expect(Math.abs(tilt.horizonTiltDegrees - 4)).toBeLessThanOrEqual(1.5);
    expect(tilt.horizonConfidence).toBeGreaterThan(0.3);

    // 8 alternating bright/dark frames at 24 fps -> 4 flashes/sec -> PSE risk
    const pse = detectPseFlashRisk([20, 220, 20, 220, 20, 220, 20, 220, 20], 24);
    expect(pse.pseFlashRisk).toBe(true);
    expect(pse.maxFlashesPerSecond).toBeGreaterThan(3);

    const qa = evaluateFrameVisualQa(rgb, width, height);
    expect(qa.skinToneShare).toBeGreaterThan(0.4);
    expect(qa.pseFlashRisk).toBeNull();
    expect(qa.maxFlashesPerSecond).toBeNull();
  });

  it('requires a full second of sequence evidence before reporting a temporal flash assessment', () => {
    const rgb = new Uint8Array(16 * 16 * 3).fill(80);
    const report = (lumaMeans: number[]) => evaluateFrameVisualQa(rgb, 16, 16, { lumaMeans, fps: 24 });
    expect(report([80, 80, 80]).pseFlashRisk).toBeNull();
    expect(report(Array.from({ length: 25 }, () => 80)).pseFlashRisk).toBe(false);
    expect(report(Array.from({ length: 25 }, (_, i) => (i % 2 ? 220 : 20))).pseFlashRisk).toBe(true);
  });

  it('protects human skin tones during Reinhard look transfer when protectSkinTones is enabled', () => {
    const source: LookStats = {
      version: 1,
      space: 'ruderman-lab',
      encoding: 'bt709',
      mean: [-0.5, 0.05, 0.02],
      std: [0.3, 0.08, 0.04],
      frames: 8,
      pixels: 4096,
    };
    const target: LookStats = {
      version: 1,
      space: 'ruderman-lab',
      encoding: 'bt709',
      mean: [-0.5, -0.25, -0.15],
      std: [0.3, 0.12, 0.08],
      frames: 8,
      pixels: 4096,
    };
    const skinRgb: [number, number, number] = [215 / 255, 162 / 255, 134 / 255];
    expect(skinToneWeight(skinRgb)).toBeGreaterThan(0.5);

    const unprotected = reinhardMap(skinRgb, source, target, 1.0, { protectSkinTones: false });
    const protectedRgb = reinhardMap(skinRgb, source, target, 1.0, { protectSkinTones: true });

    const shiftUnprotected = Math.hypot(
      unprotected[0] - skinRgb[0],
      unprotected[1] - skinRgb[1],
      unprotected[2] - skinRgb[2],
    );
    const shiftProtected = Math.hypot(
      protectedRgb[0] - skinRgb[0],
      protectedRgb[1] - skinRgb[1],
      protectedRgb[2] - skinRgb[2],
    );
    expect(shiftProtected).toBeLessThan(shiftUnprotected * 0.65);
  });
});
