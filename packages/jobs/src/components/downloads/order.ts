// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What this Mac needs, and the order the download fetches it in (UX2-DOWNLOADER).
 *
 * Order, for the best wait: what a caller asked for first (a clip's models) and what it needs go to the front. Then
 * the largest component starts at once in a lane of its own: it is the long pole (the writing model is 2.6 GB of
 * a ~4.5 GB set), and left to the end it would download alone while the other lanes sat idle. The rest follow
 * smallest first, so the most components land soonest: the speech, shots, text and search models a clip's
 * indexing waits for are in within minutes, while the big one is still on its way. A component never starts
 * before what it depends on is installed (the scheduler checks), so this order only says who goes next.
 */
import { err, ok, type Result } from '@taalcut/core';
import type { ComponentEntry, ComponentManifest } from '../manifest';
import { installOrder, selectArtifact } from '../selection';

/**
 * The components `wanted` (a tier's picks) need on `platform`, with their dependencies, in install order. A pick
 * with no artifact for this platform is left out; an unknown id is an error.
 */
export function neededComponents(
  manifest: ComponentManifest,
  wanted: readonly string[],
  platform: string,
): Result<ComponentEntry[]> {
  const here = wanted.filter((id) => {
    const component = manifest.components.find((c) => c.id === id);
    return component === undefined || selectArtifact(component, platform) !== undefined;
  });
  const order = installOrder(manifest, here, platform);
  return order.ok ? ok(order.value) : err(order.error);
}

/** The ids `first` names and everything they depend on, dependencies first, within `needed`. */
function withDependencies(needed: readonly ComponentEntry[], first: readonly string[]): string[] {
  const byId = new Map(needed.map((c) => [c.id, c]));
  const out: string[] = [];
  const visit = (id: string) => {
    const component = byId.get(id);
    if (!component || out.includes(id)) return;
    for (const dep of component.dependencies) visit(dep);
    out.push(id);
  };
  for (const id of first) visit(id);
  return out;
}

/** The order the download starts `needed` in: `first` and its dependencies, the largest, then smallest first. */
export function downloadOrder(
  needed: readonly ComponentEntry[],
  sizeOf: (id: string) => number,
  first: readonly string[] = [],
): string[] {
  const front = withDependencies(needed, first);
  const rest = needed.map((c) => c.id).filter((id) => !front.includes(id));
  if (rest.length === 0) return front;
  const largest = rest.reduce((big, id) => (sizeOf(id) > sizeOf(big) ? id : big));
  const index = (id: string) => rest.indexOf(id);
  const others = rest
    .filter((id) => id !== largest)
    .sort((a, b) => sizeOf(a) - sizeOf(b) || index(a) - index(b));
  return [...front, largest, ...others];
}

/** Every component `id` depends on, directly or through another, within the manifest. */
export function dependenciesOf(manifest: ComponentManifest, id: string): string[] {
  const out: string[] = [];
  const visit = (each: string) => {
    for (const dep of manifest.components.find((c) => c.id === each)?.dependencies ?? []) {
      if (out.includes(dep)) continue;
      out.push(dep);
      visit(dep);
    }
  };
  visit(id);
  return out;
}
