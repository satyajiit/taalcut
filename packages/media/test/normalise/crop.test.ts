// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A crop in the filter chain, the output size it gives and the rectangle check. No FFmpeg. */
import { describe, expect, it } from 'vitest';
import type { ToneMapChoice } from '../../src/backends';
import { checkCrop, cropFilter } from '../../src/normalise/crop';
import { normalisationGraph } from '../../src/normalise/graph';
import { outputSize } from '../../src/normalise/size';
import { videoPlan } from '../helpers/video-plan';

const none: ToneMapChoice = { method: 'none', backend: 'software' };
const software = { backend: 'software', fallbackReason: { code: 'requested', detail: 'test' } } as const;
const vt = { backend: 'videotoolbox', surfaceFormat: 'nv12' } as const;
/** A portrait screen recording; the reel sits between the status bar and the bottom bar. */
const portrait = { width: 1080, height: 2340, displayWidth: 1080, displayHeight: 2340 };
const reel = { x: 0, y: 270, width: 1080, height: 1920 };

describe('crop in the normalisation graph', () => {
  it('crops after the VideoToolbox download, then scales on the CPU instead of scale_vt', () => {
    const graph = normalisationGraph(videoPlan(portrait), {
      route: vt,
      toneMap: none,
      size: { longSide: 960 },
      crop: reel,
    });
    const filter = graph.videoFilter ?? '';
    expect(filter).not.toContain('scale_vt');
    expect(filter).toContain(cropFilter(reel));
    expect(filter.indexOf('hwdownload')).toBeLessThan(filter.indexOf('crop='));
    expect(filter.indexOf('crop=')).toBeLessThan(filter.indexOf('scale=540:960'));
    expect(filter.indexOf('scale=')).toBeLessThan(filter.indexOf('fps=fps='));
  });

  it('flips a mirrored frame before the crop, since the rectangle is in display orientation', () => {
    const graph = normalisationGraph(videoPlan({ ...portrait, mirrored: true }), {
      route: vt,
      toneMap: none,
      crop: reel,
    });
    const filter = graph.videoFilter ?? '';
    expect(filter.match(/hflip/g)).toHaveLength(1);
    expect(filter.indexOf('hflip')).toBeLessThan(filter.indexOf('crop='));
    // No size asked: the cropped picture keeps its pixels.
    expect(filter).not.toContain('scale=');
  });

  it('crops a software decode in the same place and sizes from the crop, never upscaling it', () => {
    const plan = videoPlan(portrait);
    const graph = normalisationGraph(plan, {
      route: software,
      toneMap: none,
      size: { longSide: 4000 },
      crop: reel,
    });
    expect(graph.videoFilter).toContain(cropFilter(reel));
    expect(graph.videoFilter).not.toContain('scale=');
    expect(outputSize(plan, { longSide: 4000 }, reel)).toEqual({ width: 1080, height: 1920 });
    expect(outputSize(plan, { longSide: 960 }, reel)).toEqual({ width: 540, height: 960 });
    expect(outputSize(plan, { longSide: 960 })).toEqual({ width: 442, height: 960 });
  });

  it('accepts even rectangles inside the upright frame and refuses the rest plainly', () => {
    const plan = videoPlan({
      width: 2340,
      height: 1080,
      displayWidth: 1080,
      displayHeight: 2340,
      rotation: 90,
    });
    expect(checkCrop('/clip.mp4', plan, reel).ok).toBe(true);
    for (const bad of [
      { ...reel, x: 1 },
      { ...reel, width: 1081 },
      { ...reel, y: 500 },
      { ...reel, x: -2 },
      { x: 0, y: 0, width: 0, height: 0 },
      { ...reel, height: 1920.5 },
    ]) {
      const checked = checkCrop('/clip.mp4', plan, bad);
      expect(checked.ok).toBe(false);
      if (!checked.ok) {
        expect(checked.error.code).toBe('media.unsupported_media');
        expect(checked.error.detail).toContain('1080x2340 frame');
      }
    }
  });
});
