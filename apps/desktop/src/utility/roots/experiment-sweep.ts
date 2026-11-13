// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The experiment sweep in the jobs process (templates SPEC, "Keep the reel,
 * discard the scratch"): at start and hourly, the scratch root loses expired
 * experiments, folders without a valid manifest and tampered manifests, so
 * what a crashed or abandoned breakdown left behind does not stay for the
 * life of app data. Live experiments stay, so a breakdown the engine requeued
 * can resume. It reads only `<userData>/scratch`: a reel a template keeps
 * (REF1, `<userData>/templates/media`) is never swept. It sweeps the folder directly, also for the exec sandbox the jobs
 * root wires on it (template-sandbox.ts); the sandbox's own `sweep` is the
 * same code.
 */
import { join } from 'node:path';
import { createToken, type AsyncResult, type Container, type ExperimentId } from '@taalcut/core';
import { sweepExperiments } from '@taalcut/tools';
import type { UtilityConfig } from '../../shared/rpc-ipc';

export const EXPERIMENT_SWEEP_MS = 60 * 60 * 1000;

/** `<userData>/scratch`: the experiments' root (never inside a library source). */
export function scratchRoot(userData: string): string {
  return join(userData, 'scratch');
}

export interface ExperimentSweep {
  /** Resolves when the start-up sweep is done. */
  readonly first: Promise<void>;
  stop(): void;
}

/** Sweeps now and then every `intervalMs`. A failed sweep is logged; the next one tries again. */
export function startExperimentSweep(options: {
  readonly sweep: () => AsyncResult<{ readonly removed: readonly ExperimentId[] }>;
  readonly intervalMs?: number;
  readonly log?: (message: string) => void;
}): ExperimentSweep {
  const log = options.log ?? ((message: string) => console.warn(`[scratch] ${message}`));
  const run = async () => {
    try {
      const swept = await options.sweep();
      if (!swept.ok) log(`sweep failed: ${swept.error.code}`);
      else if (swept.value.removed.length > 0) log(`swept ${swept.value.removed.length} experiment(s)`);
    } catch (cause) {
      log(`sweep threw: ${String(cause)}`);
    }
  };
  const first = run();
  const timer = setInterval(() => void run(), options.intervalMs ?? EXPERIMENT_SWEEP_MS);
  timer.unref();
  return { first, stop: () => clearInterval(timer) };
}

const ExperimentSweepToken = createToken<ExperimentSweep>('desktop.experimentSweep');

/** Registers the sweep on the jobs container (stopped with it); `startExperimentSweeps` starts it. */
export function registerExperimentSweep(container: Container, config: Pick<UtilityConfig, 'userData'>): void {
  container.factory(
    ExperimentSweepToken,
    () => startExperimentSweep({ sweep: () => sweepExperiments({ root: scratchRoot(config.userData) }) }),
    { dispose: (sweep) => sweep.stop() },
  );
}

export function startExperimentSweeps(container: Container): ExperimentSweep {
  return container.resolve(ExperimentSweepToken);
}
