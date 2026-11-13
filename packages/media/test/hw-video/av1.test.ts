// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AV1 in the table (LNX1-AV1): NVENC's AV1 export flags (measured on the RTX 4090 host, media SPEC "AV1"), the
 * `av1_metadata` colour filter, SVT-AV1's flags as the CPU fallback, the rows that have an AV1 encoder, encoder
 * choice, the minimum frame, and `hardwareEncoders`, the machine's answer render gates its AV1 presets on.
 */
import { err, ok } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import {
  backendOfEncoder,
  colourBitstreamFilter,
  encoderForSize,
  FfmpegFailed,
  hardwareEncoderFor,
  hardwareEncoders,
  HW_VIDEO_BACKENDS,
  selectEncoder,
  softwareEncoderFor,
  summariseEncoders,
  parseEncoders,
  SVT_AV1,
  videoEncodeFlags,
  type MediaContext,
  type ProcessRunner,
} from '@taalcut/media';

const SDR_AV1_BSF =
  'av1_metadata=color_primaries=1:transfer_characteristics=1:matrix_coefficients=1:color_range=tv';
const SDR_TAGS = [
  '-color_primaries',
  'bt709',
  '-color_trc',
  'bt709',
  '-colorspace',
  'bt709',
  '-color_range',
  'tv',
];
const MUX = [
  '-video_track_timescale',
  '90000',
  '-movflags',
  '+faststart',
  '-muxdelay',
  '0',
  '-muxpreload',
  '0',
];

describe('AV1 flags', () => {
  it('NVENC export: p5 on the uhq tune at CQ 25 with four B-frames, no profile option, no tag, the colour in the sequence header', () => {
    expect(videoEncodeFlags('av1_nvenc', 8_000_000, 30, { purpose: 'export' })).toEqual([
      '-c:v',
      'av1_nvenc',
      ...['-preset', 'p5', '-tune', 'uhq', '-rc', 'vbr', '-cq', '25'],
      ...['-b:v', '8000000', '-maxrate', '12000000', '-bufsize', '16000000'],
      ...['-spatial-aq', '1', '-temporal-aq', '1', '-rc-lookahead', '20'],
      ...['-bf', '4', '-b_ref_mode', 'middle', '-g', '30'],
      '-pix_fmt',
      'yuv420p',
      ...SDR_TAGS,
      '-bsf:v',
      SDR_AV1_BSF,
      ...MUX,
    ]);
  });

  it('NVENC HDR: 10-bit from P010 with BT.2020 and HLG or PQ', () => {
    const hlg = videoEncodeFlags('av1_nvenc', 8_000_000, 30, { purpose: 'export', hdr: 'hlg' }).join(' ');
    expect(hlg).toContain(
      '-pix_fmt p010le -color_primaries bt2020 -color_trc arib-std-b67 -colorspace bt2020nc',
    );
    expect(hlg).toContain(
      'av1_metadata=color_primaries=9:transfer_characteristics=18:matrix_coefficients=9:color_range=tv',
    );
    expect(hlg).not.toContain('-profile:v');
    const pq = videoEncodeFlags('av1_nvenc', 8_000_000, 30, { purpose: 'export', hdr: 'pq' }).join(' ');
    expect(pq).toContain('-color_trc smpte2084');
    expect(pq).toContain('transfer_characteristics=16');
  });

  it('the colour filter names AV1’s fields its own way', () => {
    expect(colourBitstreamFilter('av1')).toBe(SDR_AV1_BSF);
    expect(colourBitstreamFilter('av1', 'pq')).toBe(
      'av1_metadata=color_primaries=9:transfer_characteristics=16:matrix_coefficients=9:color_range=tv',
    );
    expect(colourBitstreamFilter('hevc')).toContain('hevc_metadata=colour_primaries=1');
  });

  it('SVT-AV1: capped CRF under the same ceiling, its own B-frames, 8-bit BT.709 or 10-bit BT.2020', () => {
    expect(videoEncodeFlags('libsvtav1', 8_000_000, 30, { purpose: 'export' })).toEqual([
      '-c:v',
      'libsvtav1',
      ...['-preset', String(SVT_AV1.preset), '-crf', String(SVT_AV1.crf)],
      ...['-maxrate', '12000000', '-bufsize', '16000000', '-g', '30'],
      '-pix_fmt',
      'yuv420p',
      ...SDR_TAGS,
      '-bsf:v',
      SDR_AV1_BSF,
      ...MUX,
    ]);
    const hdr = videoEncodeFlags('libsvtav1', 8_000_000, 30, { purpose: 'export', hdr: 'hlg' }).join(' ');
    expect(hdr).toContain('-pix_fmt yuv420p10le -color_primaries bt2020 -color_trc arib-std-b67');
    expect(hdr).toContain('transfer_characteristics=18');
    expect(hdr).not.toContain('-b:v');
  });
});

