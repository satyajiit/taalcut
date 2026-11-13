// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the rows put on a command line: NVENC flags per purpose (each set trial-encoded on the RTX 4090 host, see
 * tools/ffmpeg/README.md), VideoToolbox's flags unchanged by the table, the zero-copy CUDA graph and where it
 * downloads, the session weight of a CUDA run, the session folder, the sidecar's CUDA variables, and FFmpeg's
 * lines for a hidden GPU.
 */
import { mkdtemp, stat, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  colourBitstreamFilter,
  ensurePrivateFolder,
  FfmpegFailed,
  hardwareRefused,
  hardwareSessionFolder,
  hardwareSessionWeight,
  hwDownloadFilters,
  hwScaleFilter,
  hwUprightFilters,
  keepsColourOnDevice,
  planNormalisation,
  sidecarEnv,
  videoEncodeFlags,
} from '@taalcut/media';
import { normalisationGraph } from '../../src/normalise/graph';
import { probeOf, videoStream } from '../helpers/probe-fixture';
import type { ToneMapChoice } from '../../src/backends';

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
const SDR_BSF =
  'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0';
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

describe('NVENC flags per purpose', () => {
  const bitrate = ['-b:v', '8000000', '-maxrate', '12000000', '-bufsize', '16000000'];

  it('proxy: fast preset, low latency, no B-frames; CUDA frames get no -pix_fmt or colour options', () => {
    expect(videoEncodeFlags('h264_nvenc', 8_000_000, 30, { purpose: 'proxy', deviceFrames: true })).toEqual([
      '-c:v',
      'h264_nvenc',
      '-preset',
      'p2',
      '-tune',
      'll',
      '-rc',
      'vbr',
      ...bitrate,
      '-bf',
      '0',
      '-g',
      '30',
      '-profile:v',
      'high',
      '-bsf:v',
      SDR_BSF,
      ...MUX,
    ]);
  });

  it('conform: p5/hq VBR with a quality target, AQ and lookahead, still no B-frames', () => {
    expect(videoEncodeFlags('hevc_nvenc', 8_000_000, 30)).toEqual([
      '-c:v',
      'hevc_nvenc',
      '-preset',
      'p5',
      '-tune',
      'hq',
      '-rc',
      'vbr',
      '-cq',
      '21',
      ...bitrate,
      '-spatial-aq',
      '1',
      '-temporal-aq',
      '1',
      '-rc-lookahead',
      '20',
      '-bf',
      '0',
      '-g',
      '30',
      '-pix_fmt',
      'yuv420p',
      ...SDR_TAGS,
      '-profile:v',
      'main',
      '-tag:v',
      'hvc1',
      '-bsf:v',
      SDR_BSF.replace('h264', 'hevc'),
      ...MUX,
    ]);
  });

  it('export: three B-frames as references; HDR is HEVC Main10 with BT.2020 HLG or PQ', () => {
    const h264 = videoEncodeFlags('h264_nvenc', 8_000_000, 30, { purpose: 'export' });
    expect(h264.join(' ')).toContain('-cq 19');
    expect(h264.join(' ')).toContain('-bf 3 -b_ref_mode middle -g 30');
    const hlg = videoEncodeFlags('hevc_nvenc', 8_000_000, 30, { purpose: 'export', hdr: 'hlg' }).join(' ');
    expect(hlg).toContain(
      '-pix_fmt p010le -color_primaries bt2020 -color_trc arib-std-b67 -colorspace bt2020nc',
    );
    expect(hlg).toContain('-profile:v main10 -tag:v hvc1');
    expect(hlg).toContain(
      'hevc_metadata=colour_primaries=9:transfer_characteristics=18:matrix_coefficients=9',
    );
    expect(colourBitstreamFilter('hevc', 'pq')).toContain('transfer_characteristics=16');
  });

  it('an OpenH264 export is H.264 High; its proxies and conforms keep the encoder default', () => {
    const exported = videoEncodeFlags('libopenh264', 8_000_000, 30, { purpose: 'export' }).join(' ');
    expect(exported).toContain(`-profile:v high -bsf:v ${SDR_BSF}`);
    for (const purpose of ['proxy', 'conform'] as const)
      expect(videoEncodeFlags('libopenh264', 8_000_000, 30, { purpose })).not.toContain('-profile:v');
  });

  it('VideoToolbox keeps its pre-table flags byte for byte', () => {
    expect(videoEncodeFlags('h264_videotoolbox', 8_000_000, 30)).toEqual([
      '-c:v',
      'h264_videotoolbox',
      ...bitrate,
      '-bf',
      '0',
      '-g',
      '30',
      '-pix_fmt',
      'yuv420p',
      ...SDR_TAGS,
      '-profile:v',
      'high',
      '-bsf:v',
      SDR_BSF,
      ...MUX,
    ]);
    expect(videoEncodeFlags('hevc_videotoolbox', 8_000_000, 30)).toEqual([
      '-c:v',
      'hevc_videotoolbox',
      ...bitrate,
      '-bf',
      '0',
      '-g',
      '30',
      '-pix_fmt',
      'yuv420p',
      ...SDR_TAGS,
      '-tag:v',
      'hvc1',
      ...MUX,
    ]);
  });
});

