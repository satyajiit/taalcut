// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main runs the compile sweep (sweep.ts, IX3-B6) at start, before it starts the utility processes, so no helper of
 * this app runs yet. The platform brings the cache and its probes (platform/types.ts compileCache): macOS has Core
 * ML's cache for the mac helper; Linux has none, so there is nothing to sweep. The sweep never fails a start: an
 * error is logged and the compiles stay.
 */
import { join } from 'node:path';
import type { PlatformCompileCache } from '../../platform/types';
import { sweepHelperCompiles, type SweepOutcome } from './sweep';
import { sweepStatePath } from './sweep-state';

export interface CompileSweepOptions {
  readonly userData: string;
  /** The platform's compile cache; none, nothing to sweep. */
  readonly cache: PlatformCompileCache | undefined;
  readonly log: (line: string) => void;
}

function describe(outcome: SweepOutcome): string | null {
  if (outcome.kind === 'unchanged') return null;
  if (outcome.kind === 'deferred') return `[compile-cache] not swept: ${outcome.reason}`;
  return `[compile-cache] let go of ${outcome.discarded.map(({ build, why }) => `${build} (${why})`).join('; ')}`;
}

/** Sweeps this platform's compile cache; resolves when it has decided (deletions go on in the background). */
export async function sweepCompileCache(options: CompileSweepOptions): Promise<void> {
  const { cache } = options;
  if (cache === undefined) return;
  try {
    const outcome = await sweepHelperCompiles({
      ...cache,
      componentsRoot: join(options.userData, 'components'),
      statePath: sweepStatePath(options.userData),
      now: () => new Date(),
    });
    const line = describe(outcome);
    if (line !== null) options.log(line);
    outcome.deleted.catch((error: unknown) =>
      options.log(`[compile-cache] deleting failed: ${String(error)}`),
    );
  } catch (error) {
    options.log(`[compile-cache] sweep failed, compiles kept: ${String(error)}`);
  }
}
