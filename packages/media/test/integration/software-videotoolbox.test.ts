// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  hardwareSessionWeight,
  isHardwareEncoder,
  probeMedia,
  runFfmpeg,
  selectEncoder,
  softwareEncoderFor,
  trialEncodeArgs,
  videoEncodeFlags,
} from '@taalcut/media';
import { findTestBinaries } from '../helpers/binaries';

const found = await findTestBinaries('Apple software H.264 fallback');

describe('explicit Apple CPU H.264 route', () => {
  it('keeps hardware first and emits require_sw only for the CPU fallback', () => {
    const available = [{ name: 'h264_videotoolbox' }];
    const hardware = selectEncoder('h264', available, { platform: 'darwin' });
    expect(hardware.ok && hardware.value.backend).toBe('videotoolbox');
    const software = selectEncoder('h264', available, {
      platform: 'darwin',
      failed: { h264_videotoolbox: 'hardware session refused' },
    });
    expect(software.ok && software.value).toMatchObject({
      backend: 'software',
      fallbackReason: { code: 'hardware_failed' },
    });
    if (!hardware.ok || !software.ok) throw new Error('expected both encoder routes');
    expect(isHardwareEncoder(software.value.encoder)).toBe(false);
    const flags = videoEncodeFlags(software.value.encoder, 400_000, 30);
    expect(flags.slice(0, 4)).toEqual(['-c:v', 'h264_videotoolbox', '-require_sw', '1']);
    expect(hardwareSessionWeight(flags)).toBe(0);
    const trial = trialEncodeArgs(software.value.encoder);
    expect(trial).not.toContain(software.value.encoder);
    expect(trial.join(' ')).toContain('-c:v h264_videotoolbox -require_sw 1');
    expect(videoEncodeFlags(hardware.value.encoder, 400_000, 30)).not.toContain('-require_sw');
    expect(softwareEncoderFor('h264', 'linux')).toBe('libopenh264');
  });

  it.skipIf(process.platform !== 'darwin' || !found.binaries)(
    'encodes a real H.264 file using only the Apple software codec',
    async () => {
      const ctx = { binaries: found.binaries! };
      const dir = await mkdtemp(join(tmpdir(), 'taalcut-apple-software-'));
      try {
        const out = join(dir, 'software.mp4');
        const encoded = await runFfmpeg(
          ctx,
          [
            '-f',
            'lavfi',
            '-i',
            'testsrc2=size=320x240:rate=30',
            '-frames:v',
            '2',
            '-an',
            ...videoEncodeFlags(softwareEncoderFor('h264', 'darwin')!, 400_000, 30),
            out,
          ],
          { timeoutMs: 30_000, holdsVideoSession: false },
        );
        expect(encoded.ok, encoded.ok ? undefined : encoded.error.detail).toBe(true);
        const probed = await probeMedia(out, ctx);
        expect(probed.ok && probed.value.video?.codec).toBe('h264');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    40_000,
  );
});
