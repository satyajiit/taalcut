// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * GPU first with real FFmpeg (ADR 0002). Frames decode on the platform's first hw-video row and encoders are its
 * own (VideoToolbox on a Mac, NVDEC/NVENC on Linux); anything else must come back as software with the reason
 * recorded. A CI VM may have no usable GPU (a macOS VM's VideoToolbox, a Linux runner without NVIDIA): there the
 * hardware assertions accept a software result only with `hardware_failed` recorded. Skips when no FFmpeg is
 * installed.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ok } from '@taalcut/core';
import {
  createDirectJobRunner,
  createMediaJobs,
  createMediaService,
  extractFrame,
  hardwareBackends,
  hardwareEncoderFor,
  HardwareFailures,
  mediaExtractFrameJob,
  runFfmpeg,
  selectWorkingEncoder,
  softwareEncoderFor,
  type BackendFallback,
  type ExtractedFrame,
  type MediaContext,
} from '@taalcut/media';
import { findTestBinaries } from '../helpers/binaries';
import { makeFixtures, removeFixtures, type FixtureName, type Fixtures } from '../helpers/fixtures';

const found = await findTestBinaries('media backend integration');
const MAC = process.platform === 'darwin';
const CI = Boolean(process.env['CI']);
/** The row this platform decodes and encodes on first: videotoolbox, cuda, or none. */
const EXPECTED = hardwareBackends(process.platform)[0];

/** The backend this platform must use, allowing a GPU-less CI VM only when it says why. */
function expectHardwareOrRecordedFailure(result: {
  backend?: string;
  fallbackReason?: { code: string };
}): void {
  if (!EXPECTED) {
    expect(result).toMatchObject({ backend: 'software', fallbackReason: { code: 'no_hardware_backend' } });
  } else if (CI && result.backend === 'software') {
    expect(result.fallbackReason?.code).toBe('hardware_failed');
  } else {
    expect(result.backend).toBe(EXPECTED);
    expect(result.fallbackReason).toBeUndefined();
  }
}

