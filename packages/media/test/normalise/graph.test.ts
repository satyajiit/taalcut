// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { FrameRate, RationalTime } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { LIBPLACEBO_TONEMAP } from '../../src/tonemap';
import { normalisationGraph } from '../../src/normalise/graph';
import { planNormalisation } from '../../src/normalise/plan';
import { probeOf, videoStream } from '../helpers/probe-fixture';
import type { ToneMapChoice } from '../../src/backends';

const placebo: ToneMapChoice = { method: 'libplacebo', backend: 'vulkan', curve: 'bt.2446a' };
const zscale: ToneMapChoice = {
  method: 'zscale',
  backend: 'software',
  curve: 'hable',
  fallbackReason: { code: 'vulkan_unavailable', detail: 'no device' },
};
const none: ToneMapChoice = { method: 'none', backend: 'software' };

function planFor(overrides: Parameters<typeof videoStream>[0] = {}) {
  const result = planNormalisation(
    probeOf(
      '/tmp/clip.mov',
      videoStream({
        averageFrameRate: { num: 30, den: 1 },
        frameRate: { num: 30, den: 1 },
        duration: { value: 2_000_000, rate: 1_000_000 },
        frameCount: 60,
        width: 1920,
        height: 1080,
        displayWidth: 1920,
        displayHeight: 1080,
        ...overrides,
      }),
    ),
  );
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

describe('normalisationGraph', () => {
  it('builds a VideoToolbox SDR graph with transpose and no tone-map', () => {
    const plan = planFor({
      rotation: 90,
      width: 1920,
      height: 1080,
      displayWidth: 1080,
      displayHeight: 1920,
    });
    const graph = normalisationGraph(plan, {
      route: { backend: 'videotoolbox', surfaceFormat: 'nv12' },
      toneMap: none,
      size: { longSide: 640 },
    });
    expect(graph.preInput).toContain('videotoolbox_vld');
    expect(graph.videoFilter).toContain('transpose_vt=dir=clock');
    expect(graph.videoFilter).toContain('scale_vt=');
    expect(graph.videoFilter).toContain('hwdownload,format=nv12');
    expect(graph.videoFilter).toContain('fps=fps=30/1:round=near');
    expect(graph.videoFilter).not.toContain('libplacebo');
    expect(graph.tail).toEqual(['-fps_mode', 'cfr']);
  });

  it('downloads 10-bit HDR as p010le into libplacebo, and uses zscale on the CPU route', () => {
    const plan = planFor({
      isHdr: true,
      hdrFormats: ['hlg'],
      bitDepth: 10,
      colour: { transfer: 'arib-std-b67', primaries: 'bt2020', space: 'bt2020nc', range: 'tv' },
    });
    const gpu = normalisationGraph(plan, {
      route: { backend: 'videotoolbox', surfaceFormat: 'p010le' },
      toneMap: placebo,
      size: { longSide: 1280 },
    });
    expect(gpu.videoFilter).toContain('format=p010le');
    expect(gpu.videoFilter).toContain(LIBPLACEBO_TONEMAP);
    expect(gpu.videoFilter).not.toContain('scale_vt');
    const cpu = normalisationGraph(plan, {
      route: { backend: 'software', fallbackReason: { code: 'requested', detail: 'test' } },
      toneMap: zscale,
    });
    expect(cpu.preInput).toEqual([]);
    expect(cpu.videoFilter).toContain('tonemap=tonemap=hable');
    expect(cpu.videoFilter).not.toContain('hwdownload');
  });

  it('flips a mirrored VideoToolbox frame after the scale and seeks a range', () => {
    const plan = planFor({ mirrored: true });
    const rate = FrameRate.of(30);
    const graph = normalisationGraph(plan, {
      route: { backend: 'videotoolbox', surfaceFormat: 'nv12' },
      toneMap: none,
      size: { longSide: 640 },
      range: { start: RationalTime.of(30, rate), duration: RationalTime.of(15, rate) },
    });
    const filter = graph.videoFilter ?? '';
    const flip = filter.indexOf('hflip');
    const fps = filter.indexOf('fps=fps=');
    expect(flip).toBeGreaterThan(filter.indexOf('scale'));
    expect(fps).toBeGreaterThan(flip);
    // Half a source frame early, so the start frame survives the accurate seek; then 15 frames.
    expect(graph.seek).toBe((1 - (0.5 / plan.frameRate.output.num) * plan.frameRate.output.den).toFixed(6));
    expect(graph.videoFilter).not.toContain('start_time');
    expect(graph.videoFilter).toContain('trim=end_frame=15');
    expect(graph.tail).not.toContain('-t');
  });

  it('does not upscale', () => {
    const plan = planFor({ width: 320, height: 240, displayWidth: 320, displayHeight: 240 });
    const graph = normalisationGraph(plan, {
      route: { backend: 'software', fallbackReason: { code: 'requested', detail: 'test' } },
      toneMap: none,
      size: { longSide: 1280 },
    });
    expect(graph.videoFilter).not.toContain('scale=');
    expect(graph.videoFilter).not.toContain('scale_vt');
  });
});