describe('the CUDA graph', () => {
  const none: ToneMapChoice = { method: 'none', backend: 'software' };
  const placebo: ToneMapChoice = { method: 'libplacebo', backend: 'vulkan', curve: 'bt.2446a' };

  function plan(overrides: Parameters<typeof videoStream>[0] = {}) {
    const result = planNormalisation(
      probeOf(
        '/tmp/clip.mp4',
        videoStream({
          averageFrameRate: { num: 30, den: 1 },
          frameRate: { num: 30, den: 1 },
          duration: { value: 2, rate: 1 },
          frameCount: 60,
          width: 1920,
          height: 1080,
          displayWidth: 1080,
          displayHeight: 1920,
          rotation: 90,
          colour: { space: 'bt709', primaries: 'bt709', transfer: 'bt709', range: 'tv' },
          ...overrides,
        }),
      ),
      { platform: 'linux' },
    );
    if (!result.ok) throw new Error(result.error.code);
    return result.value;
  }

  it('decodes, turns and scales on the GPU and hands CUDA frames to NVENC without a download', () => {
    const p = plan();
    expect(p.decode).toEqual({ backend: 'cuda', surfaceFormat: 'nv12' });
    const graph = normalisationGraph(p, {
      route: p.decode,
      toneMap: none,
      size: { longSide: 640 },
      encoder: 'h264_nvenc',
    });
    expect(graph.preInput).toEqual(['-noautorotate', '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda']);
    expect(graph.videoFilter).toContain('transpose_cuda=dir=clock');
    expect(graph.videoFilter).toContain('scale_cuda=w=360:h=640:interp_algo=bicubic');
    expect(graph.videoFilter).not.toContain('hwdownload');
    expect(graph.deviceFrames).toBe(true);
  });

  it('downloads a source whose colour the CPU must convert: untagged, BT.601 or full range', () => {
    for (const colour of [{}, { space: 'smpte170m', range: 'tv' }, { space: 'bt709', range: 'pc' }]) {
      const p = plan({ colour });
      const graph = normalisationGraph(p, {
        route: p.decode,
        toneMap: none,
        size: { longSide: 640 },
        encoder: 'h264_nvenc',
      });
      expect(graph.videoFilter, JSON.stringify(colour)).toContain('hwdownload,format=nv12');
      expect(graph.deviceFrames).toBeUndefined();
    }
    expect(keepsColourOnDevice({ space: 'bt709' }, 'nv12')).toBe(true);
    expect(keepsColourOnDevice({ space: 'bt709', range: 'tv' }, 'p010le')).toBe(false);
  });

  it('downloads in the frames’ own format where a CPU filter or a CPU encoder follows', () => {
    const p = plan();
    const cpu = normalisationGraph(p, {
      route: p.decode,
      toneMap: none,
      size: { longSide: 640 },
      encoder: 'libopenh264',
    });
    expect(cpu.videoFilter).toContain('scale_cuda=w=360:h=640:interp_algo=bicubic,hwdownload,format=nv12');
    expect(cpu.deviceFrames).toBeUndefined();
    const cropped = normalisationGraph(p, {
      route: p.decode,
      toneMap: none,
      encoder: 'h264_nvenc',
      crop: { x: 0, y: 0, width: 540, height: 960 },
    });
    expect(cropped.videoFilter).toContain('transpose_cuda=dir=clock,hwdownload,format=nv12');
    expect(cropped.deviceFrames).toBeUndefined();
  });

  it('drops an odd row after a CPU box scale that feeds an encoder, as VideoToolbox and OpenH264 do', () => {
    const p = plan();
    const crop = { x: 30, y: 106, width: 480, height: 854 };
    const encoded = normalisationGraph(p, {
      route: p.decode,
      toneMap: none,
      size: { longSide: 426 },
      crop,
      encoder: 'h264_nvenc',
    });
    expect(encoded.videoFilter).toContain(
      'scale=238:426:force_original_aspect_ratio=decrease:flags=bicubic,crop=w=trunc(iw/2)*2:h=trunc(ih/2)*2:x=0:y=0',
    );
    const read = normalisationGraph(p, { route: p.decode, toneMap: none, size: { longSide: 426 }, crop });
    expect(read.videoFilter).not.toContain('trunc(iw/2)');
  });

  it('downloads 10-bit HLG as P010 into the tone-map', () => {
    const p = plan({
      codec: 'hevc',
      isHdr: true,
      hdrFormats: ['hlg'],
      bitDepth: 10,
      pixelFormat: 'yuv420p10le',
      colour: { transfer: 'arib-std-b67', primaries: 'bt2020', space: 'bt2020nc', range: 'tv' },
    } as never);
    expect(p.decode).toEqual({ backend: 'cuda', surfaceFormat: 'p010le' });
    const graph = normalisationGraph(p, { route: p.decode, toneMap: placebo, encoder: 'h264_nvenc' });
    expect(graph.videoFilter).toContain('hwdownload,format=p010le');
    expect(graph.deviceFrames).toBeUndefined();
  });

  it('builds the same pieces for render through the public builders', () => {
    expect(hwUprightFilters('cuda', 270)).toEqual([
      'sidedata=mode=delete:type=DISPLAYMATRIX',
      'transpose_cuda=dir=cclock',
    ]);
    expect(hwUprightFilters('videotoolbox', 180)[1]).toBe('transpose_vt=dir=reversal');
    expect(hwScaleFilter('cuda', 1280, 720)).toBe('scale_cuda=w=1280:h=720:interp_algo=bicubic');
    expect(hwDownloadFilters('cuda', 'p010le', true)).toEqual(['hwdownload', 'format=p010le']);
    expect(hwDownloadFilters('videotoolbox', 'nv12', true)).toEqual(['hwdownload', 'format=p010le']);
  });
});

