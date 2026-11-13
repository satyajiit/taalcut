// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The render process's queued work (round P3-3, render-runner.ts): a grade LUT is `vision.bakeGrade` in the jobs
 * queue as the export job's child, read from the media cache, baked once more when the cache evicted an earlier
 * cube, and a failed bake is the stage's error; the runner reaches main's `runner` service over the port.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import {
  embeddingsContract,
  err,
  implementContract,
  jobRunnerRouter,
  MAIN_SERVICE_CONTRACTS,
  newId,
  notServedRouter,
  ok,
  RationalTime,
  registerJob,
  serveRpc,
  styleGradeSchema,
  telemetryIngestContract,
  ValidationError,
  type JobRunOptions,
  type JobRunner,
} from '@taalcut/core';
import { visionBakeGradeJob } from '@taalcut/vision';
import { queuedGradeLuts, renderJobRunner } from '../src/utility/roots/render-runner';

const grade = styleGradeSchema.parse({
  version: 1,
  target: {
    version: 1,
    space: 'ruderman-lab',
    encoding: 'bt709',
    mean: [0.1, 0.01, -0.02],
    std: [0.3, 0.05, 0.04],
    frames: 8,
    pixels: 129_600,
  },
  strength: 0.8,
  cubeSize: 33,
  source: { kind: 'template', templateId: newId<'Template'>(), version: 1 },
  measuredAt: 0,
});
const range = {
  start: RationalTime.of(0, { num: 30, den: 1 }),
  duration: RationalTime.of(60, { num: 30, den: 1 }),
};
const cubeKey = (digit: string) => `grades/${digit}${digit}/${digit.repeat(64)}.v1.cube`;
const lutRef = (key: string) => ({
  lut: { kind: 'gradeLut', key, bytes: 12, mimeType: 'text/plain', recipe: 1 },
});

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function cacheWith(...keys: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'taalcut-render-runner-'));
  dirs.push(root);
  for (const key of keys) {
    await mkdir(dirname(join(root, key)), { recursive: true });
    await writeFile(join(root, key), 'LUT_3D_SIZE 2\n');
  }
  return root;
}

/** A queue that answers each bake with the next key, recording what it was asked. */
function fakeQueue(keys: string[]) {
  const runs: { kind: string; input: unknown; options: JobRunOptions | undefined }[] = [];
  const runner: Pick<JobRunner, 'run'> = {
    run: async (kind, input, options) => {
      runs.push({ kind: kind.kind, input, options });
      const key = keys.shift();
      return key ? ok(kind.output.parse(lutRef(key))) : err(ValidationError({ field: 'grade' }));
    },
  };
  return { runner, runs };
}

describe('the render process grade LUTs (P3-V17)', () => {
  it("bakes through the queue as the export job's child and reads the cube from the media cache", async () => {
    const cacheRoot = await cacheWith(cubeKey('a'));
    const { runner, runs } = fakeQueue([cubeKey('a')]);
    const assetId = newId<'Asset'>();
    const parentJobId = newId<'Job'>();
    const signal = new AbortController().signal;
    const cube = await queuedGradeLuts({ runner, cacheRoot }).lutFor(assetId, range, grade, signal, {
      parentJobId,
    });
    expect(cube).toEqual(ok(join(cacheRoot, cubeKey('a'))));
    expect(runs).toEqual([
      {
        kind: 'vision.bakeGrade',
        input: { assetId, range, target: grade.target, strength: 0.8, cubeSize: 33 },
        options: { signal, parentJobId },
      },
    ]);
  });

  it('bakes once more under a fresh key when the cache evicted the cube an earlier bake made', async () => {
    const cacheRoot = await cacheWith(cubeKey('b'));
    const { runner, runs } = fakeQueue([cubeKey('a'), cubeKey('b')]);
    const assetId = newId<'Asset'>();
    const luts = queuedGradeLuts({ runner, cacheRoot, now: () => 42 });
    expect(await luts.lutFor(assetId, range, grade)).toEqual(ok(join(cacheRoot, cubeKey('b'))));
    const input = { assetId, range, target: grade.target, strength: 0.8, cubeSize: grade.cubeSize };
    expect(runs.map((run) => run.options?.idempotencyKey)).toEqual([
      undefined,
      `${visionBakeGradeJob.idempotencyKey?.(input) ?? ''}:rebake:42`,
    ]);
  });

  it('answers a failed bake with its error', async () => {
    const { runner } = fakeQueue([]);
    const failed = await queuedGradeLuts({ runner, cacheRoot: await cacheWith() }).lutFor(
      newId<'Asset'>(),
      range,
      grade,
    );
    expect(failed.ok ? null : failed.error.code).toBe('core.validation');
  });
});

describe("the render process's runner", () => {
  it('has none without a port to main', () => {
    expect(renderJobRunner(undefined)).toBeUndefined();
  });

  it("runs a bake through main's runner service with the export job as its parent", async () => {
    const seen: (JobRunOptions | undefined)[] = [];
    const queue: JobRunner = {
      run: async (kind, _input, options) => {
        seen.push(options);
        return ok(kind.output.parse(lutRef(cubeKey('c'))));
      },
    };
    const telemetry = implementContract(telemetryIngestContract);
    const router = implementContract(MAIN_SERVICE_CONTRACTS.render).router({
      telemetry: telemetry.router({ record: telemetry.record.handler(async () => undefined) }),
      // The jobs process's registration, looked up by name (its handler isn't run here).
      runner: jobRunnerRouter(queue, [
        registerJob(visionBakeGradeJob, async () => err(ValidationError({ field: 'job' }))),
      ]),
      embeddings: notServedRouter(embeddingsContract, 'embeddings'),
    });
    const { port1, port2 } = new MessageChannel();
    serveRpc(router, port1, { context: {} });
    const runner = renderJobRunner(port2);
    const parentJobId = newId<'Job'>();
    const input = {
      assetId: newId<'Asset'>(),
      range,
      target: grade.target,
      strength: 0.8,
      cubeSize: grade.cubeSize,
    };
    const baked = await runner?.run(visionBakeGradeJob, input, { parentJobId });
    expect(baked).toEqual(ok(lutRef(cubeKey('c'))));
    expect(seen.map((options) => options?.parentJobId)).toEqual([parentJobId]);
    port1.close();
    port2.close();
  });
});
