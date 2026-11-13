// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1-AV1, finishing and QA: an AV1 preset's picture re-encoded on NVENC AV1 with media's measured export flags and
 * `av1_metadata` at the mux; a refused NVENC AV1 session retried once on SVT-AV1, reported as `render.encode`
 * `accelerator_failed`; never AV1 on the CPU up front (a Mac); HEVC chosen on Reels; and QA's codec check following
 * the codec the export was asked for (AV1 Main in `av01`, HEVC Main in `hvc1`).
 */
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FrameRate, ok, type ComputeFallbackEvent, type ExportPreset } from '@taalcut/core';
import type { MediaContext, ProcessRunner } from '@taalcut/media';
import { finishRender } from '../../src/engine/finish';
import { presetFor, presetInCodec } from '../../src/presets/presets.v1';
import { codecCheck } from '../../src/qa/checks/format';
import { parseStreamFacts } from '../../src/qa/measure/stream-facts';
import { knownEncoders } from '../support/host-video';
import { NVENC_REFUSED } from '../support/refusing';

const AV1_REFUSED = NVENC_REFUSED.replaceAll('h264_nvenc', 'av1_nvenc');

/** Records every FFmpeg run; refuses the encoders named in `refused` as nvenc.c does, otherwise writes the output. */
function recording(encoders: Parameters<typeof knownEncoders>[0], refused: readonly string[] = []) {
  const runs: (readonly string[])[] = [];
  const runner: ProcessRunner = async (_command, args) => {
    runs.push(args);
    const exit = (exitCode: number, stderrTail = '') =>
      ok({ exitCode, signal: null, stdout: Buffer.alloc(0), stderrTail, durationMs: 1 });
    if (refused.some((name) => args.includes(name))) return exit(1, AV1_REFUSED);
    const out = args[args.length - 1];
    if (out) await writeFile(out, 'encoded');
    return exit(0);
  };
  const ctx: MediaContext = {
    binaries: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', source: 'sidecar' },
    runner,
    platform: 'linux',
    encoders: knownEncoders(encoders),
  };
  return { runs, ctx };
}

const NVIDIA = { h264: 'h264_nvenc', hevc: 'hevc_nvenc', av1: 'av1_nvenc' } as const;

async function finish(preset: ExportPreset, ctx: MediaContext, fallbacks: ComputeFallbackEvent[] = []) {
  return finishRender({
    video: join(tmpdir(), 'picture.mp4'),
    audio: join(tmpdir(), 'mix.m4a'),
    out: join(tmpdir(), `taalcut-av1-${preset.id}-${process.pid}.mp4`),
    preset,
    rate: FrameRate.of(30),
    ctx,
    onFallback: (event) => fallbacks.push(event),
  });
}

