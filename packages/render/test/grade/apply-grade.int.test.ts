// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V17 render side (SPEC P3.7): a cube through the CPU route (lut3d) and through the GPU port lands within
 * mean ΔE00 0.5 of the expected frame and of each other; an invalid cube never reaches an encode. The real GPU
 * route is the mac helper's `video.applyCube` (devices lane, Swift); here its port is a fake that grades with
 * FFmpeg the way Core Image does (trilinear), so the comparison and the call are what is tested.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ok, type ComputeFallbackEvent } from '@taalcut/core';
import { runFfmpeg, runProcess, type MediaContext, type ProcessRunner } from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyGrade } from '../../src/grade/apply-grade';
import type { CubeApplier, CubeApplyRequest } from '../../src/grade/cube-applier';
import { bt709ToRgbFilter, RGB_TO_BT709_FILTER } from '../../src/grade/colour-filters';
import { identityCube, parseCube, writeCube, type CubeLut } from '../../src/grade/cube-file';
import { sampleCube } from '../../src/grade/cube-sample';
import { decodeRgb48Frame, filesDeltaE } from '../../src/grade/frame-delta-e';
import { gradeSegment } from '../../src/grade/grade-segment';
import { vulkanGrade } from '../../src/grade/grade-video';
import { ffmpeg, findTestMedia, mediaContext, probeJson, tempDir } from '../support/media';
import { ANNEX_A4_CUBE, warmCube } from './fixtures';
import { FIXTURE_H264, hostVideo, type HostVideo } from '../support/host-video';

const media = await findTestMedia('grade');
const SIZE = { width: 320, height: 180 };
const GRID = { width: 64, height: 36 };

