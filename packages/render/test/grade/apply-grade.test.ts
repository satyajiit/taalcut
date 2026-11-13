// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CancelledError,
  err,
  ok,
  type AsyncResult,
  type ComputeFallbackEvent,
  type Result,
} from '@taalcut/core';
import {
  MediaCancelled,
  type HardwareSessionGate,
  type MediaContext,
  type ProcessOutput,
  type ProcessRunner,
} from '@taalcut/media';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CubeInvalid, GradeFailed } from '../../src/errors-phase3';
import { applyGrade, filterPathArg, type ApplyGradeInput } from '../../src/grade/apply-grade';
import type { CubeApplier, CubeApplyOutcome } from '../../src/grade/cube-applier';
import { writeCube } from '../../src/grade/cube-file';
import { gradeSegment } from '../../src/grade/grade-segment';
import { knownEncoders } from '../support/host-video';
import { ENCODER_REFUSED } from '../support/refusing';
import { warmCube } from './fixtures';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taalcut-grade-unit-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const output = (exitCode: number, stderrTail = exitCode === 0 ? '' : 'VT decode failed'): ProcessOutput => ({
  exitCode,
  signal: null,
  stdout: Buffer.alloc(0),
  stderrTail,
  durationMs: 1,
});

/** Records FFmpeg runs; the first answers `first` when given, a successful one writes its output (the last argument). */
function recordingContext(first?: () => Result<ProcessOutput>) {
  const runs: (readonly string[])[] = [];
  const runner: ProcessRunner = async (_command, args) => {
    runs.push(args);
    if (first && runs.length === 1) return first();
    await writeFile(args[args.length - 1] ?? join(dir, 'none'), 'graded');
    return ok(output(0));
  };
  // A Mac's rows and encoder, fixed: the FFmpeg runs recorded are the grade's own.
  const ctx: MediaContext = {
    binaries: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', source: 'sidecar' },
    runner,
    platform: 'darwin',
    encoders: knownEncoders({ h264: 'h264_videotoolbox' }),
  };
  return { runs, ctx };
}

const HELPER_PID = 4343;

/** A helper stand-in that lets go at its answer, or (`later`) only when the test says so. */
function fakeApplier(
  answer: (out: string) => AsyncResult<CubeApplyOutcome>,
  sizes = [17],
  letGo: 'at-answer' | 'later' = 'at-answer',
) {
  const calls: string[] = [];
  const pending: (() => void)[] = [];
  const applier: CubeApplier = {
    sizes,
    async apply(request, { onSend, onLetGo } = {}) {
      calls.push(request.cube);
      onSend?.(HELPER_PID);
      const answered = await answer(request.output);
      if (letGo === 'at-answer') onLetGo?.();
      else if (onLetGo) pending.push(onLetGo);
      return answered;
    },
  };
  return { calls, applier, pending };
}

/** A gate that records what is taken and given back, in order with the FFmpeg runs (`log`). */
function recordingGate(log: string[]): HardwareSessionGate {
  return {
    acquire: (weight) => {
      log.push(`acquire ${weight}`);
      return Promise.resolve(
        ok({
          weight,
          adopt: (pid: number) => void log.push(`adopt ${pid}`),
          release: () => Promise.resolve(void log.push(`release ${weight}`)),
        }),
      );
    },
    limit: () => Promise.resolve(4),
    inUse: () => Promise.resolve(0),
  };
}

function input(
  ctx: MediaContext,
  extra: Partial<ApplyGradeInput> = {},
): ApplyGradeInput & { events: ComputeFallbackEvent[] } {
  const events: ComputeFallbackEvent[] = [];
  return {
    segment: join(dir, 'seg.mp4'),
    cubePath: join(dir, 'look.cube'),
    cube: warmCube(17),
    out: join(dir, 'graded.mp4'),
    ctx,
    bitrateKbps: 40_000,
    gopFrames: 30,
    // The Mac's routes: the applier, else the CPU route (the Vulkan route has its own integration test).
    vulkan: false,
    onFallback: (event) => events.push(event),
    events,
    ...extra,
  };
}