describe('finishing an AV1 export', () => {
  it('encodes on NVENC AV1 with the measured export flags, and the mux writes the colour into the sequence header', async () => {
    const { runs, ctx } = recording(NVIDIA);
    const fallbacks: ComputeFallbackEvent[] = [];
    const finished = await finish(presetFor('youtubeAv1'), ctx, fallbacks);
    expect(finished.ok && finished.value.video).toBe('av1_nvenc');
    const encode = runs[0]?.join(' ') ?? '';
    expect(encode).toContain(
      '-c:v av1_nvenc -preset p5 -tune uhq -rc vbr -cq 25 -b:v 8000000 -maxrate 12000000',
    );
    expect(encode).toContain('-bf 4 -b_ref_mode middle -g 30 -pix_fmt yuv420p');
    expect(encode).not.toContain('-profile:v');
    expect(encode).not.toContain('hvc1');
    const mux = runs[1]?.join(' ') ?? '';
    expect(mux).toContain(
      '-bsf:v av1_metadata=color_primaries=1:transfer_characteristics=1:matrix_coefficients=1:color_range=tv',
    );
    expect(fallbacks).toEqual([]);
  });

  it('retries a refused NVENC AV1 session once on SVT-AV1, reported as render.encode accelerator_failed', async () => {
    const { runs, ctx } = recording(NVIDIA, ['av1_nvenc']);
    const fallbacks: ComputeFallbackEvent[] = [];
    const finished = await finish(presetFor('deviceAv1'), ctx, fallbacks);
    expect(finished.ok && finished.value.video).toBe('libsvtav1');
    expect(runs.slice(0, 2).map((args) => args[args.indexOf('-c:v') + 1])).toEqual([
      'av1_nvenc',
      'libsvtav1',
    ]);
    expect(runs[2]?.join(' ')).toContain('-bsf:v av1_metadata=');
    expect(runs[1]?.join(' ')).toContain(
      '-c:v libsvtav1 -preset 8 -crf 20 -maxrate 12000000 -bufsize 16000000',
    );
    expect(fallbacks).toEqual([
      {
        operation: 'render.encode',
        wanted: ['nvenc'],
        reason: 'accelerator_failed',
        detail: expect.stringMatching(/NVENC encoder would not start/),
      },
    ]);
  });

  it('never starts AV1 on the CPU: a Mac (SVT-AV1 the only AV1 encoder) is refused before encoding', async () => {
    const { runs, ctx } = recording({
      h264: 'h264_videotoolbox',
      hevc: 'hevc_videotoolbox',
      av1: 'libsvtav1',
    });
    const fallbacks: ComputeFallbackEvent[] = [];
    const finished = await finish(presetFor('youtubeAv1'), { ...ctx, platform: 'darwin' }, fallbacks);
    expect(finished.ok ? null : finished.error.code).toBe('render.codec_unavailable');
    expect(runs).toEqual([]);
    expect(fallbacks).toEqual([]);
  });

  it('Reels in HEVC: the picture re-encoded on NVENC HEVC, Main and hvc1', async () => {
    const { runs, ctx } = recording(NVIDIA);
    const finished = await finish(presetInCodec(presetFor('reels'), 'hevc')!, ctx);
    expect(finished.ok && finished.value.video).toBe('hevc_nvenc');
    const encode = runs[0]?.join(' ') ?? '';
    expect(encode).toContain('-c:v hevc_nvenc');
    expect(encode).toContain('-profile:v main');
    expect(encode).toContain('-tag:v hvc1');
    expect(runs[1]?.join(' ')).toContain('-bsf:v hevc_metadata=colour_primaries=1');
  });
});

describe('QA’s codec check follows the chosen codec', () => {
  /** ffprobe's JSON for a finished 1080×1920 export in `video`'s codec, with AAC LC stereo at 48 kHz. */
  const facts = (video: Record<string, unknown>) =>
    parseStreamFacts(
      {
        format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '10', size: '1000' },
        streams: [
          {
            codec_type: 'video',
            pix_fmt: 'yuv420p',
            color_range: 'tv',
            color_space: 'bt709',
            color_transfer: 'bt709',
            color_primaries: 'bt709',
            field_order: 'progressive',
            ...video,
          },
          { codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_rate: '48000', channels: 2 },
        ],
      },
      ['ftyp', 'moov', 'mdat'],
    );
  const AV1 = { codec_name: 'av1', profile: 'Main', codec_tag_string: 'av01' };
  const HEVC = { codec_name: 'hevc', profile: 'Main', codec_tag_string: 'hvc1' };
  const H264 = { codec_name: 'h264', profile: 'High', level: 40, codec_tag_string: 'avc1' };
  const failed = (result: ReturnType<typeof codecCheck>) =>
    result.status === 'pass' ? [] : result.findings.map((finding) => finding.target?.id);

  it('passes AV1 Main in av01 for an AV1 preset, and fails H.264 there', () => {
    expect(codecCheck(facts(AV1), presetFor('youtubeAv1')).status).toBe('pass');
    expect(failed(codecCheck(facts(H264), presetFor('youtubeAv1')))).toEqual([
      'videoCodec',
      'profile',
      'tag',
    ]);
    expect(failed(codecCheck(facts({ ...AV1, codec_tag_string: 'av1C' }), presetFor('deviceAv1')))).toEqual([
      'tag',
    ]);
    expect(failed(codecCheck(facts({ ...AV1, profile: 'High' }), presetFor('deviceAv1')))).toEqual([
      'profile',
    ]);
  });

  it('passes HEVC Main in hvc1 when Reels was asked for in HEVC, and fails it on Reels’ default', () => {
    const reelsHevc = presetInCodec(presetFor('reels'), 'hevc')!;
    expect(codecCheck(facts(HEVC), reelsHevc).status).toBe('pass');
    expect(failed(codecCheck(facts({ ...HEVC, codec_tag_string: 'hev1' }), reelsHevc))).toEqual(['tag']);
    expect(failed(codecCheck(facts(HEVC), presetFor('reels')))).toEqual(['videoCodec', 'profile', 'level']);
    expect(codecCheck(facts(H264), presetFor('reels')).status).toBe('pass');
  });
});