describe('hardware sessions on NVIDIA', () => {
  it('counts NVENC, not NVDEC or a CUDA device', () => {
    const decode = ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda', '-i', 'in.mp4'];
    expect(hardwareSessionWeight([...decode, '-frames:v', '1', 'f.png'])).toBe(0);
    expect(
      hardwareSessionWeight([...decode, '-vf', 'scale_cuda=w=640:h=360', '-c:v', 'h264_nvenc', 'o.mp4']),
    ).toBe(1);
    expect(
      hardwareSessionWeight([
        '-init_hw_device',
        'cuda=taalcut',
        '-f',
        'lavfi',
        '-i',
        'testsrc2',
        '-f',
        'null',
        '-',
      ]),
    ).toBe(0);
    expect(
      hardwareSessionWeight([
        '-init_hw_device',
        'vaapi=taalcut',
        '-i',
        'in.mp4',
        '-c:v',
        'h264_vaapi',
        'o.mp4',
      ]),
    ).toBe(1);
    expect(hardwareSessionWeight(['-hwaccel', 'videotoolbox', '-i', 'in.mov', 'f.png'])).toBe(1);
  });

  it('keeps the folder per user: $XDG_RUNTIME_DIR on Linux, else a per-uid tmpdir folder', () => {
    const tmp = '/tmp';
    expect(
      hardwareSessionFolder({ platform: 'linux', env: { XDG_RUNTIME_DIR: '/run/user/1000' }, tmpdir: tmp }),
    ).toBe('/run/user/1000/taalcut-hardware-sessions');
    expect(hardwareSessionFolder({ platform: 'linux', env: {}, tmpdir: tmp, uid: 1000 })).toBe(
      '/tmp/taalcut-hardware-sessions-1000',
    );
    expect(
      hardwareSessionFolder({ platform: 'linux', env: { XDG_RUNTIME_DIR: 'relative' }, tmpdir: tmp, uid: 7 }),
    ).toBe('/tmp/taalcut-hardware-sessions-7');
    expect(hardwareSessionFolder({ platform: 'darwin', env: { XDG_RUNTIME_DIR: '/x' }, tmpdir: tmp })).toBe(
      '/tmp/taalcut-hardware-sessions',
    );
  });

  it.runIf(process.platform !== 'win32')(
    'makes the folder 0700, closes an open one, and refuses a link',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'taalcut-sessions-'));
      const dir = join(root, 'sessions');
      await ensurePrivateFolder(dir);
      expect((await stat(dir)).mode & 0o777).toBe(0o700);
      await chmod(dir, 0o777);
      await ensurePrivateFolder(dir);
      expect((await stat(dir)).mode & 0o777).toBe(0o700);
      const link = join(root, 'link');
      await symlink(dir, link);
      await expect(ensurePrivateFolder(link)).rejects.toThrow(/not a folder/);
    },
  );
});