describe('applyGrade', () => {
  it('takes the GPU route when the applier takes the cube: no FFmpeg, no fallback', async () => {
    const { runs, ctx } = recordingContext();
    const { calls, applier } = fakeApplier(async (out) => {
      await writeFile(out, 'gpu');
      return ok({ kind: 'applied', frames: 30, ms: 5 });
    });
    const run = input(ctx, { applier });
    expect(await applyGrade(run)).toEqual(ok({ file: run.out, route: 'gpu' }));
    expect(calls).toEqual([run.cubePath]);
    expect(runs).toHaveLength(0);
    expect(run.events).toHaveLength(0);
    expect(await readFile(run.out, 'utf8')).toBe('gpu');
  });

  it('runs lut3d between a VideoToolbox decode and encode without an applier, logged once', async () => {
    const { runs, ctx } = recordingContext();
    const run = input(ctx);
    expect(await applyGrade(run)).toEqual(ok({ file: run.out, route: 'cpu' }));
    expect(run.events).toEqual([
      expect.objectContaining({ operation: 'render.grade', wanted: ['metal'], reason: 'no_accelerator' }),
    ]);
    const args = runs[0] ?? [];
    expect(args.join(' ')).toContain('-y -hwaccel videotoolbox -i');
    expect(args.join(' ')).toContain(`lut3d=file=${filterPathArg(run.cubePath)}:interp=tetrahedral`);
    expect(args).toContain('h264_videotoolbox');
    expect(args[args.indexOf('-b:v') + 1]).toBe('40000000');
    // A second call finds the graded segment and runs nothing.
    expect(await applyGrade(run)).toEqual(ok({ file: run.out, route: 'cpu' }));
    expect(runs).toHaveLength(1);
  });

  it('sends a cube the applier cannot take down the CPU route as unsupported input', async () => {
    const { runs, ctx } = recordingContext();
    const { calls, applier } = fakeApplier(async () => ok({ kind: 'applied', frames: 1, ms: 1 }));
    const run = input(ctx, { applier, cube: warmCube(33) });
    expect((await applyGrade(run)).ok).toBe(true);
    expect(calls).toHaveLength(0);
    expect(runs).toHaveLength(1);
    expect(run.events.map((event) => event.reason)).toEqual(['unsupported_input']);
  });

  it('falls back on no Metal device and on a failed GPU run, with the reason', async () => {
    const noMetal = recordingContext();
    const first = input(noMetal.ctx, {
      applier: fakeApplier(async () => ok({ kind: 'noAccelerator', detail: 'grade.no_metal' })).applier,
    });
    expect(await applyGrade(first)).toEqual(ok({ file: first.out, route: 'cpu' }));
    expect(first.events.map((event) => event.reason)).toEqual(['no_accelerator']);

    const failing = recordingContext();
    const second = input(failing.ctx, {
      out: join(dir, 'graded-2.mp4'),
      applier: fakeApplier(async () => err(GradeFailed(undefined, { detail: 'grade.failed: boom' }))).applier,
    });
    expect(await applyGrade(second)).toEqual(ok({ file: second.out, route: 'cpu' }));
    expect(second.events.map((event) => event.reason)).toEqual(['accelerator_failed']);
    expect(second.events[0]?.detail).toContain('grade.failed');
  });

  it('stops on a cube the helper refuses, without the CPU route', async () => {
    const { runs, ctx } = recordingContext();
    const run = input(ctx, {
      applier: fakeApplier(async () => err(CubeInvalid({ reason: 'helper' }))).applier,
    });
    const graded = await applyGrade(run);
    expect(graded.ok ? null : graded.error.code).toBe('render.cube_invalid');
    expect(runs).toHaveLength(0);
  });

  it('runs once more on Apple software encoding after a VideoToolbox failure, reported as its own fallback', async () => {
    const { runs, ctx } = recordingContext(() => ok(output(1)));
    const run = input(ctx);
    expect((await applyGrade(run)).ok).toBe(true);
    expect(runs).toHaveLength(2);
    expect(runs[1]).not.toContain('-hwaccel');
    expect(runs[1]).toContain('h264_videotoolbox');
    expect(runs[1]?.join(' ')).toContain('-require_sw 1');
    expect(runs[1]).not.toContain('-allow_sw');
    expect(run.events.map((event) => event.operation)).toEqual(['render.grade', 'render.gradeDecode']);
    expect(run.events[1]?.detail).toMatch(/^VideoToolbox failed: .*VT decode failed$/s);
  });

  it('names a VideoToolbox encoder that would not start as the reason (IX3-K4)', async () => {
    const { runs, ctx } = recordingContext(() => ok(output(1, ENCODER_REFUSED)));
    const run = input(ctx);
    expect((await applyGrade(run)).ok).toBe(true);
    expect(runs).toHaveLength(2);
    expect(run.events[1]).toEqual({
      operation: 'render.gradeDecode',
      wanted: ['videotoolbox'],
      reason: 'accelerator_failed',
      detail: 'the VideoToolbox encoder would not start (-12902)',
    });
  });

  it('never retries a cancelled run', async () => {
    const controller = new AbortController();
    const { runs, ctx } = recordingContext(() => {
      controller.abort();
      return err(MediaCancelled());
    });
    const run = input(ctx, { signal: controller.signal });
    const graded = await applyGrade(run);
    expect(graded.ok ? null : graded.error.code).toBe('media.cancelled');
    expect(runs).toHaveLength(1);
    expect(run.events.map((event) => event.operation)).toEqual(['render.grade']);
  });
});

