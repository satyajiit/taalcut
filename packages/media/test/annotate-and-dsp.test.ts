// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it, vi } from 'vitest';
import {
  annotateRgbTile,
  buildDspFilterChain,
  buildDspFilterSteps,
  drawRgbPillBadge,
  presetDspNodes,
} from '../src';

describe('annotateRgbTile (Pillow-style RGB24 Set-of-Mark annotator)', () => {
  it('reports unsupported GPU kernels before touching the CPU pixel buffer', () => {
    const rgb = new Uint8Array(32 * 32 * 3).fill(64);
    const onFallback = vi.fn(() => expect(rgb.every((value) => value === 64)).toBe(true));
    annotateRgbTile(rgb, 32, 32, { highlight: true, boxes: [] }, onFallback);
    expect(onFallback).toHaveBeenCalledExactlyOnceWith({
      operation: 'media.annotateRgbTile',
      wanted: ['metal', 'webgpu'],
      reason: 'no_accelerator',
      detail: 'RGB tile annotation has no supported Metal or WebGPU kernel; using the CPU rasterizer',
    });
    expect(rgb[0]).toBe(251);
  });

  it('draws translucent pill badges, highlight borders, bounding boxes and waveform strips', () => {
    const width = 160;
    const height = 120;
    const rgb = new Uint8Array(width * height * 3).fill(64);

    annotateRgbTile(rgb, width, height, {
      badge: '#01 · 00:02.4',
      cornerTag: 'CUT?',
      highlight: true,
      boxes: [
        { kind: 'face', x: 0.25, y: 0.2, width: 0.3, height: 0.4, label: 'F1' },
        { kind: 'safeZone', x: 0.08, y: 0.1, width: 0.84, height: 0.75 },
      ],
      waveformBars: [0.2, 0.5, 0.85, 0.4, 0.7, 0.3],
    });

    // Top-left border pixel should be painted with the amber highlight colour [251, 191, 36].
    expect([rgb[0], rgb[1], rgb[2]]).toEqual([251, 191, 36]);

    // Inside the top-left badge pill (e.g. x=6, y=6), pixel should differ from the uniform 64 fill.
    const pillIdx = (6 * width + 6) * 3;
    expect(rgb[pillIdx]).not.toBe(64);

    // Bottom waveform strip should modify pixels near the bottom row.
    let changedBottom = 0;
    for (let x = 0; x < width; x++) {
      const idx = ((height - 3) * width + x) * 3;
      if (rgb[idx] !== 64) changedBottom++;
    }
    expect(changedBottom).toBeGreaterThan(width / 2);
  });

  it('draws crisp 5x7 glyphs inside a pill badge', () => {
    const width = 100;
    const height = 40;
    const rgb = new Uint8Array(width * height * 3).fill(100);
    const { pillWidth, pillHeight } = drawRgbPillBadge(rgb, width, height, 'R1 · 0F', {
      x: 4,
      y: 4,
      scale: 1,
    });
    expect(pillWidth).toBeGreaterThan(30);
    expect(pillHeight).toBe(13);
  });
});

describe('buildDspFilterChain (Pedalboard-equivalent FFmpeg audio filter compiler)', () => {
  it('compiles built-in studio presets into deterministic FFmpeg filter chains', () => {
    expect(presetDspNodes('none')).toEqual([]);
    expect(buildDspFilterChain('none')).toBe('');

    const claritySteps = buildDspFilterSteps('voice-clarity');
    expect(claritySteps[0]).toBe('highpass=f=85:p=2');
    expect(claritySteps.some((s) => s.startsWith('acompressor='))).toBe(true);
    expect(claritySteps.some((s) => s.startsWith('alimiter='))).toBe(true);

    const underwater = buildDspFilterChain('underwater-transition');
    expect(underwater).toContain('lowpass=f=480:p=2');
    expect(underwater).toContain('aecho=');
  });

  it('combines preset nodes with custom AudioEffectChain nodes', () => {
    const chain = buildDspFilterChain({
      preset: 'music-carve',
      nodes: [{ kind: 'limiter', limitDb: -2, attackMs: 5, releaseMs: 50 }],
    });
    expect(chain).toContain('highpass=f=35:p=2');
    expect(chain).toContain('equalizer=f=2000:width_type=q:w=1:g=-3.5');
    expect(chain).toContain('alimiter=limit=-2dB:attack=5:release=50:level=false');
  });
});
