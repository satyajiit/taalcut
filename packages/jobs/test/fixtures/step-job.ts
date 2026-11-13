// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Shared by the kill -9 test and its child process: a store persisted to a
 * JSON file (written atomically on every change, so a killed process leaves
 * the last committed state behind) and a job that works in steps and resumes
 * from the last step it saved.
 */
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { z } from 'zod';
import { defineJob, MemoryJobStore, type JobRecord } from '../../src/index';

export const STEP_JOB_KIND = 'test.steps';

function writeAtomically(path: string, text: string): void {
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

/**
 * A MemoryJobStore loaded from `path` that writes every change back to it
 * before returning. `clock` lets a test stand later in time than the process
 * that wrote the file, so a dead process's lease has expired without waiting.
 */
export function fileBackedStore(
  path: string,
  onSaved?: (records: readonly JobRecord[]) => void,
  clock?: () => number,
): MemoryJobStore {
  const initial = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as JobRecord[]) : [];
  return new MemoryJobStore({
    initial,
    ...(clock ? { clock } : {}),
    onChange: (records) => {
      writeAtomically(path, JSON.stringify(records));
      onSaved?.(records);
    },
  });
}

/** A lease no busy machine outlives: the process holding it never loses the job while alive. */
export const LONG_LEASE_MS = 10 * 60_000;

/** Resolves after `ms`, or rejects with the signal's reason when it aborts. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}

/**
 * Works through `steps` steps, saving `{ step }` as progress after each;
 * resumes after the last saved step. With `holdAfter`, it stops after that
 * step and waits until aborted (or killed), so a test decides when the
 * process dies instead of racing the steps.
 */
export function stepJob(onStep: (step: number, attempt: number) => void, stepMs = 25, holdAfter?: number) {
  return defineJob({
    kind: STEP_JOB_KIND,
    resourceClass: 'cpu',
    payload: z.object({ steps: z.number().int().positive() }),
    handler: async ({ steps }, signal, progress, context) => {
      const saved = (context.resumeFrom?.detail as { step?: number } | undefined)?.step ?? 0;
      for (let step = saved + 1; step <= steps; step++) {
        await pause(stepMs, signal);
        onStep(step, context.attempt);
        progress.report(step / steps, { step });
        if (step === holdAfter) await pause(LONG_LEASE_MS, signal);
      }
      return { steps, resumedAfter: saved };
    },
  });
}
