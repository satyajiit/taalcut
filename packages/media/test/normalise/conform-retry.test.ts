// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** One hardware decode failure (VideoToolbox on a Mac, NVDEC on Linux) is retried on the software route. */
import { writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { FfmpegFailed, conform, type ProcessRunner } from '@taalcut/media';
import { videoPlan } from '../helpers/video-plan';

const ENCODERS = ` ------
 V..... h264_videotoolbox    VideoToolbox H.264 Encoder (codec h264)
 V..... h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)
 A..... aac                  AAC (Advanced Audio Coding)
`;

function output(stdout = '') {
  return ok({ exitCode: 0, signal: null, stdout: Buffer.from(stdout), stderrTail: '', durationMs: 1 });
}

describe('conform software retry', () => {
  it.each([
    { platform: 'darwin' as const, hwaccel: '-hwaccel videotoolbox', encoder: 'h264_videotoolbox' },
    { platform: 'linux' as const, hwaccel: '-hwaccel cuda', encoder: 'h264_nvenc' },
  ])('retries a $platform hardware decode failure once without hwaccel', async ({ platform, hwaccel, encoder }) => {
    const dir = await mkdtemp(join(tmpdir(), 'taalcut-conform-'));
    const out = join(dir, 'out.mp4');
    const encodes: string[] = [];
    const runner: ProcessRunner = async (command, args) => {
      const text = args.join(' ');
      if (command === 'ffprobe') {
        if (text.includes('nb_read_packets')) return output('320,240,60');
        return output('');
      }
      if (text.includes('-encoders')) return output(ENCODERS);
      if (text.includes('testsrc2')) return output('');
      encodes.push(text);
      if (encodes.length === 1) return err(FfmpegFailed({ exitCode: 1 }, { detail: 'hardware decode failed' }));
      await writeFile(out, 'mp4');
      return output('');
    };
    const result = await conform('/clip.mp4', videoPlan({}, false, platform), {
      binaries: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', source: 'dev-build' },
      runner,
      platform,
    }, { out, codec: 'h264' });
    expect(result.ok && result.value.driftMs).toBe(0);
    expect(encodes).toHaveLength(2);
    expect(encodes[0]).toContain(hwaccel);
    expect(encodes[0]).toContain(`-c:v ${encoder}`);
    expect(encodes[1]).not.toContain('-hwaccel');
    expect(encodes[1]).toContain(`-c:v ${encoder}`);
  });
});
