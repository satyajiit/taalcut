// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Pure helpers over a validated manifest: which artifact fits this machine, which
 * member of a variant group runs here, what a hardware tier installs by default,
 * and in which order (dependencies first).
 */
import { err, ok, type Result } from '@taalcut/core';
import { ComponentUnknown, PlatformUnsupported } from './errors';
import type { ComponentArtifact, ComponentEntry, ComponentManifest, HardwareTier } from './manifest';

/** This process's platform key, e.g. 'darwin-arm64'. */
export function currentPlatform(): string {
  return `${process.platform}-${process.arch}`;
}

/** The artifact built for `platform`, else the platform-independent one. */
export function selectArtifact(component: ComponentEntry, platform: string): ComponentArtifact | undefined {
  return (
    component.artifacts.find((a) => a.platform === platform) ??
    component.artifacts.find((a) => a.platform === 'any')
  );
}

export function findComponent(manifest: ComponentManifest, id: string): ComponentEntry | undefined {
  return manifest.components.find((c) => c.id === id);
}

/**
 * The components needed to install `ids`, dependencies first, each once. Fails
 * on an unknown id or when any of them has no artifact for `platform`.
 */
export function installOrder(
  manifest: ComponentManifest,
  ids: readonly string[],
  platform: string,
): Result<ComponentEntry[]> {
  const order: ComponentEntry[] = [];
  const seen = new Set<string>();
  // The manifest schema rejects cycles, so plain depth-first recursion terminates.
  const visit = (id: string): Result<void> => {
    if (seen.has(id)) return ok(undefined);
    const component = findComponent(manifest, id);
    if (!component) return err(ComponentUnknown({ component: id }));
    if (!selectArtifact(component, platform)) return err(PlatformUnsupported({ component: id, platform }));
    seen.add(id);
    for (const dep of component.dependencies) {
      const result = visit(dep);
      if (!result.ok) return result;
    }
    order.push(component);
    return ok(undefined);
  };
  for (const id of ids) {
    const result = visit(id);
    if (!result.ok) return result;
  }
  return ok(order);
}

/**
 * What a hardware tier installs by default on this platform, with dependencies,
 * in install order. Components that have no artifact for the platform are
 * skipped rather than failing the whole tier.
 */
export function componentsForTier(
  manifest: ComponentManifest,
  tier: HardwareTier,
  platform: string,
): ComponentEntry[] {
  const wanted = manifest.components
    .filter((c) => c.tiers.includes(tier))
    .filter((c) => installOrder(manifest, [c.id], platform).ok)
    .map((c) => c.id);
  const order = installOrder(manifest, wanted, platform);
  return order.ok ? order.value : [];
}

/**
 * The member of `base`'s variant group that runs here: the first of its variants (most preferred first) that has an
 * artifact for `platform` and `fits`, else the base itself if it does, else undefined. A base without variants is
 * its own group.
 */
export function chooseVariant(
  manifest: ComponentManifest,
  base: ComponentEntry,
  platform: string,
  fits: (component: ComponentEntry) => boolean,
): ComponentEntry | undefined {
  const group = [...(base.variants ?? []).flatMap((id) => findComponent(manifest, id) ?? []), base];
  return group.find((c) => selectArtifact(c, platform) !== undefined && fits(c));
}

/**
 * What `tier` picks on this machine, before dependencies: each component the tier lists, as the member of its
 * variant group that runs here (a CUDA build over the CPU one). Variants only stand in for the tier's picks;
 * dependencies always name the component they need, so a model's runtime is installed whatever else is.
 */
export function tierPicks(
  manifest: ComponentManifest,
  tier: HardwareTier,
  platform: string,
  fits: (component: ComponentEntry) => boolean,
): ComponentEntry[] {
  const picks = manifest.components
    .filter((c) => c.tiers.includes(tier))
    .flatMap((c) => chooseVariant(manifest, c, platform, fits) ?? []);
  return [...new Set(picks)];
}

/** Components in the manifest that list `id` as a direct dependency. */
export function dependentsOf(manifest: ComponentManifest, id: string): ComponentEntry[] {
  return manifest.components.filter((c) => c.dependencies.includes(id));
}

/**
 * The idempotency key for "install this component" as a job (P1-E1): the same
 * id, version and file always map to the same key, so a resumed or repeated
 * job is recognised as the same action.
 */
export function installIdempotencyKey(component: ComponentEntry, artifact: ComponentArtifact): string {
  return `components.install:${component.id}@${component.version}#${artifact.sha256}`;
}