describe("the GPU route's sessions (IX3-F5, H5)", () => {
  it('holds two sessions for video.applyCube, names the helper before the send, gives them back at the answer', async () => {
    const log: string[] = [];
    const { ctx } = recordingContext();
    const { applier } = fakeApplier(async (out) => {
      log.push('apply');
      await writeFile(out, 'gpu');
      return ok({ kind: 'applied', frames: 30, ms: 5 });
    });
    const run = input({ ...ctx, hardwareSessions: recordingGate(log) }, { applier });
    expect(await applyGrade(run)).toEqual(ok({ file: run.out, route: 'gpu' }));
    expect(log).toEqual(['acquire 2', `adopt ${HELPER_PID}`, 'apply', 'release 2']);
  });

  it('starts the CPU route only once the helper has let go of a request that failed', async () => {
    const log: string[] = [];
    const { runs, ctx } = recordingContext();
    const runner: ProcessRunner = (command, args, options) => {
      log.push('ffmpeg');
      return ctx.runner!(command, args, options);
    };
    const { applier, pending } = fakeApplier(
      async () => err(GradeFailed(undefined, { detail: 'helper.timeout: no answer' })),
      [17],
      'later',
    );
    const run = input({ ...ctx, runner, hardwareSessions: recordingGate(log) }, { applier });
    const graded = applyGrade(run);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(log).toEqual(['acquire 2', `adopt ${HELPER_PID}`]);
    expect(runs).toHaveLength(0);
    expect(pending).toHaveLength(1);
    pending[0]!();
    expect(await graded).toEqual(ok({ file: run.out, route: 'cpu' }));
    expect(log).toEqual(['acquire 2', `adopt ${HELPER_PID}`, 'release 2', 'ffmpeg']);
  });

  it('returns a cancel at once and keeps the sessions until the helper lets go', async () => {
    const log: string[] = [];
    const { runs, ctx } = recordingContext();
    const { applier, pending } = fakeApplier(async () => err(CancelledError()), [17], 'later');
    const run = input({ ...ctx, hardwareSessions: recordingGate(log) }, { applier });
    const graded = await applyGrade(run);
    expect(graded.ok ? null : graded.error.code).toBe('core.cancelled');
    expect(runs).toHaveLength(0);
    expect(log).toEqual(['acquire 2', `adopt ${HELPER_PID}`]);
    pending[0]!();
    await Promise.resolve();
    expect(log).toEqual(['acquire 2', `adopt ${HELPER_PID}`, 'release 2']);
  });

  it('stops waiting for the helper on a cancel, and runs no FFmpeg', async () => {
    const log: string[] = [];
    const controller = new AbortController();
    const { runs, ctx } = recordingContext();
    const { applier } = fakeApplier(
      async () => err(GradeFailed(undefined, { detail: 'helper.timeout: no answer' })),
      [17],
      'later',
    );
    const run = input(
      { ...ctx, hardwareSessions: recordingGate(log) },
      { applier, signal: controller.signal },
    );
    const graded = applyGrade(run);
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    const result = await graded;
    expect(result.ok ? null : result.error.code).toBe('core.cancelled');
    expect(runs).toHaveLength(0);
    expect(log).toEqual(['acquire 2', `adopt ${HELPER_PID}`]);
  });
});

describe('gradeSegment', () => {
  it('refuses an invalid cube before any encode', async () => {
    const { runs, ctx } = recordingContext();
    const cubePath = join(dir, 'bad.cube');
    await writeFile(cubePath, 'LUT_3D_SIZE 17\r\n0 0 0\r\n');
    const graded = await gradeSegment({
      ...input(ctx),
      cubePath,
      segmentKey: 'abc',
      dir: join(dir, 'graded'),
    });
    expect(graded.ok ? null : graded.error.code).toBe('render.cube_invalid');
    expect(runs).toHaveLength(0);
  });

  it('names the graded segment by the segment key and the cube bytes', async () => {
    const { ctx } = recordingContext();
    const cubePath = join(dir, 'look.cube');
    await writeFile(cubePath, writeCube(warmCube(17)));
    const one = await gradeSegment({
      ...input(ctx),
      cubePath,
      segmentKey: 'seg-a',
      dir: join(dir, 'graded'),
    });
    const two = await gradeSegment({
      ...input(ctx),
      cubePath,
      segmentKey: 'seg-b',
      dir: join(dir, 'graded'),
    });
    if (!one.ok || !two.ok) throw new Error('graded');
    expect(one.value.key).not.toBe(two.value.key);
    expect(one.value.file).toBe(join(dir, 'graded', `${one.value.key}.mp4`));
  });
});

describe('filterPathArg', () => {
  it('escapes a path for an option inside a filtergraph', () => {
    expect(filterPathArg("/a b/it's:x,[y];z.cube")).toBe(String.raw`/a b/it\\\'s\\:x\,\[y\]\;z.cube`);
  });
});
