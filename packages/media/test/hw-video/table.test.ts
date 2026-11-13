// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The HwVideoBackend table (seam 3): which rows each platform tries, what planDecode and selectEncoder take from
 * them, the CUDA row's surfaces, NVENC's minimum frame, and the machine answer (probe, device trial, forced CPU).
 */
import { err, ok } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  backendOfEncoder,
  encoderForSize,
  engineHardwareBackends,
  FfmpegFailed,
  hardwareBackends,
  hardwareEncoderFor,
  HW_VIDEO_BACKEND_IDS,
  HW_VIDEO_BACKENDS,
  hwVideoBackend,
  knownVideoBackends,
  machineHardwareBackends,
  PLATFORM_HW_VIDEO,
  planDecode,
  selectEncoder,
  VideoBackendSelection,
  type MediaContext,
  type ProcessRunner,
} from '@taalcut/media';
import { onMachine } from '../../src/normalise/session';
import { videoPlan } from '../helpers/video-plan';

const ENCODERS = [
  'h264_videotoolbox',
  'hevc_videotoolbox',
  'h264_nvenc',
  'hevc_nvenc',
  'h264_vaapi',
  'libopenh264',
].map((name) => ({ name }));

describe('the table', () => {
  it('has one row per id, and every row names core compute backends', () => {
    expect(Object.keys(HW_VIDEO_BACKENDS).sort()).toEqual([...HW_VIDEO_BACKEND_IDS].sort());
    for (const id of HW_VIDEO_BACKEND_IDS) {
      expect(hwVideoBackend(id).id).toBe(id);
      expect(hwVideoBackend(id).compute.decode).toBeTruthy();
    }
    expect(hwVideoBackend('cuda').compute).toEqual({ decode: 'cuda', encode: 'nvenc' });
    expect(hwVideoBackend('videotoolbox').compute).toEqual({
      decode: 'videotoolbox',
      encode: 'videotoolbox',
    });
  });

  it('plans VideoToolbox on a Mac, CUDA on Linux, and nothing on Windows yet', () => {
    expect(hardwareBackends('darwin')).toEqual(['videotoolbox']);
    expect(hardwareBackends('linux')).toEqual(['cuda']);
    expect(hardwareBackends('win32')).toEqual([]);
    expect(hardwareBackends('freebsd')).toEqual([]);
    // VA-API is a probe row; every Windows row is a slot.
    expect(PLATFORM_HW_VIDEO.linux?.find((row) => row.id === 'vaapi')?.use).toBe('probe');
    expect(PLATFORM_HW_VIDEO.win32?.every((row) => row.use === 'slot')).toBe(true);
    for (const id of ['d3d11va', 'qsv', 'amf', 'mf', 'vaapi'] as const)
      expect(hwVideoBackend(id).verified).toBe(false);
  });

  it('narrows to what the probe names: VA-API only when named, slots never', () => {
    expect(machineHardwareBackends('linux', engineHardwareBackends('nvidia'))).toEqual(['cuda']);
    expect(machineHardwareBackends('linux', engineHardwareBackends('vaapi'))).toEqual(['vaapi']);
    expect(machineHardwareBackends('linux', engineHardwareBackends('intel'))).toEqual(['vaapi']);
    expect(machineHardwareBackends('linux', engineHardwareBackends('none'))).toEqual([]);
    expect(machineHardwareBackends('win32', engineHardwareBackends('nvidia'))).toEqual([]);
    expect(machineHardwareBackends('darwin', engineHardwareBackends('videotoolbox'))).toEqual([
      'videotoolbox',
    ]);
  });

  it('maps encoder names to rows', () => {
    expect(backendOfEncoder('h264_nvenc')?.id).toBe('cuda');
    expect(backendOfEncoder('hevc_videotoolbox')?.id).toBe('videotoolbox');
    expect(backendOfEncoder('hevc_vaapi')?.id).toBe('vaapi');
    expect(backendOfEncoder('libopenh264')).toBeUndefined();
    expect(hardwareEncoderFor('cuda', 'hevc')).toBe('hevc_nvenc');
    expect(hardwareEncoderFor('cuda', 'prores')).toBeUndefined();
    expect(hardwareEncoderFor('d3d11va', 'h264')).toBeUndefined();
  });
});