describe.skipIf(!media.binaries)('apply grade', { timeout: 240_000 }, () => {
  let ctx: MediaContext;
  let host: HostVideo;
  let work: Awaited<ReturnType<typeof tempDir>>;
  let segment: string;

  const cubeFile = async (name: string, lut: CubeLut, folder = work.dir) => {
    await mkdir(folder, { recursive: true });
    const path = join(folder, name);
    await writeFile(path, writeCube(lut));
    return path;
  };

  beforeAll(async () => {
    if (!media.binaries) return;
    ctx = mediaContext(media.binaries);
    host = await hostVideo(ctx);
    work = await tempDir('grade');
    segment = join(work.dir, 'segment.mp4');
    // A smooth two-colour ramp, encoded like a conformed segment (BT.709 limited range).
    await ffmpeg(ctx, [
      '-f',
      'lavfi',
      '-i',
      `gradients=s=${SIZE.width}x${SIZE.height}:c0=0x2050a0:c1=0xe0a060:x0=0:y0=0:x1=${SIZE.width}:y1=${SIZE.height}:nb_colors=2:speed=0:seed=1:rate=30`,
      '-frames:v',
      '15',
      '-vf',
      'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
      '-c:v',
      FIXTURE_H264,
      '-b:v',
      '20M',
      ...(FIXTURE_H264 === 'h264_videotoolbox' ? ['-allow_sw', '1'] : []),
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-colorspace',
      'bt709',
      '-color_range',
      'tv',
      segment,
    ]);
  });
  afterAll(() => work?.dispose());

  /** `vulkan`: without an applier, libplacebo first (the Linux route); the CPU route's tests leave it off. */
  const grade = (
    lut: CubeLut,
    cubePath: string,
    out: string,
    applier: CubeApplier | null = null,
    vulkan = false,
  ) => {
    const events: ComputeFallbackEvent[] = [];
    return applyGrade({
      segment,
      cubePath,
      cube: lut,
      out: join(work.dir, out),
      applier,
      vulkan,
      ctx,
      bitrateKbps: 20_000,
      gopFrames: 30,
      onFallback: (event) => events.push(event),
    }).then((result) => ({ result, events }));
  };

  it('leaves the picture alone through an identity cube on the CPU route', async () => {
    const lut = identityCube(17);
    const { result, events } = await grade(lut, await cubeFile('identity.cube', lut), 'identity.mp4');
    expect(result.ok && result.value.route).toBe('cpu');
    expect(events.map((event) => event.reason)).toEqual(['no_accelerator']);
    const score = await filesDeltaE(ctx, segment, join(work.dir, 'identity.mp4'), GRID);
    console.warn(
      `[grade] identity cube, CPU route: mean ΔE00 ${score.ok ? score.value.mean.toFixed(3) : '?'}`,
    );
    expect(score.ok && score.value.mean).toBeLessThanOrEqual(0.5);
    const facts = await probeJson(
      ctx,
      join(work.dir, 'identity.mp4'),
      'stream=nb_read_packets,color_range,color_space,color_primaries',
    );
    expect(JSON.stringify(facts)).toContain('"color_range":"tv"');
    expect(JSON.stringify(facts)).toContain('"color_space":"bt709"');
    expect(JSON.stringify(facts)).toContain('"nb_read_packets":"15"');
  });

  it('applies the Adobe Annex A.4 cube as the specification interpolates it', async () => {
    const parsed = parseCube(ANNEX_A4_CUBE, { sizes: [2] });
    if (!parsed.ok) throw new Error('fixture');
    const { result } = await grade(parsed.value, await cubeFile('annex.cube', parsed.value), 'annex.mp4');
    expect(result.ok).toBe(true);
    // Expected: the cube's tetrahedral maths on the input at 16 bits, delivered as the segment is (BT.709
    // limited 4:2:0, losslessly here), then both scored per pixel on the 64×36 grid as the grade gate is.
    const input = await decodeRgb48Frame(ctx, segment, SIZE);
    if (!input.ok) throw new Error('decode');
    const expected = new Uint16Array(input.value.length);
    for (let at = 0; at < input.value.length; at += 3) {
      const rgb = sampleCube(parsed.value, [
        (input.value[at] ?? 0) / 65535,
        (input.value[at + 1] ?? 0) / 65535,
        (input.value[at + 2] ?? 0) / 65535,
      ]);
      rgb.forEach(
        (value, axis) => (expected[at + axis] = Math.round(Math.min(Math.max(value, 0), 1) * 65535)),
      );
    }
    const raw = join(work.dir, 'expected.rgb48');
    await writeFile(raw, expected);
    const delivered = join(work.dir, 'expected.mkv');
    await ffmpeg(ctx, [
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb48le',
      '-s',
      `${SIZE.width}x${SIZE.height}`,
      '-i',
      raw,
      '-vf',
      `format=gbrp16le,${RGB_TO_BT709_FILTER}`,
      '-c:v',
      'ffv1',
      '-color_range',
      'tv',
      '-colorspace',
      'bt709',
      delivered,
    ]);
    const score = await filesDeltaE(ctx, delivered, join(work.dir, 'annex.mp4'), GRID);
    if (!score.ok) throw new Error('score');
    console.warn(
      `[grade] Annex A.4 cube, CPU route vs expected: mean ΔE00 ${score.value.mean.toFixed(3)}, p95 ${score.value.p95.toFixed(3)}`,
    );
    expect(score.value.mean).toBeLessThanOrEqual(0.5);
    // The cube moves colours a lot, so the comparison is not trivially passing.
    const moved = await filesDeltaE(ctx, segment, join(work.dir, 'annex.mp4'), GRID);
    expect(moved.ok && moved.value.mean).toBeGreaterThan(3);
  });

  it('agrees with the GPU port within ΔE 0.5, and the port gets the right request', async () => {
    const lut = warmCube(17);
    const cubePath = await cubeFile('warm.cube', lut);
    const requests: CubeApplyRequest[] = [];
    // The helper's stand-in: Core Image interpolates trilinearly, and the helper encodes on the machine's encoder.
    const applier: CubeApplier = {
      sizes: [17],
      async apply(request, { onLetGo } = {}) {
        requests.push(request);
        const run = await runFfmpeg(ctx, [
          '-y',
          '-i',
          request.input,
          '-vf',
          `${bt709ToRgbFilter()},lut3d=file=${request.cube}:interp=trilinear,${RGB_TO_BT709_FILTER}`,
          '-c:v',
          host.encoder,
          '-b:v',
          '20M',
          '-color_range',
          'tv',
          '-colorspace',
          'bt709',
          request.output,
        ]);
        onLetGo?.();
        return run.ok ? ok({ kind: 'applied', frames: 15, ms: 1 }) : run;
      },
    };
    const gpu = await grade(lut, cubePath, 'warm-gpu.mp4', applier);
    expect(gpu.result.ok && gpu.result.value.route).toBe('gpu');
    expect(gpu.events).toHaveLength(0);
    // The helper writes a temporary file of this run's own next to the output, renamed into place after.
    expect(requests).toEqual([
      {
        input: segment,
        output: expect.stringMatching(/warm-gpu\.mp4\.[0-9a-f]{8}\.part\.mp4$/),
        cube: cubePath,
        colourSpace: 'bt709',
      },
    ]);
    expect(requests[0]?.output.startsWith(join(work.dir, 'warm-gpu.mp4.'))).toBe(true);
    const cpu = await grade(lut, cubePath, 'warm-cpu.mp4');
    expect(cpu.result.ok && cpu.result.value.route).toBe('cpu');
    const between = await filesDeltaE(
      ctx,
      join(work.dir, 'warm-gpu.mp4'),
      join(work.dir, 'warm-cpu.mp4'),
      GRID,
    );
    const moved = await filesDeltaE(ctx, segment, join(work.dir, 'warm-cpu.mp4'), GRID);
    console.warn(
      `[grade] warm cube, GPU port vs CPU route: mean ΔE00 ${between.ok ? between.value.mean.toFixed(3) : '?'}; ` +
        `graded vs input ${moved.ok ? moved.value.mean.toFixed(2) : '?'}`,
    );
    expect(between.ok && between.value.mean).toBeLessThanOrEqual(0.5);
    expect(moved.ok && moved.value.mean).toBeGreaterThan(2);
  });

  it('takes the CPU route when the helper has no Metal device, logged once', async () => {
    const lut = warmCube(17);
    const noMetal: CubeApplier = {
      sizes: [17],
      apply: async () => ok({ kind: 'noAccelerator', detail: 'grade.no_metal' }),
    };
    const { result, events } = await grade(
      lut,
      await cubeFile('warm-2.cube', lut),
      'warm-no-metal.mp4',
      noMetal,
    );
    expect(result.ok && result.value.route).toBe('cpu');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      operation: 'render.grade',
      reason: 'no_accelerator',
      wanted: ['metal'],
    });
  });

  it("agrees with the CPU route within ΔE 0.5 on libplacebo's LUT on Vulkan (LNX1-RND)", async (test) => {
    const gate = await vulkanGrade(ctx);
    if (!gate.ok || gate.value !== true) return test.skip();
    const lut = warmCube(17);
    const cubePath = await cubeFile('warm-vk.cube', lut);
    const vulkan = await grade(lut, cubePath, 'warm-vulkan.mp4', null, true);
    expect(vulkan.result.ok && vulkan.result.value.route).toBe('gpu');
    // The machine's decode and encode carry it: no CPU choice to report on a machine with hardware video.
    expect(vulkan.events.filter((event) => event.operation === 'render.grade')).toEqual([]);
    const cpu = await grade(lut, cubePath, 'warm-cpu-2.mp4');
    expect(cpu.result.ok && cpu.result.value.route).toBe('cpu');
    const between = await filesDeltaE(
      ctx,
      join(work.dir, 'warm-vulkan.mp4'),
      join(work.dir, 'warm-cpu-2.mp4'),
      GRID,
    );
    const moved = await filesDeltaE(ctx, segment, join(work.dir, 'warm-vulkan.mp4'), GRID);
    console.warn(
      `[grade] warm cube, Vulkan route vs CPU route: mean ΔE00 ${between.ok ? between.value.mean.toFixed(3) : '?'}, ` +
        `p95 ${between.ok ? between.value.p95.toFixed(3) : '?'}; graded vs input ${moved.ok ? moved.value.mean.toFixed(2) : '?'}`,
    );
    expect(between.ok && between.value.mean).toBeLessThanOrEqual(0.5);
    expect(moved.ok && moved.value.mean).toBeGreaterThan(2);
    // The cube's path is quoted for libplacebo's option as for lut3d's.
    const odd = await cubeFile("look's.cube", lut, join(work.dir, 'odd vk: a,b [c]'));
    const quoted = await grade(lut, odd, 'odd-vulkan.mp4', null, true);
    expect(quoted.result.ok && quoted.result.value.route).toBe('gpu');
  });

  it('reads a cube from a folder whose name needs filtergraph escaping', async () => {
    const lut = identityCube(17);
    const cubePath = await cubeFile("look's.cube", lut, join(work.dir, 'odd dir: a,b [c]'));
    const { result } = await grade(lut, cubePath, 'odd.mp4');
    expect(result.ok).toBe(true);
  });

  it('refuses an invalid cube with render.cube_invalid before any FFmpeg run', async () => {
    const runs: string[] = [];
    const runner: ProcessRunner = (command, args, options) => {
      runs.push(command);
      return runProcess(command, args, options);
    };
    const cubePath = join(work.dir, 'bad.cube');
    await writeFile(cubePath, 'LUT_3D_SIZE 17\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n0 0 0\n');
    const graded = await gradeSegment({
      segment,
      segmentKey: 'segment',
      cubePath,
      dir: join(work.dir, 'graded'),
      ctx: { ...ctx, runner },
      bitrateKbps: 20_000,
    });
    expect(graded.ok ? null : graded.error.code).toBe('render.cube_invalid');
    expect(runs).toHaveLength(0);
  });
});
