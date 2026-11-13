// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The render process's queued work (round P3-3; P3-V17, P3-V2): an export's grade LUTs (vision's
 * `vision.bakeGrade`) and its missing subject tracks (`render.trackSubjects`, render-phase3.ts) run in the jobs
 * queue, reached through main's `runner` (MAIN_SERVICE_CONTRACTS.render, forwarded to the jobs process). Each goes
 * as the export job's child (`parentJobId`): the export holds the 'gpu' slot, so the queue starts it at once.
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  connectRpc,
  jobRunnerOverRpc,
  MAIN_SERVICE_CONTRACTS,
  ok,
  type JobRunner,
  type PortLike,
} from '@taalcut/core';
import type { GradeLutSource } from '@taalcut/render';
import { visionBakeGradeJob } from '@taalcut/vision';

type RenderMainClient = ReturnType<typeof connectRpc<typeof MAIN_SERVICE_CONTRACTS.render>>['client'];
const clients = new WeakMap<PortLike, RenderMainClient>();

/** Main's services for this process, one client per port (the runner and, AGT2-MATCH, the query embedder). */
export function renderMainClient(main: PortLike | undefined): RenderMainClient | undefined {
  if (!main) return undefined;
  let client = clients.get(main);
  if (!client) {
    client = connectRpc(MAIN_SERVICE_CONTRACTS.render, main, { peer: 'main' }).client;
    clients.set(main, client);
  }
  return client;
}

/** The jobs queue as this process's runner, through main; none without a port to main. */
export function renderJobRunner(main: PortLike | undefined): JobRunner | undefined {
  const client = renderMainClient(main);
  return client ? jobRunnerOverRpc(() => client.runner) : undefined;
}

export interface QueuedGradeLutDeps {
  readonly runner: Pick<JobRunner, 'run'>;
  /** The media cache's folder, where the jobs process keeps the baked cubes. */
  readonly cacheRoot: string;
  readonly now?: () => number;
}

const present = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/** A clip's cube for a grade: `vision.bakeGrade` in the jobs queue (a cube baked before is its answer at once). */
export function queuedGradeLuts(deps: QueuedGradeLutDeps): GradeLutSource {
  const now = deps.now ?? Date.now;
  return {
    async lutFor(assetId, range, grade, signal, job) {
      const input = {
        assetId,
        range,
        target: grade.target,
        strength: grade.strength,
        cubeSize: grade.cubeSize,
      };
      const options = {
        ...(signal ? { signal } : {}),
        ...(job?.parentJobId ? { parentJobId: job.parentJobId } : {}),
      };
      const baked = await deps.runner.run(visionBakeGradeJob, input, options);
      if (!baked.ok) return baked;
      // The key is a checked media-cache key (the kind's output schema): it stays inside the cache folder.
      const path = join(deps.cacheRoot, baked.value.lut.key);
      if (await present(path)) return ok(path);
      // The queue answered with an earlier bake whose cube the cache has evicted since: bake it once more.
      const key = `${visionBakeGradeJob.idempotencyKey?.(input) ?? visionBakeGradeJob.kind}:rebake:${now()}`;
      const again = await deps.runner.run(visionBakeGradeJob, input, { ...options, idempotencyKey: key });
      return again.ok ? ok(join(deps.cacheRoot, again.value.lut.key)) : again;
    },
  };
}