describe('planDecode on Linux', () => {
  const linux = { platform: 'linux' as const };

  it('decodes 4:2:0 and 4:4:4 on NVDEC in the frames’ own format', () => {
    expect(planDecode({ codec: 'h264', pixelFormat: 'yuv420p' }, linux)).toEqual({
      backend: 'cuda',
      surfaceFormat: 'nv12',
    });
    expect(planDecode({ codec: 'hevc', pixelFormat: 'yuv420p10le' }, linux)).toEqual({
      backend: 'cuda',
      surfaceFormat: 'p010le',
    });
    expect(planDecode({ codec: 'hevc', pixelFormat: 'yuv420p12le' }, linux)).toMatchObject({
      surfaceFormat: 'p016le',
    });
    expect(planDecode({ codec: 'hevc', pixelFormat: 'yuv444p' }, linux)).toMatchObject({
      surfaceFormat: 'yuv444p',
    });
    expect(planDecode({ codec: 'av1', pixelFormat: 'yuv420p' }, linux)).toMatchObject({ backend: 'cuda' });
  });

  it('takes the CPU, with the reason, for what NVDEC can’t carry', () => {
    const reason = (video: { codec: string; pixelFormat: string }, still = false) => {
      const plan = planDecode(video, { ...linux, still });
      return plan.backend === 'software' ? plan.fallbackReason : undefined;
    };
    expect(reason({ codec: 'h264', pixelFormat: 'yuv420p10le' })).toEqual({
      code: 'format_unsupported',
      detail: "NVDEC can't carry yuv420p10le",
    });
    expect(reason({ codec: 'hevc', pixelFormat: 'yuv422p10le' })?.code).toBe('format_unsupported');
    expect(reason({ codec: 'prores', pixelFormat: 'yuv422p10le' })).toEqual({
      code: 'codec_unsupported',
      detail: 'NVDEC has no prores decoder',
    });
    expect(reason({ codec: 'hevc', pixelFormat: 'yuv420p' }, true)).toEqual({
      code: 'format_unsupported',
      detail: "NVDEC doesn't decode stills",
    });
  });

  it('follows the machine: no rows, a VA-API row, or hardware turned off', () => {
    const h264 = { codec: 'h264', pixelFormat: 'yuv420p' };
    expect(
      planDecode(h264, {
        ...linux,
        machine: { backends: [], missing: 'cuda: cuInit(0) failed -> CUDA_ERROR_NO_DEVICE' },
      }),
    ).toEqual({
      backend: 'software',
      fallbackReason: {
        code: 'no_hardware_backend',
        detail: 'no hardware video decoder on this machine (cuda: cuInit(0) failed -> CUDA_ERROR_NO_DEVICE)',
      },
    });
    expect(planDecode(h264, { ...linux, machine: { backends: ['vaapi'] } })).toEqual({
      backend: 'vaapi',
      surfaceFormat: 'nv12',
    });
    expect(
      planDecode(h264, {
        ...linux,
        machine: { backends: [], disabled: 'hardware video turned off (TAALCUT_FORCE_CPU=1)' },
      }),
    ).toEqual({
      backend: 'software',
      fallbackReason: { code: 'requested', detail: 'hardware video turned off (TAALCUT_FORCE_CPU=1)' },
    });
  });
});

describe('selectEncoder and encoderForSize on Linux', () => {
  it('picks NVENC, and libopenh264 with the reason when the machine has no row or is forced to the CPU', () => {
    expect(selectEncoder('h264', ENCODERS, { platform: 'linux' })).toEqual(
      ok({ codec: 'h264', encoder: 'h264_nvenc', backend: 'cuda' }),
    );
    const none = selectEncoder('h264', ENCODERS, {
      platform: 'linux',
      machine: { backends: [], missing: 'cuda: no device' },
    });
    expect(none.ok && none.value).toMatchObject({
      encoder: 'libopenh264',
      backend: 'software',
      fallbackReason: {
        code: 'no_hardware_backend',
        detail: 'no hardware video encoder on this machine (cuda: no device)',
      },
    });
    const off = selectEncoder('h264', ENCODERS, {
      platform: 'linux',
      machine: { backends: [], disabled: 'off' },
    });
    expect(off.ok && off.value).toMatchObject({
      encoder: 'libopenh264',
      fallbackReason: { code: 'requested', detail: 'off' },
    });
    // No LGPL CPU HEVC encoder: HEVC has nowhere to go.
    expect(selectEncoder('hevc', ENCODERS, { platform: 'linux', machine: { backends: [] } }).ok).toBe(false);
  });

  it('sends frames below NVENC’s minimum to libopenh264', () => {
    const nvenc = { codec: 'h264' as const, encoder: 'h264_nvenc', backend: 'cuda' as const };
    expect(encoderForSize(nvenc, { width: 146, height: 50 })).toEqual(ok(nvenc));
    expect(encoderForSize(nvenc, { width: 80, height: 120 })).toEqual(
      ok({
        codec: 'h264',
        encoder: 'libopenh264',
        backend: 'software',
        fallbackReason: {
          code: 'format_unsupported',
          detail: 'h264_nvenc needs at least 146×50, this is 80×120',
        },
      }),
    );
    const hevc = { codec: 'hevc' as const, encoder: 'hevc_nvenc', backend: 'cuda' as const };
    expect(encoderForSize(hevc, { width: 128, height: 128 }).ok).toBe(false);
    const vt = { codec: 'h264' as const, encoder: 'h264_videotoolbox', backend: 'videotoolbox' as const };
    expect(encoderForSize(vt, { width: 16, height: 16 })).toEqual(ok(vt));
  });
});

