// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Test builds only: every `compute.fallback` on main's bus (each utility process's events reach it through
 * `bridgeUtilityEvents`), one JSON line each, appended to the file `TAALCUT_COMPUTE_FALLBACK_LOG` names. The indexing
 * bench names one per run (tools/evals perf/bench, IX3-B4), so "no new CPU fallbacks" is a number it can check.
 * index.ts reaches this module only inside `__TAALCUT_FLAVOUR__ === 'test'` through import(). Events from before
 * main's composition returned are not seen (nor by any other listener in main).
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EventBus, Unsubscribe } from '@taalcut/core';

export const COMPUTE_FALLBACK_LOG_ENV = 'TAALCUT_COMPUTE_FALLBACK_LOG';

export interface FallbackLogDeps {
  readonly events: EventBus;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Appends one line. Default: the file system. */
  readonly append?: (path: string, line: string) => void;
}

const appendLine = (path: string, line: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, line);
};

/**
 * Starts the log when the variable names a file (created at once, so an empty file means "none", not "not
 * recorded"); null when it is unset.
 */
export function logComputeFallbacks(deps: FallbackLogDeps): Unsubscribe | null {
  const path = deps.env[COMPUTE_FALLBACK_LOG_ENV]?.trim();
  if (!path) return null;
  const append = deps.append ?? appendLine;
  append(path, '');
  return deps.events.on('compute.fallback', (event) =>
    append(path, `${JSON.stringify({ at: event.at, ...event.payload })}\n`),
  );
}
