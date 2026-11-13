// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A folder-backed ExperimentSandbox for tests: the real one lives in
 * @taalcut/tools, which templates may not import. `run` is whatever the test
 * says (a fake yt-dlp writes a synthetic reel into the experiment).
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  defineError,
  err,
  NotFoundError,
  ok,
  type AsyncResult,
  type Experiment,
  type ExperimentId,
  type ExperimentSandbox,
  type JobProgress,
  type SandboxFile,
  type SandboxRunRequest,
  type SandboxRunResult,
} from '@taalcut/core';

/** What the real sandbox returns when the disk won't let a folder go (@taalcut/tools). */
export const DiscardFailed = defineError('sandbox.discard_failed', { retryable: true });

export type FakeRun = (
  experiment: Experiment,
  request: SandboxRunRequest,
  options: { onOutputLine?: (stream: 'stdout' | 'stderr', line: string) => void; signal?: AbortSignal },
) => AsyncResult<SandboxRunResult>;

export interface DirSandbox extends ExperimentSandbox {
  readonly root: string;
  readonly runs: SandboxRunRequest[];
  /** Experiments still open. */
  openIds(): ExperimentId[];
  setRun(run: FakeRun): void;
  /** While on, every discard fails and leaves the folder (and the experiment) in place. */
  failDiscards(on: boolean): void;
  /** Experiments discarded so far, failed attempts included. */
  readonly discards: ExperimentId[];
}

async function sizeOf(path: string): Promise<number> {
  const info = await stat(path);
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const entry of await readdir(path)) total += await sizeOf(join(path, entry));
  return total;
}

export function createDirSandbox(root: string, run?: FakeRun): DirSandbox {
  const experiments = new Map<ExperimentId, Experiment>();
  const runs: SandboxRunRequest[] = [];
  const discards: ExperimentId[] = [];
  let runner = run;
  let failing = false;
  const gone = (id: string) => err(NotFoundError({ entity: 'experiment', id }));
  const find = (id: ExperimentId) => {
    const experiment = experiments.get(id);
    return experiment && existsSync(experiment.dir) ? experiment : undefined;
  };
  return {
    root,
    runs,
    openIds: () => [...experiments.keys()],
    setRun: (next) => void (runner = next),
    failDiscards: (on) => void (failing = on),
    discards,
    async open(input) {
      const dir = join(root, input.id);
      await mkdir(dir, { recursive: true });
      const experiment: Experiment = {
        id: input.id,
        projectId: input.projectId,
        purpose: input.purpose,
        dir,
        createdAt: 0,
        expiresAt: input.ttlMs ?? 86_400_000,
      };
      experiments.set(input.id, experiment);
      return ok(experiment);
    },
    async get(id) {
      const experiment = find(id);
      return experiment ? ok(experiment) : gone(id);
    },
    async run(id, request, options = {}) {
      const experiment = find(id);
      if (!experiment) return gone(id);
      runs.push(request);
      if (!runner) return err(NotFoundError({ entity: 'program', id: request.program }));
      return runner(experiment, request, {
        ...(options.onOutputLine ? { onOutputLine: options.onOutputLine } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    },
    async list(id, dir = '') {
      const experiment = find(id);
      if (!experiment) return gone(id);
      const entries = await readdir(join(experiment.dir, dir), { withFileTypes: true });
      const files: SandboxFile[] = [];
      for (const entry of entries) {
        const path = dir ? `${dir}/${entry.name}` : entry.name;
        const full = join(experiment.dir, path);
        files.push({ path, bytes: await sizeOf(full), kind: entry.isDirectory() ? 'directory' : 'file' });
      }
      return ok(files);
    },
    async readText(id, path, maxBytes = 65_536) {
      const experiment = find(id);
      if (!experiment) return gone(id);
      return ok((await readFile(join(experiment.dir, path), 'utf8')).slice(0, maxBytes));
    },
    async discard(id) {
      discards.push(id);
      const experiment = experiments.get(id);
      if (failing && experiment && existsSync(experiment.dir))
        return err(DiscardFailed(undefined, { detail: 'EACCES' }));
      experiments.delete(id);
      if (!experiment || !existsSync(experiment.dir)) return gone(id);
      const freedBytes = await sizeOf(experiment.dir);
      await rm(experiment.dir, { recursive: true, force: true });
      return ok({ freedBytes });
    },
    async sweep() {
      return ok({ removed: [] });
    },
  };
}

/** What a progress listener saw, for assertions. */
export function progressLog(): { log: JobProgress[]; push: (progress: JobProgress) => void } {
  const log: JobProgress[] = [];
  return { log, push: (progress) => void log.push(progress) };
}
