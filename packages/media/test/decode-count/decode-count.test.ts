// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-D6: which commands are probes, whole-stream decodes, partial decodes or
 * no video decode at all, read from the arguments media really builds; and
 * the counting runner, which records each command and keeps a gated runner gated.
 */
import { ok } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  classifyCommand,
  countedContext,
  countingRunner,
  createDecodeTally,
  gateHardwareSessions,
  type HardwareSessionGate,
  type ProcessOutput,
  type ProcessRunner,
} from '@taalcut/media';

const VT = ['-noautorotate', '-hwaccel', 'videotoolbox', '-hwaccel_output_format', 'videotoolbox_vld'];
const IN = ['-protocol_whitelist', 'file', '-i', 'file:/footage/a.mov', '-map', '0:V:0', '-an'];
const RAW = ['-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'];
const DONE: ProcessOutput = {
  exitCode: 0,
  signal: null,
  stdout: Buffer.alloc(0),
  stderrTail: '',
  durationMs: 1,
};

describe('classifyCommand', () => {
  it('tells ffprobe from FFmpeg, and anything else from both', () => {
    expect(classifyCommand('/bin/ffprobe', ['-i', 'a.mov']).kind).toBe('ffprobe');
    expect(classifyCommand('/opt/whisper-cli', ['-f', 'a.wav'])).toEqual({
      kind: 'other',
      decode: 'none',
      inputs: [],
    });
  });

  it('counts a pass over the whole stream as a full decode of that file', () => {
    const pass = classifyCommand('/x/ffmpeg', [...VT, ...IN, '-vf', 'scale_vt=w=256:h=144,scdet', ...RAW]);
    expect(pass).toEqual({ kind: 'ffmpeg', decode: 'full', inputs: ['/footage/a.mov'] });
  });

  it('counts a select without a seek as full: it decodes up to the last frame it keeps', () => {
    const thumb = [...VT, ...IN, '-vf', "select='eq(n\\,9)',thumbnail=n=5", '-frames:v', '1', 'o.jpg'];
    expect(classifyCommand('ffmpeg', thumb).decode).toBe('full');
  });

  it('counts a seek, a trim or an output limit as a partial decode', () => {
    expect(
      classifyCommand('ffmpeg', ['-ss', '4.000000', ...VT, ...IN, '-vf', 'fps=30,trim=end_frame=9', ...RAW])
        .decode,
    ).toBe('partial');
    expect(classifyCommand('ffmpeg', [...VT, '-ss', '1.0', ...IN, '-frames:v', '1', 'f.png']).decode).toBe(
      'partial',
    );
    expect(classifyCommand('ffmpeg', [...IN, '-frames:v', '1', 'f.png']).decode).toBe('partial');
  });

  it('counts audio-only work, raw frames piped in and listings as no video decode', () => {
    expect(
      classifyCommand('ffmpeg', ['-i', '/footage/a.mov', '-vn', '-map', '0:a:0', '-f', 's16le', 'pipe:1'])
        .decode,
    ).toBe('none');
    expect(classifyCommand('ffmpeg', ['-i', '/footage/a.mov', '-map', '0:a:0', 'a.wav']).decode).toBe('none');
    expect(classifyCommand('ffmpeg', ['-f', 'rawvideo', '-s', '4x4', '-i', '/c/f.raw', 'o.jpg']).decode).toBe(
      'none',
    );
    expect(classifyCommand('ffmpeg', ['-hide_banner', '-encoders']).decode).toBe('none');
  });

  it('names every decoded file, without the file: prefix', () => {
    const two = ['-i', 'file:/a/one.mov', '-i', '/a/two.mov', '-filter_complex', '[0:v][1:v]hstack', 'o.mp4'];
    expect(classifyCommand('ffmpeg', two).inputs).toEqual(['/a/one.mov', '/a/two.mov']);
  });
});

describe('the decode tally', () => {
  it('counts processes and decodes, and decodes of the original apart', () => {
    const tally = createDecodeTally('/footage/a.mov');
    tally.record('/x/ffprobe', ['-i', '/footage/a.mov']);
    tally.record('/x/ffmpeg', [...VT, ...IN, '-vf', 'scdet', ...RAW]);
    tally.record('/x/ffmpeg', [...VT, '-i', '/cache/proxy.mp4', '-vf', 'scdet', ...RAW]);
    tally.record('/x/ffmpeg', ['-ss', '1.0', ...VT, ...IN, '-frames:v', '1', 'f.png']);
    expect(tally.snapshot()).toEqual({
      ffmpeg: 3,
      ffprobe: 1,
      fullDecodes: 2,
      partialDecodes: 1,
      originalFullDecodes: 1,
    });
  });

  it('counts the decodes of a decode service (IX2-V3), which spawn no FFmpeg, through the counted context', () => {
    const tally = createDecodeTally('/footage/a.mov');
    const ctx = countedContext(
      { binaries: { ffmpeg: '/x/ffmpeg', ffprobe: '/x/ffprobe', source: 'env' } },
      tally,
    );
    ctx.decodeTally?.recordDecode('full', '/footage/a.mov');
    ctx.decodeTally?.recordDecode('full', '/cache/proxy.mp4');
    ctx.decodeTally?.recordDecode('partial', '/footage/a.mov');
    expect(tally.snapshot()).toEqual({
      ffmpeg: 0,
      ffprobe: 0,
      fullDecodes: 2,
      partialDecodes: 1,
      originalFullDecodes: 1,
    });
  });

  it('records each command before running it, through the context runner', async () => {
    const ran: string[] = [];
    const inner: ProcessRunner = async (command) => {
      ran.push(command);
      return ok(DONE);
    };
    const tally = createDecodeTally();
    const binaries = { ffmpeg: '/x/ffmpeg', ffprobe: '/x/ffprobe', source: 'env' as const };
    const ctx = countedContext({ binaries, runner: inner }, tally);
    await ctx.runner!('/x/ffmpeg', [...IN, ...RAW]);
    expect(ran).toEqual(['/x/ffmpeg']);
    expect(tally.snapshot().fullDecodes).toBe(1);
  });

  it('keeps a gated runner gated, so gating it again does not wait twice', async () => {
    let acquired = 0;
    const gate: HardwareSessionGate = {
      acquire: async (weight) => {
        acquired += weight;
        return ok({ weight, release: async () => undefined });
      },
      limit: async () => 1,
      inUse: async () => acquired,
    };
    const gated = gateHardwareSessions(gate, async () => ok(DONE));
    const counted = countingRunner(createDecodeTally(), gated);
    // Gating the counted runner again must hand it back unchanged (one wait per command).
    expect(gateHardwareSessions(gate, counted)).toBe(counted);
    await counted('/x/ffmpeg', [...VT, ...IN, ...RAW]);
    expect(acquired).toBe(1);
  });
});
