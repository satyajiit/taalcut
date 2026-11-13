// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How well each module works under the current settings (P3-B10, G27): `full`, `lowerQuality` ("Lower
 * quality on this Mac") or `unavailable` ("Needs internet"), for Settings → Privacy, onboarding's local-only
 * path and the cards. Worked out from the same chain the ModelClient tries and the privacy overview shows,
 * so the labels and "what leaves this device" can't disagree:
 *
 * - `unavailable`: nothing in the chain can run (Local only took every cloud model away, or none is set).
 * - `lowerQuality`: what runs first is a model on this Mac where the reference profile (the active one when
 *   it uses the cloud, else the default) would start with a cloud model.
 * - `full` otherwise. The router, embeddings and speech are at parity on this Mac: the router only saves
 *   tokens, embeddings always run here, and on-device speech (Parakeet, Whisper for Hindi) is the v1 baseline.
 */
import type { ModuleQuality } from '@taalcut/core';
import type { HardwareTier } from '../hardware/types';
import { MODULE_IDS, type ModelChoice, type ModuleId } from '../modules';
import { createCatalog, type Catalog } from '../registry/catalog';
import { DEFAULT_PROFILE_ID, type ModelProfile } from '../registry/profile-schema';
import { resolveModule, type EffectiveModule } from '../registry/resolve';
import type { ModelRuntime } from '../runtime/runtime';

/** Modules whose on-device models are as good as their cloud ones for what Taalcut asks of them. */
export const LOCAL_PARITY_MODULES: ReadonlySet<ModuleId> = new Set(['router', 'embeddings', 'speech']);

export const QUALITY_LABEL_KEYS = {
  full: 'models.quality.full',
  lowerQuality: 'models.quality.lowerQuality',
  needsInternet: 'models.quality.needsInternet',
  notConfigured: 'models.quality.notConfigured',
} as const;

export interface ModuleQualityDeps {
  /** The active profile's resolved chains for this Mac (ModelProfiles). */
  readonly selector: {
    effective(module: ModuleId): Pick<EffectiveModule, 'chain'>;
    activeProfile(): ModelProfile;
    profiles(): readonly ModelProfile[];
  };
  readonly runtime: Pick<ModelRuntime, 'isLocalProvider'>;
  /** Local only is on: only models on this Mac count, as the ModelClient does it. */
  readonly localOnly: boolean;
  /** This Mac's tier: the reference profile's local models are skipped above it, as the active one's are. */
  readonly tier: HardwareTier;
  readonly catalog?: Catalog;
  /** 'YYYY-MM-DD', for retired models in the reference chain. */
  readonly today?: () => string;
}

const utcToday = (): string => new Date().toISOString().slice(0, 10);

export function moduleQuality(deps: ModuleQualityDeps, module: ModuleId): ModuleQuality {
  const catalog = deps.catalog ?? createCatalog();
  const isLocal = (choice: ModelChoice) =>
    deps.runtime.isLocalProvider(choice.provider) || catalog.find(choice)?.local === true;
  const chain = deps.selector.effective(module).chain;
  const runs = deps.localOnly ? chain.filter(isLocal) : chain;
  const first = runs[0];
  if (!first) {
    const removed = deps.localOnly && chain.length > 0;
    return {
      module,
      quality: 'unavailable',
      labelKey: removed ? QUALITY_LABEL_KEYS.needsInternet : QUALITY_LABEL_KEYS.notConfigured,
    };
  }
  if (LOCAL_PARITY_MODULES.has(module) || !isLocal(first)) return full(module);
  const reference = referenceFirst(deps, catalog, module);
  return reference && !isLocal(reference)
    ? { module, quality: 'lowerQuality', labelKey: QUALITY_LABEL_KEYS.lowerQuality }
    : full(module);
}

/** Every module, in MODULE_IDS order (the privacy overview's `quality`). */
export function moduleQualities(deps: ModuleQualityDeps): ModuleQuality[] {
  const catalog = deps.catalog ?? createCatalog();
  return MODULE_IDS.map((module) => moduleQuality({ ...deps, catalog }, module));
}

const full = (module: ModuleId): ModuleQuality => ({
  module,
  quality: 'full',
  labelKey: QUALITY_LABEL_KEYS.full,
});

/**
 * What the module would start with without Local only's limits: the active profile when it uses the cloud
 * anywhere, else the default profile (the Local only profile itself is no yardstick), resolved for this tier.
 */
function referenceFirst(
  deps: ModuleQualityDeps,
  catalog: Catalog,
  module: ModuleId,
): ModelChoice | undefined {
  const active = deps.selector.activeProfile();
  const usesCloud = (profile: ModelProfile) =>
    Object.values(profile.modules).some((setting) =>
      setting.chain.some(
        (choice) => !deps.runtime.isLocalProvider(choice.provider) && catalog.find(choice)?.local !== true,
      ),
    );
  const profile = usesCloud(active)
    ? active
    : (deps.selector.profiles().find((p) => p.id === DEFAULT_PROFILE_ID) ?? active);
  const setting = profile.modules[module];
  const resolved = resolveModule(module, setting, undefined, {
    catalog,
    tier: deps.tier,
    today: (deps.today ?? utcToday)(),
  });
  return resolved.chain[0];
}
