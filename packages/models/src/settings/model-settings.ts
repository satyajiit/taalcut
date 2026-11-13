// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The service behind Settings → Models (appContract.models): reads over the
 * live ModelProfiles, plus the bus commands that change them. It runs in the
 * process that owns the profiles and the ModelClient that uses them as its
 * selector, so a change is in effect for the very next model call: nothing
 * caches a chain and nothing restarts.
 */
import type { AnyCommand, ModelOption, ModelSettings, ModuleState } from '@taalcut/core';
import type { ComputeBackend } from '../hardware/compute';
import type { HardwareAssessment } from '../hardware/tiers';
import { MODULE_IDS, MODULES, type ModuleId } from '../modules';
import { BUILTIN_PROFILE_IDS, DEFAULT_PROFILE_ID } from '../registry/profile-schema';
import { createCatalog, type Catalog } from '../registry/catalog';
import type { ModelProfiles } from '../registry/profiles';
import type { ModelRuntime } from '../runtime/runtime';
import { createModelCommands } from './model-commands';
import { moduleOptions } from './model-options';
import { watched } from './watch';

export interface ModelSettingsServiceDeps {
  readonly profiles: ModelProfiles;
  /** The runtime whose models the picker lists (the same one the ModelClient calls). */
  readonly runtime: ModelRuntime;
  readonly catalog?: Catalog;
  /**
   * Cloud providers with a key or sign-in, e.g. from the accounts state. Unset:
   * nothing is marked 'not-configured'.
   */
  readonly configuredProviders?: () => Promise<ReadonlySet<string>>;
  /**
   * On-device model ids whose weights are downloaded (the local runtime's
   * status). Unset: nothing is marked 'not-installed'.
   */
  readonly installedLocalModels?: () => ReadonlySet<string> | undefined;
  /** 'YYYY-MM-DD'. Default: today in UTC. */
  readonly today?: () => string;
}

export interface ModelSettingsService {
  settings(): ModelSettings;
  /** The current settings first, then after every change, until the reader stops or `signal` aborts. */
  changed(signal?: AbortSignal): AsyncGenerator<ModelSettings, void, undefined>;
  /** What can be picked for one module, best first. */
  options(input: { readonly module: ModuleId }): Promise<readonly ModelOption[]>;
  /** The probe's result: tier, backends and the recommended profile. Pushes a change. */
  setHardware(assessment: Pick<HardwareAssessment, 'tier' | 'compute' | 'defaultProfileId'>): void;
  /** models.setProfile, setModuleOverride, clearModuleOverride, useRecommended and the internal models.restore. */
  readonly commands: readonly AnyCommand[];
  /** Stops listening to the profiles. */
  dispose(): void;
}

const utcToday = (): string => new Date().toISOString().slice(0, 10);
const RETIREMENT_HORIZON_DAYS = 30;

export function createModelSettingsService(deps: ModelSettingsServiceDeps): ModelSettingsService {
  const { profiles } = deps;
  const catalog = deps.catalog ?? createCatalog();
  const today = deps.today ?? utcToday;
  let recommendedProfileId: string = DEFAULT_PROFILE_ID;
  let backends: readonly ComputeBackend[] | undefined;
  let forcedCpu = false;

  const moduleState = (module: ModuleId): ModuleState => {
    const effective = profiles.effective(module);
    const override = profiles.state().overrides[module];
    return {
      module,
      labelKey: MODULES[module].labelKey,
      descriptionKey: MODULES[module].descriptionKey,
      reasoning: MODULES[module].kinds.includes('chat'),
      chain: [...effective.chain],
      skipped: [...effective.skipped],
      ...(override ? { override } : {}),
    };
  };

  const settings = (): ModelSettings => {
    const state = profiles.state();
    return {
      activeProfileId: state.activeProfileId,
      recommendedProfileId,
      tier: profiles.tier(),
      profiles: profiles.profiles().map((p) => ({
        id: p.id,
        labelKey: p.labelKey,
        descriptionKey: p.descriptionKey,
        builtin: (BUILTIN_PROFILE_IDS as readonly string[]).includes(p.id),
      })),
      modules: MODULE_IDS.map(moduleState),
      // The active profile and the user's overrides; other profiles' retirements aren't in use.
      retirements: profiles
        .retirements({ horizonDays: RETIREMENT_HORIZON_DAYS })
        .filter((n) => n.where === 'override' || n.where === state.activeProfileId),
    };
  };

  const watch = watched(settings);
  const unsubscribe = profiles.onChange(() => watch.notify());

  return {
    settings,
    changed: (signal) => watch.stream(signal),
    async options({ module }) {
      const configured = deps.configuredProviders ? await deps.configuredProviders() : undefined;
      const installed = deps.installedLocalModels?.();
      return moduleOptions(module, {
        runtime: deps.runtime,
        catalog,
        profiles: profiles.profiles(),
        tier: profiles.tier(),
        ...(backends ? { backends } : {}),
        ...(forcedCpu ? { forcedCpu } : {}),
        today: today(),
        ...(configured ? { configured } : {}),
        ...(installed ? { installed } : {}),
      });
    },
    setHardware(assessment) {
      recommendedProfileId = assessment.defaultProfileId;
      backends = assessment.compute.backends;
      forcedCpu = assessment.compute.forcedCpu ?? false;
      // Notifies through onChange.
      profiles.setHardware(assessment);
    },
    commands: createModelCommands({ profiles, recommendedProfileId: () => recommendedProfileId }),
    dispose: unsubscribe,
  };
}
