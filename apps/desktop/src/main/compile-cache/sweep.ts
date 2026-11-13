// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The app's sweep of the mac helper's Core ML compiles (IX3-B6, design A row 14), run by main at start, before any
 * process can start a helper. Core ML compiles each model once per path and keeps it for good (about 1 GB for the
 * embedder), so a component update leaves the old version's compile behind. A compile can't be told apart from the
 * others without reading Apple's files (e5rt-store.ts), so the sweep lets go of whole build folders, and only when
 * it is sure they hold nothing it still needs, or something it no longer has:
 * - **Another OS build's folder**: the running macOS never reads it.
 * - **This build's folder, when a Core ML component version recorded at the last sweep is gone** (updated or
 *   removed; coreml-components.ts). The versions still installed compile again on their next load, in the
 *   background (the embedder runs on WebGPU meanwhile and no call waits for it, vision SPEC IX2-F10): the price of
 *   never reading Apple's files, paid once per component update.
 * Never while any mac helper runs (it may be using them): then nothing is removed and nothing recorded, and the next
 * start tries again. The first start of a userData (nothing recorded, as in every e2e run) records and removes
 * nothing; a start without a readable component registry decides nothing.
 */
import { coreMlComponentDirs } from './coreml-components';
import type { CompileStore } from './e5rt-store';
import type { SweepProbes } from './mac-probes';
import { readSweepState, writeSweepState } from './sweep-state';

export interface SweepDeps {
  readonly store: CompileStore;
  readonly probes: SweepProbes;
  /** `<userData>/components`. */
  readonly componentsRoot: string;
  readonly statePath: string;
  readonly now: () => Date;
}

export type SweepOutcome = (
  | { readonly kind: 'unchanged' }
  /** Nothing removed or recorded; the next start tries again. */
  | { readonly kind: 'deferred'; readonly reason: string }
  /** Build folders let go, with why. */
  | {
      readonly kind: 'swept';
      readonly discarded: readonly { readonly build: string; readonly why: string }[];
    }
) & {
  /** The deletions, in the background: what this sweep let go and what an earlier one left. */
  readonly deleted: Promise<void>;
};

interface Plan {
  readonly discard: readonly { readonly build: string; readonly why: string }[];
  readonly installed: readonly string[];
}

/** What to let go, or why the sweep can't decide now; null when it can't decide anything (no registry). */
async function plan(deps: SweepDeps): Promise<Plan | { readonly defer: string } | null> {
  const installed = coreMlComponentDirs(deps.componentsRoot);
  if (installed === null) return null;
  const state = await readSweepState(deps.statePath);
  // A first start (or a fresh userData, as every e2e run has) only records what is installed.
  if (state === null) return { discard: [], installed };
  const gone = state.coreMlComponents.filter((dir) => !installed.includes(dir));
  const builds = deps.store.builds();
  if (builds.length === 0) return { discard: [], installed };
  const current = await deps.probes.osBuild();
  if (current === null) return { defer: 'the OS build could not be read' };
  const discard = builds
    .filter((build) => build !== current)
    .map((build) => ({ build, why: `compiles for another macOS build (this one is ${current})` }));
  if (gone.length > 0 && builds.includes(current))
    discard.push({ build: current, why: `component versions no longer installed: ${gone.join(', ')}` });
  return { discard, installed };
}

export async function sweepHelperCompiles(deps: SweepDeps): Promise<SweepOutcome> {
  const deleted = deps.store.discardLeftovers();
  const decided = await plan(deps);
  if (decided === null) return { kind: 'unchanged', deleted };
  if ('defer' in decided) return { kind: 'deferred', reason: decided.defer, deleted };
  if (decided.discard.length > 0 && (await deps.probes.helperRunning()))
    return { kind: 'deferred', reason: 'a mac helper is running and may be using the compiles', deleted };
  const deletions = decided.discard.map(({ build }) => deps.store.discard(build));
  await writeSweepState(deps.statePath, {
    v: 1,
    coreMlComponents: [...decided.installed],
    sweptAt: deps.now().toISOString(),
  });
  const all = Promise.all([deleted, ...deletions]).then(() => undefined);
  return decided.discard.length === 0
    ? { kind: 'unchanged', deleted: all }
    : { kind: 'swept', discarded: decided.discard, deleted: all };
}