describe('the sidecar on Linux', () => {
  it('passes CUDA_VISIBLE_DEVICES and a CUDA kernel cache, never HOME', () => {
    const env = sidecarEnv(
      { PATH: '/usr/bin', HOME: '/home/u', CUDA_VISIBLE_DEVICES: '-1', SECRET: 'x' },
      { platform: 'linux' },
    );
    expect(env).toMatchObject({ CUDA_VISIBLE_DEVICES: '-1', CUDA_CACHE_PATH: '/home/u/.nv/ComputeCache' });
    expect(env['HOME']).toBeUndefined();
    expect(env['SECRET']).toBeUndefined();
    expect(env['VK_ICD_FILENAMES']).toBeUndefined();
    expect(
      sidecarEnv({ HOME: '/home/u', CUDA_CACHE_PATH: '/c' }, { platform: 'linux' })['CUDA_CACHE_PATH'],
    ).toBe('/c');
    expect(sidecarEnv({ HOME: '/Users/u' }, { platform: 'darwin' })['CUDA_CACHE_PATH']).toBeUndefined();
  });

  it('recognises FFmpeg’s lines for a hidden GPU as a hardware refusal', () => {
    const failed = (detail: string) => FfmpegFailed({ exitCode: 1 }, { detail });
    expect(
      hardwareRefused(failed('No device available for decoder: device type cuda needed for codec h264.')),
    ).toBe('the cuda decoder would not start (no cuda device)');
    expect(
      hardwareRefused(
        failed(
          '[h264_nvenc @ 0x61] dl_fn->cuda_dl->cuInit(0) failed -> CUDA_ERROR_NO_DEVICE: no CUDA-capable device is detected',
        ),
      ),
    ).toBe(
      'the NVENC encoder would not start (cuInit(0) failed -> CUDA_ERROR_NO_DEVICE: no CUDA-capable device is detected)',
    );
    expect(hardwareRefused(failed('Invalid data found when processing input'))).toBeUndefined();
  });
});
