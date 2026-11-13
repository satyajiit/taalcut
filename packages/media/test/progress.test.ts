// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Progress parsing from a transcript recorded with FFmpeg 9.0.1
 * (`ffmpeg -progress pipe:1 -nostats -stats_period 0.2 -re -i h264.mp4 …`),
 * so it runs without FFmpeg.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ProgressParser,
  runFfmpeg,
  throttleProgress,
  type FfmpegProgress,
  type ProcessRunner,
} from '@taalcut/media';

const transcript = readFileSync(new URL('./fixtures/progress-ffmpeg-9.0.1.txt', import.meta.url), 'utf8');
const twoSecondsAt2997 = { value: 60060, rate: 30000 };

describe('ProgressParser', () => {
  it('parses every block of a recorded transcript', () => {
    const events = new ProgressParser().push(transcript);
    expect(events.map((e) => e.frame)).toEqual([0, 5, 11, 17, 24, 29, 60]);
    expect(events[0]).toEqual({
      frame: 0,
      fps: 0,
      outTime: { value: 128000, rate: 1000000 },
      speed: 0.628,
      bitrateKbps: 3,
      totalSizeBytes: 48,
      dupFrames: 0,
      dropFrames: 0,
      percent: undefined,
      done: false,
    });
    expect(events.at(-1)).toMatchObject({
      frame: 60,
      fps: 40.25,
      outTime: { value: 2002000, rate: 1000000 },
      speed: 1.34,
      bitrateKbps: 805.2,
      totalSizeBytes: 201509,
      done: true,
    });
    expect(events.slice(0, -1).every((e) => !e.done)).toBe(true);
  });

  it('gives the same events however stdout is chunked', () => {
    const whole = new ProgressParser(twoSecondsAt2997).push(transcript);
    const parser = new ProgressParser(twoSecondsAt2997);
    const chunked: FfmpegProgress[] = [];
    for (let i = 0; i < transcript.length; i += 7)
      chunked.push(...parser.push(Buffer.from(transcript.slice(i, i + 7))));
    expect(chunked).toEqual(whole);
  });

  it('computes percent from the expected duration, and 100 at the end', () => {
    const events = new ProgressParser(twoSecondsAt2997).push(transcript);
    expect(events[2]?.percent).toBeCloseTo((597333 / 2002000) * 100, 6);
    expect(events.at(-1)?.percent).toBe(100);
  });

  it('leaves N/A fields out and falls back to out_time', () => {
    const [early, clock] = new ProgressParser({ value: 10, rate: 1 }).push(
      'frame=0\nfps=0.00\nbitrate=N/A\ntotal_size=N/A\nout_time_us=N/A\nout_time_ms=N/A\nout_time=N/A\nspeed=N/A\nprogress=continue\n' +
        'frame=1\r\nout_time=00:00:05.500000\r\nprogress=continue\r\n',
    );
    expect(early).toMatchObject({ frame: 0, fps: 0, done: false });
    expect(early?.outTime).toBeUndefined();
    expect(early?.speed).toBeUndefined();
    expect(early?.bitrateKbps).toBeUndefined();
    expect(early?.percent).toBeUndefined();
    expect(clock?.outTime).toEqual({ value: 5500000, rate: 1000000 });
    expect(clock?.percent).toBe(55);
  });

  it('clamps a negative start time to zero', () => {
    const [event] = new ProgressParser().push('out_time_us=-21333\nprogress=continue\n');
    expect(event?.outTime).toEqual({ value: 0, rate: 1000000 });
  });
});

describe('throttleProgress', () => {
  it('passes the first event, then at most one per interval, and always the last', () => {
    let now = 0;
    const seen: number[] = [];
    const emit = throttleProgress(
      (e) => seen.push(e.frame ?? -1),
      500,
      () => now,
    );
    for (const [t, frame, done] of [
      [0, 1, false],
      [100, 2, false],
      [499, 3, false],
      [500, 4, false],
      [700, 5, false],
      [800, 6, true],
    ] as const) {
      now = t;
      emit({ frame, done });
    }
    expect(seen).toEqual([1, 4, 6]);
  });
});