describe('VideoBackendSelection', () => {
  const NO_DEVICE = [
    'ffmpeg exited with code 1',
    '[AVHWDeviceContext @ 0x5f] cu->cuInit(0) failed -> CUDA_ERROR_NO_DEVICE: no CUDA-capable device is detected',
    'Device creation failed: -542398533.',
  ].join('\n');

  function context(fail: boolean, runs: string[][]): MediaContext {
    const runner: ProcessRunner = async (_command, args) => {
      runs.push([...args]);
      if (fail) return err(FfmpegFailed({ exitCode: 1 }, { detail: NO_DEVICE }));
      return ok({ exitCode: 0, signal: null, stdout: Buffer.from(''), stderrTail: '', durationMs: 1 });
    };
    return {
      binaries: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', source: 'dev-build' },
      runner,
      platform: 'linux',
    };
  }

  it('runs the CUDA device trial once and keeps the answer', async () => {
    const runs: string[][] = [];
    const ctx = context(false, runs);
    const selection = new VideoBackendSelection(async () => ({ backends: ['cuda'] }));
    expect(await selection.get(ctx)).toEqual(ok({ backends: ['cuda'] }));
    expect(await selection.get(ctx)).toEqual(ok({ backends: ['cuda'] }));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.join(' ')).toContain('-init_hw_device cuda=taalcut');
    expect(runs[0]?.join(' ')).toContain(
      'scale_cuda=w=32:h=32,transpose_cuda=dir=clock,hwdownload,format=nv12',
    );
  });

  it('leaves out a row whose trial fails, with FFmpeg’s reason', async () => {
    const runs: string[][] = [];
    const answer = await new VideoBackendSelection(async () => ({ backends: ['cuda'] })).get(
      context(true, runs),
    );
    expect(answer.ok && answer.value.backends).toEqual([]);
    expect(answer.ok && answer.value.missing).toContain(
      'cuda: [AVHWDeviceContext @ 0x5f] cu->cuInit(0) failed',
    );
  });

  it('says why a row the probe doesn’t name is out, and runs no trial for it', async () => {
    const runs: string[][] = [];
    const answer = await new VideoBackendSelection(async () => ({ backends: [] })).get(context(false, runs));
    expect(answer).toEqual(ok({ backends: [], missing: 'cuda: not on this machine (hardware probe)' }));
    expect(runs).toHaveLength(0);
  });

  it('runs nothing when hardware video is turned off', async () => {
    const runs: string[][] = [];
    const selection = new VideoBackendSelection(async () => ({ backends: ['cuda'], disabled: 'forced' }));
    expect(await selection.get(context(false, runs))).toEqual(ok({ backends: [], disabled: 'forced' }));
    expect(runs).toHaveLength(0);
  });

  it('proves the platform’s defaults when the probe can’t tell', async () => {
    const runs: string[][] = [];
    const answer = await new VideoBackendSelection(async () => undefined).get(context(false, runs));
    expect(answer).toEqual(ok({ backends: ['cuda'] }));
    expect(runs).toHaveLength(1);
  });

  it('knownVideoBackends gives a fixed answer', async () => {
    const ctx = context(false, []);
    expect(await knownVideoBackends(['cuda']).get(ctx)).toEqual(ok({ backends: ['cuda'] }));
    expect(await knownVideoBackends(['cuda'], { disabled: 'off' }).get(ctx)).toEqual(
      ok({ backends: [], disabled: 'off' }),
    );
  });
});

describe('onMachine: a stored plan on this machine’s rows', () => {
  const linuxPlan = () => videoPlan({}, false, 'linux');

  it('keeps a plan whose row the machine has', () => {
    const plan = linuxPlan();
    expect(onMachine(plan, { backends: ['cuda'] })).toBe(plan);
  });

  it('re-plans on the CPU with the machine’s reason when its row is missing or hardware is off', () => {
    const plan = linuxPlan();
    expect(onMachine(plan, { backends: [], missing: 'cuda: no device' }).decode).toEqual({
      backend: 'software',
      fallbackReason: {
        code: 'no_hardware_backend',
        detail: 'no hardware video decoder on this machine (cuda: no device)',
      },
    });
    expect(onMachine(plan, { backends: [], disabled: 'off' }).decode).toEqual({
      backend: 'software',
      fallbackReason: { code: 'requested', detail: 'off' },
    });
  });

  it('moves a plan made where no row was wired onto a row the machine has, and keeps a CPU plan for its file', () => {
    const unwired = videoPlan({}, false, 'freebsd');
    expect(unwired.decode.backend).toBe('software');
    expect(onMachine(unwired, { backends: ['cuda'] }).decode).toEqual({
      backend: 'cuda',
      surfaceFormat: 'nv12',
    });
    expect(onMachine(unwired, { backends: [], disabled: 'off' }).decode).toMatchObject({
      fallbackReason: { code: 'requested' },
    });
    const prores = videoPlan({ codec: 'prores', pixelFormat: 'yuv422p10le' }, false, 'linux');
    expect(onMachine(prores, { backends: ['cuda'] })).toBe(prores);
  });
});
