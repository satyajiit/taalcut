// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Real ffmpeg: frame extraction, live progress, cancellation, timeouts and
 * encoder detection. Skips when no FFmpeg is installed.
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createBinaryResolver,
  createMediaService,
  detectEncoders,
  extractFrame,
  runFfmpeg,
  type FfmpegProgress,
  type MediaContext,
} from '@taalcut/media';
import { TEST_FFMPEG_CHECK_MS } from '@taalcut/media/test-support';
import { findTestBinaries } from '../helpers/binaries';
import { makeFixtures, removeFixtures, type Fixtures } from '../helpers/fixtures';

const found = await findTestBinaries('media ffmpeg integration');

/** An endless real-time source: runs until stopped. */
const ENDLESS = ['-re', '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=30', '-f', 'null', '-'];

describe.skipIf(!found.binaries)(
  `ffmpeg wrapper with real ffmpeg${found.binaries ? '' : ' (no FFmpeg found)'}`,
  () => {
    let ctx: MediaContext;
    let fixtures: Fixtures | undefined;

    beforeAll(async () => {
      ctx = { binaries: found.binaries! };
      fixtures = await makeFixtures(ctx, ['h264', 'rotated', 'hevcHlg', 'audio']);
    });

    afterAll(() => removeFixtures(fixtures));

    const fixture = (t: { skip: (note?: string) => never }, name: 'h264' | 'rotated' | 'hevcHlg' | 'audio') =>
      fixtures?.paths[name] ??
      t.skip(`fixture '${name}' unavailable: ${fixtures?.missing[name] ?? 'not made'}`);

    describe('extractFrame', () => {
      it('extracts a JPEG at an exact time', async (t) => {
        const result = await extractFrame(fixture(t, 'h264'), { value: 30030, rate: 30000 }, ctx);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toMatchObject({ mimeType: 'image/jpeg', width: 320, height: 240 });
        expect(result.value.data.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      });

      it('applies the display matrix, so a portrait phone clip comes out upright', async (t) => {
        const result = await extractFrame(fixture(t, 'rotated'), { value: 1, rate: 2 }, ctx, {
          format: 'png',
        });
        expect(result.ok && result.value).toMatchObject({ mimeType: 'image/png', width: 240, height: 320 });
      });

      it('scales to a maximum dimension after rotation, keeping aspect, never upscaling', async (t) => {
        const rotated = fixture(t, 'rotated');
        const small = await extractFrame(rotated, { value: 0, rate: 1 }, ctx, { maxDimension: 160 });
        expect(small.ok && [small.value.width, small.value.height]).toEqual([120, 160]);
        const big = await extractFrame(rotated, { value: 0, rate: 1 }, ctx, { maxDimension: 4096 });
        expect(big.ok && [big.value.width, big.value.height]).toEqual([240, 320]);
      });

      it('extracts an 8-bit PNG from 10-bit HDR video', async (t) => {
        const result = await extractFrame(fixture(t, 'hevcHlg'), { value: 12, rate: 25 }, ctx, {
          format: 'png',
        });
        expect(result.ok).toBe(true);
        // PNG IHDR bit depth byte (offset 24): 8 bits per channel.
        expect(result.ok && result.value.data[24]).toBe(8);
      });

      it('a time past the end is media.decode_failed', async (t) => {
        const result = await extractFrame(fixture(t, 'h264'), { value: 50, rate: 1 }, ctx);
        expect(!result.ok && result.error).toMatchObject({
          code: 'media.decode_failed',
          params: { name: 'h264-29.97.mp4' },
        });
        expect(!result.ok && result.error.detail).toContain('50.000000');
      });

      it('a file with no video is media.decode_failed', async (t) => {
        const result = await extractFrame(fixture(t, 'audio'), { value: 0, rate: 1 }, ctx);
        expect(!result.ok && result.error.code).toBe('media.decode_failed');
      });

      it('validates its arguments before running anything', async () => {
        const at = { value: -1, rate: 1 };
        expect((await extractFrame('/nope.mp4', at, ctx)).ok).toBe(false);
        const bad = await extractFrame('/nope.mp4', { value: 0, rate: 1 }, ctx, { maxDimension: 0.5 });
        expect(!bad.ok && bad.error).toMatchObject({
          code: 'core.validation',
          params: { field: 'maxDimension' },
        });
        const missing = await extractFrame(join(fixtures!.dir, 'gone.mp4'), { value: 0, rate: 1 }, ctx);
        expect(!missing.ok && missing.error.code).toBe('media.file_not_found');
      });
    });

    describe('runFfmpeg', () => {
      it('reports live progress, ending with a done event', async () => {
        const events: FfmpegProgress[] = [];
        const result = await runFfmpeg(
          ctx,
          ['-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=30', '-t', '3', '-f', 'null', '-'],
          {
            onProgress: (e) => events.push(e),
            duration: { value: 3, rate: 1 },
            progressIntervalMs: 100,
          },
        );
        expect(result.ok).toBe(true);
        const last = events.at(-1);
        expect(last).toMatchObject({
          done: true,
          frame: 90,
          percent: 100,
          outTime: { value: 3000000, rate: 1000000 },
        });
      });

      it('cancels a running encode with SIGTERM; ffmpeg exits on its own, no SIGKILL needed', async () => {
        const controller = new AbortController();
        const started = Date.now();
        const result = await runFfmpeg(ctx, ENDLESS, {
          signal: controller.signal,
          progressIntervalMs: 100,
          onProgress: (e) => {
            if ((e.frame ?? 0) > 3) controller.abort();
          },
        });
        expect(!result.ok && result.error.code).toBe('media.cancelled');
        expect(!result.ok && result.error.detail).not.toContain('SIGKILL');
        expect(Date.now() - started).toBeLessThan(10_000);
      });

      it('times out a run that goes on too long', async () => {
        const result = await runFfmpeg(ctx, ENDLESS, { timeoutMs: 700 });
        expect(!result.ok && result.error).toMatchObject({ code: 'media.timeout', params: { ms: 700 } });
      });

      it('maps a bad command to media.ffmpeg_failed with stderr', async () => {
        const result = await runFfmpeg(ctx, ['-i', join(fixtures!.dir, 'missing.mp4'), '-f', 'null', '-']);
        expect(!result.ok && result.error.code).toBe('media.ffmpeg_failed');
        expect(!result.ok && result.error.detail).toMatch(/No such file or directory/);
      });
    });

    it('detects encoders from the real build', async () => {
      const result = await detectEncoders(ctx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.encoders.length).toBeGreaterThan(10);
      expect(result.value.encoders.some((e) => e.name === 'aac')).toBe(true);
    });

    // FFmpeg enables VideoToolbox by default on macOS, so the configure line
    // need not name it; the encoder list is what counts. Every build Taalcut
    // runs on a Mac must have it, and the Linux build NVENC (ADR 0002: GPU first).
    it.runIf(process.platform === 'darwin')('lists the VideoToolbox encoders on macOS', async () => {
      const result = await detectEncoders(ctx);
      expect(result.ok && [result.value.h264VideoToolbox, result.value.hevcVideoToolbox]).toEqual([
        true,
        true,
      ]);
    });

    it.runIf(process.platform === 'linux')('lists NVENC and prefers it on Linux', async () => {
      const result = await detectEncoders(ctx);
      // av1_nvenc is compiled in whatever the GPU (LNX1-AV1); whether it opens is its trial's question.
      expect(result.ok && result.value.hardware.cuda).toEqual(['h264_nvenc', 'hevc_nvenc', 'av1_nvenc']);
      expect(
        result.ok && [result.value.preferredH264, result.value.preferredHevc, result.value.preferredAv1],
      ).toEqual(['h264_nvenc', 'hevc_nvenc', 'av1_nvenc']);
      expect(result.ok && result.value.libopenh264).toBe(true);
    });

    // Listed is not the same as working: a macOS VM (some CI runners) has no
    // VideoToolbox hardware, a Linux runner no NVIDIA GPU, and the encoder fails
    // to open. Locally this must pass; on CI a failure skips with the reason.
    it.runIf(['darwin', 'linux'].includes(process.platform))(
      'encodes a short clip on the platform’s hardware H.264 encoder',
      async (t) => {
        const encoder = process.platform === 'darwin' ? 'h264_videotoolbox' : 'h264_nvenc';
        const lavfi = ['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30', '-frames:v', '10'];
        const out = ['-c:v', encoder, '-b:v', '1M', '-f', 'null', '-'];
        const result = await runFfmpeg(ctx, [...lavfi, ...out], { timeoutMs: 30_000 });
        if (!result.ok && process.env['CI']) t.skip(`${encoder} unusable here: ${result.error.detail ?? ''}`);
        expect(result.ok ? 'encoded' : result.error.detail).toBe('encoded');
      },
    );

    it('MediaService resolves binaries once and runs everything through them', async (t) => {
      // A resolver of its own, as the app's: the check's deadline is the test run's (about a hang, not a busy
      // machine: test-support-ffmpeg.ts), not the app's 10 s.
      const resolver = createBinaryResolver({ development: true, timeoutMs: TEST_FFMPEG_CHECK_MS });
      const service = createMediaService({ resolver });
      const probe = await service.probe(fixture(t, 'h264'));
      expect(probe.ok && probe.value.video?.codec).toBe('h264');
      const frame = await service.extractFrame(
        fixture(t, 'h264'),
        { value: 0, rate: 1 },
        { maxDimension: 64 },
      );
      expect(frame.ok && frame.value.width).toBe(64);
      const binaries = await service.binaries();
      expect(binaries.ok && binaries.value.ffmpeg).toBe(found.binaries?.ffmpeg);
    });
  },
);
