// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-F16: `keyframeTimes` hands ffprobe the file as every user file goes (`file:`, local files only, the demuxer
 * allow-list), so a name like `http:clip.mp4` is a file, and keeps only keyframe packets with a time.
 */
import { resolve } from 'node:path';
import { ok } from '@taalcut/core';
import { keyframeTimes, USER_MEDIA_DEMUXERS, type MediaContext, type ProcessRunner } from '@taalcut/media';
import { describe, expect, it } from 'vitest';

const PACKETS = [
  '2.000000,K__',
  'N/A,K__',
  '0.500000,___',
  '0.000000,K_',
  ',K__',
  '1.000000,K_D',
  'nan,K__',
  '',
];

describe('keyframeTimes', () => {
  it('reads the file as a user file and keeps keyframes with a finite time', async () => {
    const calls: string[][] = [];
    const runner: ProcessRunner = async (_command, args) => {
      calls.push([...args]);
      return ok({
        exitCode: 0,
        signal: null,
        stdout: Buffer.from(PACKETS.join('\n')),
        stderrTail: '',
        durationMs: 1,
      });
    };
    const ctx: MediaContext = {
      binaries: { ffmpeg: '/bin/ffmpeg', ffprobe: '/bin/ffprobe', source: 'dev-build' },
      runner,
    };
    expect(await keyframeTimes(ctx, 'http:clip.mp4')).toEqual(ok([0, 1, 2]));
    const args = calls[0] ?? [];
    expect(args.slice(-2)).toEqual(['-i', `file:${resolve('http:clip.mp4')}`]);
    expect(args[args.indexOf('-protocol_whitelist') + 1]).toBe('file');
    expect(args[args.indexOf('-format_whitelist') + 1]).toBe(USER_MEDIA_DEMUXERS.join(','));
    // A still goes to its pipe demuxer, as probeArgs sends it.
    await keyframeTimes(ctx, '/photos/a.jpg');
    expect(calls[1]?.slice(-4)).toEqual(['-f', 'jpeg_pipe', '-i', 'file:/photos/a.jpg']);
  });
});