describe('runFfmpeg with progress', () => {
  it('adds the progress flags and reports parsed events from stdout', async () => {
    let seenArgs: readonly string[] = [];
    const fakeRunner: ProcessRunner = async (_command, args, options) => {
      seenArgs = args;
      // Deliver the transcript in two uneven pieces, as a pipe would.
      options?.onStdout?.(Buffer.from(transcript.slice(0, 333)));
      options?.onStdout?.(Buffer.from(transcript.slice(333)));
      return {
        ok: true,
        value: { exitCode: 0, signal: null, stdout: Buffer.alloc(0), stderrTail: '', durationMs: 1 },
      };
    };
    const events: FfmpegProgress[] = [];
    const result = await runFfmpeg(
      { binaries: { ffmpeg: '/x/ffmpeg', ffprobe: '/x/ffprobe', source: 'env' }, runner: fakeRunner },
      ['-i', 'in.mp4', 'out.mp4'],
      // A CPU run (IX3-K2): the prelude keeps -nostdin; a run that may hold a video session reads its q.
      {
        onProgress: (e) => events.push(e),
        progressIntervalMs: 0,
        duration: twoSecondsAt2997,
        holdsVideoSession: false,
      },
    );
    expect(result.ok).toBe(true);
    expect(seenArgs).toEqual([
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'error',
      '-progress',
      'pipe:1',
      '-nostats',
      '-stats_period',
      '0.05', // clamped: FFmpeg rejects 0
      '-i',
      'in.mp4',
      'out.mp4',
    ]);
    expect(events).toHaveLength(7);
    expect(events.at(-1)).toMatchObject({ done: true, percent: 100 });
  });

  it('maps a non-zero exit to media.ffmpeg_failed with the stderr tail', async () => {
    const fakeRunner: ProcessRunner = async () => ({
      ok: true,
      value: {
        exitCode: 234,
        signal: null,
        stdout: Buffer.alloc(0),
        stderrTail: 'Error opening output',
        durationMs: 1,
      },
    });
    const result = await runFfmpeg(
      { binaries: { ffmpeg: '/x/ffmpeg', ffprobe: '/x/ffprobe', source: 'env' }, runner: fakeRunner },
      ['-v', 'warning', '-i', 'in.mp4', 'out.mp4'],
    );
    expect(!result.ok && result.error).toMatchObject({
      code: 'media.ffmpeg_failed',
      params: { exitCode: 234 },
    });
    expect(!result.ok && result.error.detail).toContain('Error opening output');
  });

  it('stamps the backend, and the reason for a software one, on every event', async () => {
    const fakeRunner: ProcessRunner = async (_command, _args, options) => {
      options?.onStdout?.(Buffer.from(transcript));
      return {
        ok: true,
        value: { exitCode: 0, signal: null, stdout: Buffer.alloc(0), stderrTail: '', durationMs: 1 },
      };
    };
    const ctx = {
      binaries: { ffmpeg: '/x/ffmpeg', ffprobe: '/x/ffprobe', source: 'env' },
      runner: fakeRunner,
    } as const;
    const reason = {
      code: 'encoder_missing',
      detail: 'h264_videotoolbox is not in this FFmpeg build',
    } as const;
    for (const backend of [
      { backend: 'videotoolbox' },
      { backend: 'software', fallbackReason: reason },
    ] as const) {
      const events: FfmpegProgress[] = [];
      await runFfmpeg(ctx, ['-i', 'in.mp4', 'out.mp4'], {
        onProgress: (e) => events.push(e),
        progressIntervalMs: 0,
        backend,
      });
      expect(events.length).toBeGreaterThan(1);
      for (const event of events) expect(event).toMatchObject(backend);
      if (backend.backend === 'videotoolbox') expect(events[0]).not.toHaveProperty('fallbackReason');
    }
  });
});
