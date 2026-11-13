// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which of a runtime spec's models a hardware tier may load and which it downloads by default, and the
 * component ids that default install takes: the runtimes first (llama.cpp's, then any model's own server, MLX1),
 * then each model's weights and projector.
 * The supervisor installs from it (`ensureInstalled`). The download of everything a Mac needs (packages/jobs'
 * download set) reads the components manifest's `tiers` instead, which test/local-llm-manifest.test.ts holds to
 * this list.
 */
import { tierRank, type HardwareTier } from '../hardware/types';
import type { LocalRuntimeModel, LocalRuntimeSpec } from './types';

/** Whether a tier has the memory for these weights (the memory guard). */
export const fitsTier = (tier: HardwareTier) => (model: LocalRuntimeModel) =>
  tierRank(tier) >= tierRank(model.minTier);

/** Whether a tier downloads these weights by default: it fits them and doesn't get a bigger model instead. */
export const installsOn = (tier: HardwareTier) => (model: LocalRuntimeModel) =>
  fitsTier(tier)(model) && (!model.maxTier || tierRank(tier) <= tierRank(model.maxTier));

/** The runtime component that serves `model`: its own server's, else the spec's (llama.cpp). */
export const runtimeComponentOf = (spec: LocalRuntimeSpec, model: LocalRuntimeModel): string =>
  model.runtimeComponentId ?? spec.runtimeComponentId;

/** The component ids a tier installs for this runtime; none when no model suits it. */
export function componentsFor(spec: LocalRuntimeSpec, tier: HardwareTier): readonly string[] {
  const models = spec.models.filter(installsOn(tier));
  if (models.length === 0) return [];
  const runtimes = [...new Set(models.map((m) => runtimeComponentOf(spec, m)))].sort(
    (a, b) => Number(b === spec.runtimeComponentId) - Number(a === spec.runtimeComponentId),
  );
  const files = models.flatMap((m) => [
    m.componentId,
    ...(m.projectorComponentId ? [m.projectorComponentId] : []),
  ]);
  return [...runtimes, ...files];
}
