// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { availableParallelism } from 'node:os';

/**
 * The cores one run of the tests may use (UX2-FIXUP round 2). The machine can be shared: the orchestrator's
 * heavy.sh runs two heavy jobs at once and gives each its share in TAALCUT_TEST_CORES (cores ÷ slots), so two
 * budgeted runs don't each size themselves for the whole Mac. Unset, a run has the whole machine (CI, a
 * developer's own run). Anything but a whole number from 1 to the machine's cores is an error, never a quiet
 * default: a run sized wrongly is what this is for.
 */
export const TEST_CORES_ENV = 'TAALCUT_TEST_CORES';

export function testCores(
  env: Readonly<Record<string, string | undefined>> = process.env,
  available: number = availableParallelism(),
): number {
  const value = env[TEST_CORES_ENV];
  if (value === undefined) return available;
  const cores = /^[1-9][0-9]*$/.test(value) ? Number(value) : Number.NaN;
  if (!(cores <= available))
    throw new Error(
      `${TEST_CORES_ENV} must be a whole number of cores from 1 to ${available} (this machine's), not "${value}"`,
    );
  return cores;
}

/**
 * Playwright workers for `cores`: half of them, as Playwright's own default does for the whole machine, since
 * each worker drives a browser of several processes.
 */
export function playwrightWorkers(cores: number): number {
  return Math.max(1, Math.floor(cores / 2));
}
