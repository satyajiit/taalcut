// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The picture's first route (LNX1-RND, stages/picture.ts): Chrome's GPU raster and media's working H.264 encoder for
 * the producer; with hardware turned off (TAALCUT_FORCE_CPU=1, media's `disabled` machine) both CPU routes up front,
 * each one `compute.fallback` with `disabled`. No FFmpeg runs: the machine and the encoder are fixed answers.
 */
import { describe, expect, it } from 'vitest';
import { knownVideoBackends, type MediaContext } from '@taalcut/media';
import { planPicture, rasterWanted } from '../../src/engine/stages/picture';
import { knownEncoders } from '../support/host-video';

const binaries = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', source: 'sidecar' } as const;
const SIZE = { width: 1080, height: 1920 };

describe('the picture route', () => {
  it("rasterises on the GPU and hands the producer media's hardware encoder", async () => {
    const ctx: MediaContext = {
      binaries,
      platform: 'linux',
      videoBackends: knownVideoBackends(['cuda']),
      encoders: knownEncoders({ h264: 'h264_nvenc' }),
    };
    expect(await planPicture(ctx, SIZE)).toEqual({
      ok: true,
      value: { browserGpu: 'hardware', gpuEncoder: 'h264_nvenc', fallbacks: [] },
    });
  });

  it('takes the CPU raster and encode up front when hardware is turned off, each reported as disabled', async () => {
    const disabled = 'hardware video turned off (TAALCUT_FORCE_CPU=1)';
    const ctx: MediaContext = {
      binaries,
      platform: 'linux',
      videoBackends: knownVideoBackends([], { disabled }),
      encoders: knownEncoders({ h264: 'libopenh264' }),
    };
    const planned = await planPicture(ctx, SIZE);
    if (!planned.ok) throw new Error(planned.error.code);
    expect(planned.value.browserGpu).toBe('software');
    expect(planned.value.gpuEncoder).toBeUndefined();
    expect(planned.value.fallbacks).toEqual([
      { operation: 'render.capture', wanted: ['vulkan'], reason: 'disabled', detail: disabled },
      expect.objectContaining({ operation: 'render.encode', wanted: ['nvenc'], reason: 'disabled' }),
    ]);
  });

  it('names the raster it wanted by platform: Metal on a Mac, Vulkan elsewhere', () => {
    expect(rasterWanted('darwin')).toEqual(['metal']);
    expect(rasterWanted('linux')).toEqual(['vulkan']);
  });
});
