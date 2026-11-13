// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1 on the Linux build with an NVIDIA GPU: normalise (conform), proxies, frame sets, keyframes and a frame grab
 * decode on NVDEC, turn and scale on the GPU, and encode on NVENC; the proxy and the conform hand CUDA frames to
 * NVENC with no download, and nothing falls back. Then the same jobs with the GPU hidden from FFmpeg
 * (`CUDA_VISIBLE_DEVICES=-1`, the device trial proving it) and with hardware video turned off
 * (`TAALCUT_FORCE_CPU=1`): software decode and libopenh264, every fallback with its reason. Skips off Linux, without
 * the verified Linux build, or when no NVIDIA GPU opens.
 */
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ComputeFallbackEvent } from '@taalcut/core';
import {
  colourBitstreamFilter,
  conform,
  decodeFrameSets,
  decodeKeyframes,
  extractFrame,
  hwVideoBackend,
  knownVideoBackends,
  makeProxy,
  probeMedia,
  runFfmpeg,
  runProcess,
  SDR_COLOR,
  VideoBackendSelection,
  type MediaContext,
  type NormalisationPlan,
  type ProcessRunner,
  type VideoBackendSource,
} from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findTestBinaries } from '../helpers/binaries';
import { planClip, renderClip } from '../helpers/clip';

const found = await findTestBinaries('NVDEC and NVENC on Linux');
const binaries = process.platform === 'linux' && found.binaries?.verified ? found.binaries : undefined;
/** The CUDA row's own device trial: the GPU opens for FFmpeg here. */
const gpu =
  binaries !== undefined &&
  (await runFfmpeg({ binaries }, hwVideoBackend('cuda').deviceTrial ?? [], { timeoutMs: 60_000 })).ok;

/** Every ffmpeg run, recorded (not ffprobe); `hidden` hides the GPU from it as CUDA_VISIBLE_DEVICES=-1 does. */
function recording(runs: string[], hidden: boolean): ProcessRunner {
  return async (command, args, options) => {
    if (command === binaries?.ffmpeg) runs.push(args.join(' '));
    const env = hidden ? { ...options?.env, CUDA_VISIBLE_DEVICES: '-1' } : options?.env;
    return runProcess(command, args, { ...options, ...(env ? { env } : {}) });
  };
}