describe.skipIf(!found.binaries)(
  `GPU-first decode and encode${found.binaries ? '' : ' (no FFmpeg found)'}`,
  () => {
    let fixtures: Fixtures | undefined;
    let scratch: string;
    let fallbacks: BackendFallback[];
    let ctx: MediaContext;

    beforeAll(async () => {
      fixtures = await makeFixtures({ binaries: found.binaries! }, [
        'h264',
        'rotated',
        'hevcHlg',
        'mjpeg',
        'mpeg4',
      ]);
      scratch = await mkdtemp(join(tmpdir(), 'taalcut-backends-'));
    });
    afterAll(async () => {
      await removeFixtures(fixtures);
      if (scratch) await rm(scratch, { recursive: true, force: true });
    });

    const setup = () => {
      fallbacks = [];
      ctx = {
        binaries: found.binaries!,
        hardwareFailures: new HardwareFailures(),
        onBackendFallback: (f) => fallbacks.push(f),
      };
    };
    const fixture = (t: { skip: (note?: string) => never }, name: FixtureName) =>
      fixtures?.paths[name] ??
      t.skip(`fixture '${name}' unavailable: ${fixtures?.missing[name] ?? 'not made'}`);

    /** Decoded RGB pixels of a PNG frame, to compare the two routes. */
    async function pixels(frame: ExtractedFrame, name: string): Promise<Buffer> {
      const path = join(scratch, `${name}.png`);
      await writeFile(path, frame.data);
      const raw = await runFfmpeg(ctx, ['-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
      if (!raw.ok) throw new Error(raw.error.detail);
      return raw.value.stdout;
    }
    const meanDifference = (a: Buffer, b: Buffer) => {
      let sum = 0;
      for (let i = 0; i < a.length; i++) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
      return sum / a.length;
    };

    it('decodes H.264 on the GPU', async (t) => {
      setup();
      const frame = await extractFrame(fixture(t, 'h264'), { value: 1, rate: 2 }, ctx, { maxDimension: 160 });
      expect(frame.ok && [frame.value.width, frame.value.height]).toEqual([160, 120]);
      if (frame.ok) expectHardwareOrRecordedFailure(frame.value);
      expect(fallbacks.length).toBe(frame.ok && frame.value.backend === 'software' ? 1 : 0);
    });

    it.for([
      ['rotated', 'a portrait phone clip, rotated on the GPU'],
      ['hevcHlg', '10-bit HLG HEVC'],
    ] as const)(
      '%s: the GPU frame matches the software frame (%s)',
      { timeout: 120_000 },
      async ([name], t) => {
        setup();
        const path = fixture(t, name);
        const at = { value: 1, rate: 2 };
        const options = { format: 'png', maxDimension: 160 } as const;
        const gpu = await extractFrame(path, at, ctx, options);
        const cpu = await extractFrame(path, at, ctx, { ...options, decode: 'software' });
        if (!gpu.ok || !cpu.ok) throw new Error('frame extraction failed');
        expectHardwareOrRecordedFailure(gpu.value);
        expect(cpu.value).toMatchObject({ backend: 'software', fallbackReason: { code: 'requested' } });
        expect([gpu.value.width, gpu.value.height]).toEqual([cpu.value.width, cpu.value.height]);
        // Already upright: no EXIF orientation left in the PNG for a viewer (or the decode below) to apply again.
        expect(gpu.value.data.includes('eXIf')).toBe(false);
        // Same picture, same way up: scalers differ slightly; a wrong rotation differs by ~100 or more.
        expect(
          meanDifference(await pixels(gpu.value, `${name}-gpu`), await pixels(cpu.value, `${name}-cpu`)),
        ).toBeLessThan(12);
        // The HLG frames go through libplacebo: on Linux each run opens the NVIDIA Vulkan device and compiles its
        // shaders (about 1.6 s on the RTX 4090), which a loaded machine stretches past the default.
      },
    );

    it('MJPEG has no hardware decoder (VideoToolbox, NVDEC): software, with the reason recorded and reported', async (t) => {
      setup();
      const frame = await extractFrame(fixture(t, 'mjpeg'), { value: 0, rate: 1 }, ctx);
      const code = EXPECTED ? 'codec_unsupported' : 'no_hardware_backend';
      expect(frame.ok && frame.value).toMatchObject({ backend: 'software', fallbackReason: { code } });
      expect(fallbacks).toMatchObject([{ operation: 'decode', subject: 'mjpeg.mov', reason: { code } }]);
    });

    it.runIf(MAC)('a runtime hardware failure retries once in software and is remembered', async (t) => {
      setup();
      const path = fixture(t, 'mpeg4');
      const first = await extractFrame(path, { value: 0, rate: 1 }, ctx);
      expect(first.ok).toBe(true);
      // Apple silicon can't run MPEG-4 Part 2 on VideoToolbox; an Intel Mac may.
      if (process.arch !== 'arm64' && first.ok && first.value.backend === 'videotoolbox') return;
      if (!first.ok) return;
      expect(first.value.fallbackReason?.code).toBe('hardware_failed');
      expect(first.value.fallbackReason?.detail).toMatch(/videotoolbox|hwaccel/i);
      const second = await extractFrame(path, { value: 0, rate: 1 }, ctx);
      expect(second.ok && second.value.fallbackReason?.detail).toMatch(/^failed earlier for this format/);
      expect(fallbacks.map((f) => f.reason.code)).toEqual(['hardware_failed', 'hardware_failed']);
    });

    it('media.extractFrame as a job: GPU first, the frame as base64, its backend in the output', async (t) => {
      const path = fixture(t, 'rotated');
      const media = createMediaService({
        resolver: { resolve: async () => ok(found.binaries!) },
        onBackendFallback: () => undefined,
      });
      const jobs = createDirectJobRunner(createMediaJobs(media));
      const result = await jobs.run(mediaExtractFrameJob, {
        path,
        at: { value: 1, rate: 2 },
        maxDimension: 160,
      });
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail ?? ''}`);
      expect([result.value.width, result.value.height]).toEqual([120, 160]);
      expect(Buffer.from(result.value.dataBase64, 'base64').subarray(0, 2)).toEqual(
        Buffer.from([0xff, 0xd8]),
      );
      expectHardwareOrRecordedFailure(result.value);
    });

    describe('selectWorkingEncoder', () => {
      it('picks the hardware H.264 and HEVC encoders after a trial encode', async () => {
        setup();
        for (const codec of ['h264', 'hevc'] as const) {
          const choice = await selectWorkingEncoder(ctx, codec);
          if (!EXPECTED) {
            // Windows in v1: software or nothing, never silently.
            if (choice.ok) expect(choice.value.fallbackReason?.code).toBe('no_hardware_backend');
            else expect(choice.error.code).toBe('media.no_encoder');
            continue;
          }
          if (CI && (!choice.ok || choice.value.backend === 'software')) {
            const why = choice.ok ? choice.value.fallbackReason?.code : choice.error.detail;
            expect(why).toContain('hardware_failed');
            continue;
          }
          expect(choice.ok && choice.value).toMatchObject({
            encoder: hardwareEncoderFor(EXPECTED, codec),
            backend: EXPECTED,
          });
        }
      });

      it.skipIf(!EXPECTED)('a hardware encoder that failed is passed over with the reason', async () => {
        setup();
        const hardware = hardwareEncoderFor(EXPECTED!, 'h264')!;
        const failed = { [hardware]: 'failed in an earlier render' };
        const choice = await selectWorkingEncoder(ctx, 'h264', { failed });
        // Software H.264 is Apple's OS encoder on macOS and OpenH264 elsewhere; x264 never counts.
        if (choice.ok) {
          expect(choice.value).toMatchObject({
            encoder: softwareEncoderFor('h264'),
            backend: 'software',
            fallbackReason: {
              code: 'hardware_failed',
              detail: `${hardware}: failed in an earlier render`,
            },
          });
          expect(fallbacks).toHaveLength(1);
        } else {
          expect(choice.error).toMatchObject({ code: 'media.no_encoder', params: { codec: 'h264' } });
          expect(choice.error.detail).toContain(`hardware_failed: ${hardware}: failed in an earlier render`);
        }
      });
    });
  },
);
