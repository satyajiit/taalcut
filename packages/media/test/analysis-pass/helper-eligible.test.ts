// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-V3: which analysis passes the decode service takes; everything else stays on FFmpeg's decode. IX2-F14: none,
 * when the service takes only frame reads.
 */
import { ok } from '@taalcut/core';
import type { AnalysisPassOptions, NormalisationPlan } from '@taalcut/media';
import { describe, expect, it } from 'vitest';
import { helperChoice, streamRange } from '../../src/analysis-pass/helper-eligible';
import { fakeService } from '../helpers/fake-decode';
import { videoPlan } from '../helpers/video-plan';

const service = fakeService(async () => ok({ frames: 0, sets: [], ms: 0 }));
const hd = { width: 1280, height: 720, displayWidth: 1280, displayHeight: 720 };
const base: AnalysisPassOptions = { dir: '/frames', decodeService: service };

const decline = (plan: NormalisationPlan, options: AnalysisPassOptions = base) => {
  const choice = helperChoice('/clip.mp4', plan, options);
  return choice && 'decline' in choice ? choice.decline : undefined;
};

describe('the decode service route', () => {
  it('takes an 8-bit SDR H.264 or HEVC video and sizes its outputs as FFmpeg would', () => {
    const plan = videoPlan(hd, false, 'darwin');
    const choice = helperChoice('/clip.mp4', plan, {
      ...base,
      frameSets: [
        { set: 'ocr', size: { longSide: 640 }, format: 'gray8', every: 15, maxFrames: 10 },
        { set: 'none', size: { longSide: 640 }, format: 'rgb24', every: 15, maxFrames: 0 },
      ],
    });
    expect(choice && 'use' in choice).toBe(true);
    if (!choice || !('use' in choice)) return;
    expect(choice.use.analysis).toEqual({ width: 256, height: 144 });
    expect(choice.use.sets.map((s) => s.target)).toEqual([{ width: 640, height: 360 }]);
    expect(choice.use.range).toBe('video');
    expect(decline(videoPlan({ ...hd, codec: 'hevc' }, false, 'darwin'))).toBeUndefined();
  });

  it('is not used without a service', () => {
    expect(helperChoice('/clip.mp4', videoPlan(hd, false, 'darwin'), { dir: '/frames' })).toBeUndefined();
  });

  it('is not used by a service that takes only frame reads (IX2-F14: the switch’s default)', () => {
    const plan = videoPlan(hd, false, 'darwin');
    const framesOnly = { ...service, tasks: ['frames'] as const };
    expect(helperChoice('/clip.mp4', plan, { ...base, decodeService: framesOnly })).toBeUndefined();
    const both = { ...service, tasks: ['pass', 'frames'] as const };
    expect(helperChoice('/clip.mp4', plan, { ...base, decodeService: both })).toHaveProperty('use');
  });

  it('declines what its frames would not match', () => {
    expect(decline(videoPlan(hd, false, 'linux'))).toBe('not_videotoolbox');
    expect(decline(videoPlan({ ...hd, pixelFormat: 'yuv420p10le', bitDepth: 10 }, false, 'darwin'))).toBe(
      'not_videotoolbox',
    );
    expect(decline(videoPlan({ ...hd, pixelFormat: 'yuv422p' }, false, 'darwin'))).toBe('not_videotoolbox');
    expect(decline(videoPlan({ ...hd, codec: 'prores' }, false, 'darwin'))).toMatch(/not_videotoolbox|codec/);
    expect(decline(videoPlan({ ...hd, vfrHint: true }, false, 'darwin'))).toBe('variable_rate');
    expect(decline(videoPlan({ ...hd, rotation: 90 }, false, 'darwin'))).toBeUndefined();
    const fast = videoPlan(
      { ...hd, frameRate: { num: 120, den: 1 }, averageFrameRate: { num: 120, den: 1 }, frameCount: 240 },
      false,
      'darwin',
    );
    expect(decline(fast)).toBe('retimed');
    expect(
      decline(
        videoPlan({ ...hd, width: 200, height: 112, displayWidth: 200, displayHeight: 112 }, false, 'darwin'),
      ),
    ).toBe('small_source');
  });

  it('declines HDR, a mirror and JPEG frame sets', () => {
    const plan = videoPlan(hd, false, 'darwin');
    expect(decline({ ...plan, hdr: 'hlg', toneMap: 'required' })).toBe('hdr');
    expect(decline({ ...plan, mirrored: true })).toBe('mirrored');
    const jpeg = { set: 'j', size: { longSide: 640 }, format: 'jpeg' as const, every: 1, maxFrames: 5 };
    expect(decline(plan, { ...base, frameSets: [jpeg] })).toBe('set_format_jpeg');
  });

  it('declines an option it does not know: a branch another change adds stays on FFmpeg', () => {
    const plan = videoPlan(hd, false, 'darwin');
    const options = { ...base, cutBranch: { width: 48, height: 27 } } as AnalysisPassOptions;
    expect(decline(plan, options)).toBe('option_cutBranch');
    expect(decline(plan, { ...base, window: { from: 30, frames: 60 }, detectMinSeconds: 0 })).toBeUndefined();
    // Each detector its own minimum (vision's frame source, IX3-D2): the same option, taken.
    expect(decline(plan, { ...base, detectMinSeconds: { black: 0 } })).toBeUndefined();
    // The shot model's stream (IX2-C3) is one this route runs.
    const rgbStream = { width: 48, height: 27, every: 1, onFrames: async () => {} };
    expect(decline(plan, { ...base, rgbStream })).toBeUndefined();
  });

  it('declines a file it failed on before, and tags a full-range stream full', () => {
    const plan = videoPlan(hd, false, 'darwin');
    const failing = fakeService(async () => ok({ frames: 0, sets: [], ms: 0 }));
    failing.avoid('/clip.mp4', 'decode.off_grid');
    expect(decline(plan, { ...base, decodeService: failing })).toBe('avoided_decode.off_grid');
    expect(streamRange({ ...plan, source: { ...plan.source, colour: { range: 'pc' } } })).toBe('full');
    expect(streamRange({ ...plan, source: { ...plan.source, pixelFormat: 'yuvj420p' } })).toBe('full');
  });
});