describe.skipIf(!binaries || !gpu)('NVDEC → NVENC on Linux', { timeout: 120_000 }, () => {
  let dir: string;
  let clip: string;
  let plan: NormalisationPlan;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-nvidia-'));
    clip = join(dir, 'clip.mov');
    const upright = join(dir, 'upright.mp4');
    // Two seconds of 1080p with sound, software-encoded and tagged BT.709 limited range as phones write it, then
    // turned by the display matrix. An untagged clip goes through the CPU's format step instead (keepsColourOnDevice).
    const made = await renderClip({ binaries: binaries! }, upright, [
      ...['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=2'],
      ...['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2'],
      ...['-c:v', 'libopenh264', '-pix_fmt', 'yuv420p', '-g', '15', '-b:v', '8M', '-c:a', 'aac', '-shortest'],
      ...SDR_COLOR,
      ...['-bsf:v', colourBitstreamFilter('h264')],
    ]);
    const turned =
      made &&
      (await renderClip({ binaries: binaries! }, clip, [
        '-display_rotation',
        '90',
        '-i',
        upright,
        '-c',
        'copy',
      ]));
    if (!turned) throw new Error('fixture clip');
    const planned = await planClip(clip, { binaries: binaries! });
    if (!planned.ok) throw new Error(planned.error.code);
    plan = planned.value;
  }, 120_000);
  afterAll(() => (dir ? rm(dir, { recursive: true, force: true }) : undefined));

  /** The jobs, on one context; the runs that read the clip, and every compute fallback. */
  async function runJobs(videoBackends: VideoBackendSource, hidden: boolean) {
    const runs: string[] = [];
    const events: ComputeFallbackEvent[] = [];
    const ctx: MediaContext = {
      binaries: binaries!,
      runner: recording(runs, hidden),
      onComputeFallback: (event) => events.push(event),
      videoBackends,
    };
    const tag = `${hidden ? 'hidden' : 'gpu'}-${events.length}-${Math.random().toString(36).slice(2, 8)}`;
    const proxy = await makeProxy(clip, plan, ctx, {
      out: join(dir, `proxy-${tag}.mp4`),
      sizeBytes: Math.max((await stat(clip)).size, 50_000_000),
      contentHash: 'cd'.repeat(32),
    });
    const conformed = await conform(clip, plan, ctx, { out: join(dir, `conform-${tag}.mp4`), codec: 'h264' });
    const sets = await decodeFrameSets(clip, plan, ctx, {
      sets: [{ set: 'ocr', size: { longSide: 256 }, format: 'gray8', frames: [0, 15, 45] }],
      dir,
    });
    const keyframes = await decodeKeyframes(clip, plan, ctx, {
      targets: [0.2, 1.0, 1.6],
      size: { longSide: 256 },
      dir,
    });
    const frame = await extractFrame(clip, { value: 1, rate: 1 }, ctx, { maxDimension: 320, format: 'png' });
    const clipRuns = runs.filter((args) => args.includes(`file:${clip}`));
    return { ctx, runs: clipRuns, events, proxy, conformed, sets, keyframes, frame, tag };
  }

  it('plans NVDEC for the clip', () => {
    expect(plan.decode).toEqual({ backend: 'cuda', surfaceFormat: 'nv12' });
  });

  it('runs every job on NVDEC, the GPU filters and NVENC, zero copy into the encoder, with no fallback', async () => {
    const jobs = await runJobs(new VideoBackendSelection(async () => ({ backends: ['cuda'] })), false);
    expect(jobs.events).toEqual([]);
    for (const result of [jobs.proxy, jobs.conformed, jobs.sets, jobs.keyframes, jobs.frame])
      expect(result.ok ? 'ok' : `${result.error.code}: ${result.error.detail ?? ''}`).toBe('ok');
    // Every read of the clip decodes on the GPU.
    expect(jobs.runs.length).toBeGreaterThanOrEqual(5);
    for (const run of jobs.runs) expect(run).toContain('-hwaccel cuda -hwaccel_output_format cuda');

    const encodes = jobs.runs.filter((run) => run.includes('-c:v h264_nvenc'));
    expect(encodes).toHaveLength(2);
    for (const run of encodes) {
      expect(run).toContain('transpose_cuda=dir=cclock'); // -display_rotation 90 is a quarter turn anticlockwise
      expect(run).not.toContain('hwdownload');
      expect(run).not.toContain('-pix_fmt');
      expect(run).toContain('-bsf:v h264_metadata=colour_primaries=1');
    }
    // The proxy scales on the GPU to its rung; the conform keeps the full size.
    const proxyRun = encodes.find((run) => run.includes('-preset p2 -tune ll'));
    expect(proxyRun).toContain('scale_cuda=w=720:h=1280:interp_algo=bicubic');
    const conformRun = encodes.find((run) => run.includes('-preset p5 -tune hq -rc vbr -cq 19'));
    expect(conformRun).not.toContain('scale_cuda');
    // Frame reads leave the GPU once, at their size.
    const reads = jobs.runs.filter((run) => !run.includes('-c:v h264_nvenc'));
    for (const run of reads) expect(run).toContain('hwdownload,format=nv12');

    expect(jobs.frame.ok && jobs.frame.value).toMatchObject({ backend: 'cuda', width: 180, height: 320 });
    expect(jobs.conformed.ok && jobs.conformed.value).toMatchObject({
      width: 1080,
      height: 1920,
      driftMs: 0,
    });
    const proxied = jobs.proxy.ok && jobs.proxy.value.file ? jobs.proxy.value.file : undefined;
    expect(proxied).toMatchObject({ width: 720, height: 1280 });
    const probed = await probeMedia(join(dir, `proxy-${jobs.tag}.mp4`), jobs.ctx);
    expect(probed.ok && probed.value.video).toMatchObject({
      codec: 'h264',
      width: 720,
      height: 1280,
      pixelFormat: 'yuv420p',
      colour: { primaries: 'bt709', transfer: 'bt709', space: 'bt709', range: 'tv' },
    });
    console.warn(`MEASURE nvidia-runs ${jobs.runs.length} encodes ${encodes.length}`);
  });

  /** The same jobs completed on the CPU: no `-hwaccel`, libopenh264, and each fallback says why. */
  function onCpu(jobs: Awaited<ReturnType<typeof runJobs>>, reason: string, detail: RegExp) {
    for (const result of [jobs.proxy, jobs.conformed, jobs.sets, jobs.keyframes, jobs.frame])
      expect(result.ok ? 'ok' : `${result.error.code}: ${result.error.detail ?? ''}`).toBe('ok');
    for (const run of jobs.runs) expect(run).not.toContain('-hwaccel');
    const encodes = jobs.runs.filter((run) => /-c:v (h264_nvenc|libopenh264)/.test(run));
    expect(encodes).toHaveLength(2);
    for (const run of encodes) expect(run).toContain('-c:v libopenh264');
    expect(jobs.frame.ok && jobs.frame.value).toMatchObject({ backend: 'software', width: 180, height: 320 });
    expect(jobs.frame.ok && jobs.frame.value.fallbackReason?.detail).toMatch(detail);
    const decode = jobs.events.filter((event) => event.operation === 'media.decode');
    const encode = jobs.events.filter((event) => event.operation === 'media.encode');
    expect(decode.length).toBeGreaterThan(0);
    expect(encode.length).toBeGreaterThan(0);
    for (const event of [...decode, ...encode]) {
      expect(event.reason).toBe(reason);
      expect(event.detail).toMatch(detail);
    }
    expect(decode[0]?.wanted).toEqual(['cuda']);
    expect(encode[0]?.wanted).toEqual(['nvenc']);
    console.warn(`MEASURE nvidia-cpu ${reason}: ${decode[0]?.detail} | ${encode[0]?.detail}`);
  }

  it('with the GPU hidden (CUDA_VISIBLE_DEVICES=-1), completes in software with the device trial’s reason', async () => {
    const jobs = await runJobs(new VideoBackendSelection(async () => ({ backends: ['cuda'] })), true);
    onCpu(jobs, 'no_accelerator', /cuda: .*CUDA_ERROR_NO_DEVICE/);
  });

  it('when the probe names no NVIDIA GPU, completes in software and says so', async () => {
    const jobs = await runJobs(new VideoBackendSelection(async () => ({ backends: [] })), true);
    onCpu(jobs, 'no_accelerator', /cuda: not on this machine \(hardware probe\)/);
  });

  it('with hardware video turned off (TAALCUT_FORCE_CPU=1), completes in software, reason disabled', async () => {
    const off = knownVideoBackends([], { disabled: 'hardware video turned off (TAALCUT_FORCE_CPU=1)' });
    const jobs = await runJobs(off, false);
    onCpu(jobs, 'disabled', /TAALCUT_FORCE_CPU=1/);
  });
});
