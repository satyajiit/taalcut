// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The stall watch with stand-in commands (no FFmpeg, no VideoToolbox): a call that outlives the watch is reported
 * and left running, never signalled; a failing call rejects with its stderr; a good one leaves nothing behind.
 * Also which encoder each codec gets.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { videoCodecArgs } from '../src/encode';
import { planClip } from '../src/plan';
import { IX_V1 } from '../src/sets/ix-v1';
import { runWatched, stallReport, StallError } from '../src/stall';
import { STARTS_PROCESSES } from './starts-processes';

let dir = '';
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('runWatched', STARTS_PROCESSES, () => {
  it('reports a call that outlives the watch and leaves it running', async () => {
    dir = mkdtempSync(join(tmpdir(), 'taalcut-stall-'));
    const sampled: number[] = [];
    const watch = {
      stallMs: 200,
      reportDir: dir,
      sample: (pid: number) => {
        sampled.push(pid);
        return Promise.resolve('Call graph:\n  VTCompressionSessionCompleteFrames');
      },
      now: () => new Date('2026-10-17T02:40:14.000Z'),
    };
    const error = await runWatched('/bin/sleep', ['2'], watch).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StallError);
    const stall = error as StallError;
    expect(sampled).toEqual([stall.pid]);
    expect(alive(stall.pid)).toBe(true);
    expect(stall.report).toBe(join(dir, 'vt-stall-2026-10-17T024014Z.md'));
    const report = readFileSync(stall.report, 'utf8');
    expect(report).toContain(`# FFmpeg stalled (pid ${stall.pid})`);
    expect(report).toContain('/bin/sleep 2');
    expect(report).toContain('VTCompressionSessionCompleteFrames');
    expect(report).toContain('not killed');
  });

  it('rejects with the stderr of a call that fails, and cleans up after one that works', async () => {
    dir = mkdtempSync(join(tmpdir(), 'taalcut-stall-'));
    const watch = { stallMs: 10_000, reportDir: dir };
    await expect(
      runWatched('/bin/sh', ['-c', 'echo "Error encoding frame" >&2; exit 3'], watch),
    ).rejects.toThrow(/exit 3.*Error encoding frame/s);
    await runWatched('/usr/bin/true', [], watch);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('stallReport', () => {
  it('quotes arguments with spaces so the command can be pasted', () => {
    const text = stallReport({
      pid: 42,
      command: ['ffmpeg', '-filter_complex', '[0:v] scale=1080:1920 [v]'],
      startedAt: new Date('2026-10-17T02:30:14.000Z'),
      waitedMs: 600_000,
      stderrPath: '/bench/ffmpeg-1.stderr',
      sample: 'sample text\n',
    });
    expect(text).toContain("ffmpeg -filter_complex '[0:v] scale=1080:1920 [v]'");
    expect(text).toContain('no exit after 600 s');
  });
});

describe('videoCodecArgs', () => {
  it('encodes H.264 in software and HEVC with VideoToolbox (the LGPL build has no software HEVC)', () => {
    const h264 = IX_V1.clips.find((clip) => clip.codec === 'h264');
    const hevc = IX_V1.clips.find((clip) => clip.codec === 'hevc');
    if (h264 === undefined || hevc === undefined) throw new Error('ix-v1 has both codecs');
    expect(videoCodecArgs(planClip(IX_V1, h264)).slice(0, 4)).toEqual([
      '-c:v',
      'h264_videotoolbox',
      '-require_sw',
      '1',
    ]);
    expect(videoCodecArgs(planClip(IX_V1, hevc)).slice(0, 4)).toEqual([
      '-c:v',
      'hevc_videotoolbox',
      '-tag:v',
      'hvc1',
    ]);
  });
});
