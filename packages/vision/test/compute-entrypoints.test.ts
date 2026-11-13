// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { FrameRate, ok, type ComputeFallbackEvent } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildContactSheet } from '../src/breakdown/contact-sheet';
import { probeSource, sampleFrames } from '../src/media/frames';
import type * as SheetModule from '../src/media/sheet';
import { createCheckFrameQualityTool, createInspectCaptionZonesTool } from '../src/tools/visual-qa-tools';
import { fakeVideoPlan } from './helpers/fake-frame-source';
import { testToolContext } from './helpers/fakes';

vi.mock('../src/media/frames', () => ({
  fitLongSide: () => ({ width: 32, height: 32 }),
  probeSource: vi.fn(),
  sampleFrames: vi.fn(),
}));
vi.mock('../src/media/sheet', async (original) => ({
  ...(await original<typeof SheetModule>()),
  encodeJpeg: vi.fn(async () => ok({ jpeg: Buffer.from('jpeg'), quality: 4 })),
}));

beforeEach(() => {
  vi.mocked(probeSource).mockResolvedValue(
    ok({
      path: '/clip.mov',
      width: 32,
      height: 32,
      rate: FrameRate.of(30),
      frameCount: 90,
      plan: fakeVideoPlan(90, 32, 32),
    }),
  );
  vi.mocked(sampleFrames).mockResolvedValue(
    ok([{ index: 0, width: 32, height: 32, data: new Uint8Array(32 * 32 * 3).fill(80) }]),
  );
});

function context(events: ComputeFallbackEvent[]): MediaContext {
  return {
    binaries: { ffmpeg: '/unused/ffmpeg', ffprobe: '/unused/ffprobe', source: 'env' },
    onComputeFallback: (event) => events.push(event),
  };
}

describe('production compute entry points', () => {
  it('passes the contact-sheet event sink to the annotation rasterizer', async () => {
    const events: ComputeFallbackEvent[] = [];
    const result = await buildContactSheet(
      '/clip.mov',
      { media: context(events), tempDir: '/unused' },
      { kind: 'frames', frames: [0] },
      { annotate: true },
    );
    expect(result.ok).toBe(true);
    expect(events).toEqual([
      expect.objectContaining({ operation: 'media.annotateRgbTile', reason: 'no_accelerator' }),
    ]);
    expect(events[0]?.detail).toContain('no supported Metal or WebGPU kernel');
  });

  it('reports visual-analysis CPU fallbacks and leaves single-frame flash risk unknown', async () => {
    const events: ComputeFallbackEvent[] = [];
    const deps = { media: context(events) };
    const captions = await createInspectCaptionZonesTool(deps).run(
      { path: '/clip.mov', seconds: 0, preferredZone: 'bottom' },
      testToolContext(),
    );
    const quality = await createCheckFrameQualityTool(deps).run(
      { path: '/clip.mov', seconds: 0 },
      testToolContext(),
    );
    expect(captions.ok).toBe(true);
    expect(quality.ok && quality.value.pseFlashRisk).toBeNull();
    expect(quality.ok && quality.value.maxFlashesPerSecond).toBeNull();
    expect(events.map((event) => event.operation)).toEqual([
      'vision.inspectCaptionZones',
      'vision.checkFrameQuality',
    ]);
    for (const event of events) {
      expect(event).toMatchObject({ wanted: ['metal', 'webgpu'], reason: 'no_accelerator' });
      expect(event.detail).toContain('no supported Metal or WebGPU kernel');
    }
  });
});
