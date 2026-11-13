// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Proxy encode flags, including the one 64 kb/s retry when the file is over 15%. */
import { writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { FfmpegFailed, makeProxy, type ProcessRunner } from '@taalcut/media';
import { videoPlan } from '../helpers/video-plan';

const ENCODERS = ` ------
 V..... h264_videotoolbox    VideoToolbox H.264 Encoder (codec h264)
 A..... aac                  AAC (Advanced Audio Coding)
`;

function output(stdout = '') {
  return ok({ exitCode: 0, signal: null, stdout: Buffer.from(stdout), stderrTail: '', durationMs: 1 });
}

describe('makeProxy arguments', () => {
  it('asks for a closed 0.5 s GOP, no B-frames and no software-escape flags', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taalcut-proxy-args-'));
    const out = join(dir, 'proxy.mp4');
    const seen: string[][] = [];
    const runner: ProcessRunner = async (_command, args) => {
      seen.push([...args]);
      const text = args.join(' ');
      if (text.includes('-encoders')) return output(ENCODERS);
      if (text.includes('testsrc2')) return output('');
      await writeFile(out, Buffer.alloc(1000));
      return output('');
    };
    const result = await makeProxy('/clip.mp4', videoPlan(), { binaries: bins(), runner, platform: 'darwin' }, {
      out,
      sizeBytes: 50_000_000,
      contentHash: 'cd'.repeat(32),
    });
    expect(result.ok).toBe(true);
    const encode = seen.find((args) => args.includes(out));
    expect(encode).toBeDefined();
    const text = encode?.join(' ') ?? '';
    expect(text).toContain('-g 15');
    expect(text).toContain('-bf 0');
    expect(text).toContain('-profile:v high');
    expect(text).not.toContain('-allow_sw');
    expect(text).not.toContain('-forced-idr');
    expect(text).not.toContain('-q:v');
  });

  it('re-encodes once at 64 kb/s audio when the file is over 15%', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taalcut-proxy-retry-'));
    const out = join(dir, 'proxy.mp4');
    const encodes: string[] = [];
    const runner: ProcessRunner = async (_command, args) => {
      const text = args.join(' ');
      if (text.includes('-encoders')) return output(ENCODERS);
      if (text.includes('testsrc2')) return output('');
      encodes.push(text);
      await writeFile(out, Buffer.alloc(2_000_000));
      return output('');
    };
    const result = await makeProxy('/clip.mp4', videoPlan({ rotation: 90, displayWidth: 240, displayHeight: 320 }, true), {
      binaries: bins(),
      runner,
      platform: 'darwin',
    }, { out, sizeBytes: 10_000_000 });
    expect(result.ok && result.value.overBudget).toBe(true);
    expect(encodes).toHaveLength(2);
    expect(encodes[1]).toContain('-b:a 64k');
  });

  it('reuses a preview-friendly original under the bitrate floor without encoding', async () => {
    let calls = 0;
    const runner: ProcessRunner = async () => {
      calls += 1;
      return err(FfmpegFailed({ exitCode: 1 }, { detail: 'should not run' }));
    };
    const result = await makeProxy('/clip.mp4', videoPlan(), { binaries: bins(), runner }, {
      out: '/tmp/unused.mp4',
      sizeBytes: 1000,
    });
    expect(result.ok && result.value.reusedOriginal).toBe(true);
    expect(calls).toBe(0);
  });
});

function bins() {
  return { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', source: 'dev-build' as const };
}
