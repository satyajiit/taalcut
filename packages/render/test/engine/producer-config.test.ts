// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The producer's capture mode (producer.ts; SPEC section 3, "Determinism"): HyperFrames picks it, so Taalcut's config
 * leaves it alone; a render that reports a mode other than screenshot, the patched drawElement or BeginFrame (the
 * Linux headless shell's, LNX1-RND), or a mix of them, is refused, and so is one HyperFrames' diagnostic
 * HF_FORCE_DRAWELEMENT would run. The engine's variables for one run: the encoder family media chose, the sandbox.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrameRate } from '@taalcut/core';
import {
  browserGpuLine,
  gpuEncoderFamily,
  loadProducer,
  producerEnvironment,
  producerOverrides,
  runProducer,
  unexpectedCaptureMode,
} from '../../src/engine/producer';

describe('producer capture mode', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("leaves the capture mode to HyperFrames' own choice", async () => {
    const overrides = producerOverrides({ chromePath: '/shell', browserGpu: 'hardware', workers: 'auto' });
    expect(overrides).not.toHaveProperty('useDrawElement');
    expect(overrides).not.toHaveProperty('forceScreenshot');
    const config = (await loadProducer()).resolveConfig(overrides);
    expect(config.forceScreenshot).toBe(false);
    // On a Mac with a hardware GPU, HyperFrames' default is drawElement capture where its router picks it.
    if (process.platform === 'darwin') expect(config.useDrawElement).toBe(true);
  });

  it('passes a numeric worker count through and leaves auto to the producer', () => {
    expect(producerOverrides({ chromePath: '/shell', browserGpu: 'hardware', workers: 3 })).toMatchObject({
      concurrency: 3,
    });
    expect(
      producerOverrides({ chromePath: '/shell', browserGpu: 'hardware', workers: 'auto' }),
    ).not.toHaveProperty('concurrency');
  });

  it('accepts screenshot, drawelement, beginframe and a mix of them, and refuses any other mode', () => {
    expect(unexpectedCaptureMode('screenshot')).toBeNull();
    expect(unexpectedCaptureMode('drawelement')).toBeNull();
    expect(unexpectedCaptureMode('drawelement|screenshot')).toBeNull();
    expect(unexpectedCaptureMode(null)).toBeNull();
    // HyperFrames' choice with the headless shell on Linux: each frame a paint HeadlessExperimental.beginFrame asks for.
    expect(unexpectedCaptureMode('beginframe')).toBeNull();
    expect(unexpectedCaptureMode('beginframe|screenshot')).toBeNull();
    expect(unexpectedCaptureMode('unknown')).toBe('unknown');
    expect(unexpectedCaptureMode('beginframe|unknown')).toBe('beginframe|unknown');
  });

  it("pins HyperFrames' GPU encoder to media's choice, and the sandbox to the shell build's", () => {
    expect(gpuEncoderFamily('h264_nvenc')).toBe('nvenc');
    expect(gpuEncoderFamily('h264_videotoolbox')).toBe('videotoolbox');
    expect(gpuEncoderFamily('hevc_vaapi')).toBe('vaapi');
    expect(gpuEncoderFamily('libopenh264')).toBeUndefined();
    expect(producerEnvironment({ gpuEncoder: 'h264_nvenc', sandbox: true })).toEqual({
      HYPERFRAMES_GPU_ENCODER: 'nvenc',
      HYPERFRAMES_CHROME_SANDBOX: '1',
    });
    // No choice handed in: HyperFrames detects, and one run's pin never carries into the next.
    expect(producerEnvironment({})).toEqual({
      HYPERFRAMES_GPU_ENCODER: undefined,
      HYPERFRAMES_CHROME_SANDBOX: undefined,
    });
    expect(producerEnvironment({ gpuEncoder: 'libopenh264' }).HYPERFRAMES_GPU_ENCODER).toBe('none');
  });

  it('logs the GPU Chrome rasterised on', () => {
    expect(
      browserGpuLine(
        {
          mode: 'hardware',
          vendor: 'Google Inc. (NVIDIA)',
          renderer: 'ANGLE (NVIDIA, Vulkan 1.4 (NVIDIA GeForce RTX 4090))',
        },
        'hardware',
      ),
    ).toBe(
      '[render] browser raster: probe hardware: Google Inc. (NVIDIA), ANGLE (NVIDIA, Vulkan 1.4 (NVIDIA GeForce RTX 4090))',
    );
    expect(browserGpuLine(null, 'software')).toMatch(/software \(SwiftShader\), as asked/);
  });

  it("refuses to render under HyperFrames' diagnostic HF_FORCE_DRAWELEMENT", async () => {
    vi.stubEnv('HF_FORCE_DRAWELEMENT', '1');
    const result = await runProducer({
      dir: '/nowhere',
      out: '/nowhere/out.mp4',
      rate: FrameRate.of(30),
      bitrateKbps: 8000,
      chromePath: '/shell',
      browserGpu: 'hardware',
      gpuEncode: true,
      workers: 'auto',
      binaries: { ffmpeg: '/ffmpeg', ffprobe: '/ffprobe' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('render.capture_failed');
    expect(result.error.detail).toContain('HF_FORCE_DRAWELEMENT');
  });
});