describe('AV1 in the table', () => {
  it('NVENC and the Windows slots have AV1 encoders; VideoToolbox and VA-API none', () => {
    expect(hardwareEncoderFor('cuda', 'av1')).toBe('av1_nvenc');
    expect(hardwareEncoderFor('qsv', 'av1')).toBe('av1_qsv');
    expect(hardwareEncoderFor('amf', 'av1')).toBe('av1_amf');
    expect(hardwareEncoderFor('mf', 'av1')).toBe('av1_mf');
    expect(hardwareEncoderFor('videotoolbox', 'av1')).toBeUndefined();
    expect(hardwareEncoderFor('vaapi', 'av1')).toBeUndefined();
    expect(backendOfEncoder('av1_nvenc')?.id).toBe('cuda');
    expect(backendOfEncoder('libsvtav1')).toBeUndefined();
    expect(softwareEncoderFor('av1')).toBe('libsvtav1');
    expect(softwareEncoderFor('hevc')).toBeUndefined();
    // A slot's AV1 gets the slot's system-frame flags and AV1's colour filter.
    const qsv = HW_VIDEO_BACKENDS.qsv.encode!.flags({
      encoder: 'av1_qsv',
      purpose: 'export',
      videoBps: 8e6,
      gop: 30,
    });
    expect(qsv.join(' ')).toContain(`-bsf:v ${SDR_AV1_BSF}`);
    expect(qsv).not.toContain('hvc1');
  });

  const BUILD = ['h264_nvenc', 'hevc_nvenc', 'av1_nvenc', 'libopenh264', 'libsvtav1'].map((name) => ({
    name,
  }));

  it('picks av1_nvenc on Linux, and SVT-AV1 with the reason when the hardware failed or the Mac has none', () => {
    expect(selectEncoder('av1', BUILD, { platform: 'linux' })).toEqual(
      ok({ codec: 'av1', encoder: 'av1_nvenc', backend: 'cuda' }),
    );
    const failed = selectEncoder('av1', BUILD, { platform: 'linux', failed: { av1_nvenc: 'refused' } });
    expect(failed.ok && failed.value).toMatchObject({
      encoder: 'libsvtav1',
      backend: 'software',
      fallbackReason: { code: 'hardware_failed', detail: 'av1_nvenc: refused' },
    });
    const mac = selectEncoder('av1', [{ name: 'h264_videotoolbox' }, { name: 'libsvtav1' }], {
      platform: 'darwin',
    });
    expect(mac.ok && mac.value.fallbackReason).toEqual({
      code: 'codec_unsupported',
      detail: 'the videotoolbox row has no av1 encoder',
    });
    // A build without SVT-AV1 has nowhere to go.
    expect(selectEncoder('av1', [{ name: 'h264_videotoolbox' }], { platform: 'darwin' }).ok).toBe(false);
  });

  it('sends frames below NVENC AV1’s minimum (130×66) to SVT-AV1', () => {
    const nvenc = { codec: 'av1' as const, encoder: 'av1_nvenc', backend: 'cuda' as const };
    expect(encoderForSize(nvenc, { width: 130, height: 66 })).toEqual(ok(nvenc));
    const small = encoderForSize(nvenc, { width: 129, height: 200 });
    expect(small.ok && small.value).toMatchObject({
      encoder: 'libsvtav1',
      fallbackReason: {
        code: 'format_unsupported',
        detail: 'av1_nvenc needs at least 130×66, this is 129×200',
      },
    });
  });

  it('summarises the best AV1 encoder the build has', () => {
    const listing = (names: string[]) =>
      parseEncoders(
        ['------', ...names.map((name) => ` V....D ${name}   An encoder (codec av1)`)].join('\n'),
      );
    expect(summariseEncoders(listing(['av1_nvenc', 'libsvtav1']), 'linux').preferredAv1).toBe('av1_nvenc');
    expect(summariseEncoders(listing(['av1_nvenc', 'libsvtav1']), 'darwin').preferredAv1).toBe('libsvtav1');
    expect(summariseEncoders(listing(['av1_qsv']), 'win32').preferredAv1).toBeUndefined();
  });
});

describe('hardwareEncoders', () => {
  const LISTING = [
    'Encoders:',
    '------',
    ' V....D libopenh264          OpenH264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)',
    ' V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)',
    ' V....D hevc_nvenc           NVIDIA NVENC hevc encoder (codec hevc)',
    ' V....D av1_nvenc            NVIDIA NVENC av1 encoder (codec av1)',
    ' V..... libsvtav1            SVT-AV1(Scalable Video Technology for AV1) encoder (codec av1)',
  ].join('\n');

  /** A Linux machine whose trial encodes pass, except for the encoders named in `refused`. */
  function machine(refused: readonly string[], runs: string[]): MediaContext {
    const runner: ProcessRunner = async (_command, args) => {
      const line = args.join(' ');
      runs.push(line);
      const done = (stdout = '') =>
        ok({ exitCode: 0, signal: null, stdout: Buffer.from(stdout), stderrTail: '', durationMs: 1 });
      if (args.includes('-encoders')) return done(LISTING);
      const encoder = args[args.indexOf('-c:v') + 1] ?? '';
      if (refused.includes(encoder))
        return err(
          FfmpegFailed({ exitCode: 1 }, { detail: `[${encoder} @ 0x1] OpenEncodeSessionEx failed` }),
        );
      return done();
    };
    return {
      binaries: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', source: 'dev-build' },
      runner,
      platform: 'linux',
    };
  }

  it('names each codec’s working hardware encoder (an RTX 40)', async () => {
    const runs: string[] = [];
    expect(await hardwareEncoders(machine([], runs))).toEqual(
      ok({ h264: 'h264_nvenc', hevc: 'hevc_nvenc', av1: 'av1_nvenc' }),
    );
    expect(runs.filter((run) => run.includes('-c:v av1_nvenc'))).toHaveLength(1);
  });

  it('leaves out AV1 when its trial is refused (an RTX 30), and reports no CPU fallback for asking', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const reported = vi.fn();
    const ctx = { ...machine(['av1_nvenc'], []), onBackendFallback: reported };
    expect(await hardwareEncoders(ctx)).toEqual(ok({ h264: 'h264_nvenc', hevc: 'hevc_nvenc' }));
    expect(reported).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('has no HEVC or AV1 where no hardware encoder opens, and HEVC’s missing CPU encoder is no error', async () => {
    const ctx = machine(['h264_nvenc', 'hevc_nvenc', 'av1_nvenc'], []);
    expect(await hardwareEncoders({ ...ctx, onBackendFallback: () => undefined })).toEqual(ok({}));
  });
});
