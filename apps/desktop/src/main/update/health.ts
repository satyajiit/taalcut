// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * "Healthy" for the first launch of a new version (P3-B9): the library opened and migrated, the agent and jobs
 * processes answered their first diagnostics.ping, the first window reached ready-to-show and its renderer asked
 * for its port, all within HEALTH_DEADLINE_MS. Then main writes updates/healthy-<version>, which tells the guard
 * (and the next launch) that the update works. A launch that never gets there writes nothing: the guard decides.
 * Electron-free; health-electron.ts marks the signals.
 */
import { writeFileSync } from 'node:fs';

export const HEALTH_SIGNALS = ['database', 'agent', 'jobs', 'window', 'renderer'] as const;
export type HealthSignal = (typeof HEALTH_SIGNALS)[number];
export const HEALTH_DEADLINE_MS = 60_000;

export interface HealthWatch {
  mark(signal: HealthSignal): void;
  /** True once every signal arrived in time. */
  readonly healthy: boolean;
}

export interface HealthWatchDeps {
  readonly now: () => number;
  /** When the launch started (process start), so slow early steps count. */
  readonly startedAt: number;
  readonly deadlineMs?: number;
  /** Called once, when the last signal arrives in time. */
  readonly onHealthy: () => void;
}

export function createHealthWatch(deps: HealthWatchDeps): HealthWatch {
  const deadline = deps.startedAt + (deps.deadlineMs ?? HEALTH_DEADLINE_MS);
  const seen = new Set<HealthSignal>();
  let healthy = false;
  let late = false;
  return {
    mark(signal) {
      if (healthy || late) return;
      if (deps.now() > deadline) {
        late = true;
        return;
      }
      seen.add(signal);
      if (seen.size < HEALTH_SIGNALS.length) return;
      healthy = true;
      deps.onHealthy();
    },
    get healthy() {
      return healthy;
    },
  };
}

/** The marker the guard waits for: an empty file named after the version. */
export function writeHealthyMarker(file: string): void {
  writeFileSync(file, '', { mode: 0o600 });
}
