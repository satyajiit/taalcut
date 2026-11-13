// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The deprecation watcher (PRD 8.4): finds model choices whose retirement date
 * is near or past, and migrates the user's own choices (overrides and custom
 * profiles) to the replacement before the model dies. Built-in profiles are
 * code and change in releases; at call time the resolver already swaps a
 * retired built-in choice for its replacement.
 */
import { MODULE_IDS, type ModelChoice, type ModuleId } from '../modules';
import { daysUntil, type Catalog } from './catalog';
import type { MigrationRecord, ModelProfile, ModuleOverride, ProfileState } from './profile-schema';

export interface RetirementNotice {
  readonly module: ModuleId;
  /** 'override', or the id of the profile that holds the choice. */
  readonly where: string;
  readonly choice: ModelChoice;
  readonly retiresOn: string;
  /** Negative once retired. */
  readonly daysLeft: number;
  readonly replacement?: ModelChoice;
}

export interface WatchOptions {
  /** Report models retiring within this many days. Default 30. */
  readonly horizonDays?: number;
}

function* choicesIn(state: ProfileState, profiles: readonly ModelProfile[]) {
  for (const module of MODULE_IDS) {
    const override = state.overrides[module];
    for (const choice of [...(override?.primary ? [override.primary] : []), ...(override?.fallbacks ?? [])]) {
      yield { module, where: 'override', choice };
    }
    for (const profile of [...profiles, ...state.customProfiles]) {
      for (const choice of profile.modules[module].chain) yield { module, where: profile.id, choice };
    }
  }
}

export function findRetirements(
  state: ProfileState,
  profiles: readonly ModelProfile[],
  catalog: Catalog,
  today: string,
  options: WatchOptions = {},
): RetirementNotice[] {
  const horizon = options.horizonDays ?? 30;
  const notices: RetirementNotice[] = [];
  for (const { module, where, choice } of choicesIn(state, profiles)) {
    const entry = catalog.find(choice);
    if (!entry?.retiresOn) continue;
    const daysLeft = daysUntil(today, entry.retiresOn);
    if (daysLeft > horizon) continue;
    notices.push({
      module,
      where,
      choice,
      retiresOn: entry.retiresOn,
      daysLeft,
      ...(entry.replacement ? { replacement: { ...entry.replacement, ...reasoningOf(choice) } } : {}),
    });
  }
  return notices;
}

export interface MigrateOptions {
  /** Migrate choices retiring within this many days. Default 7. */
  readonly leadDays?: number;
}

/** Rewrites the user's retiring choices to their replacements. Returns the new state and what changed. */
export function migrateRetiring(
  state: ProfileState,
  catalog: Catalog,
  today: string,
  options: MigrateOptions = {},
): { state: ProfileState; migrations: MigrationRecord[] } {
  const lead = options.leadDays ?? 7;
  const migrations: MigrationRecord[] = [];
  const swap = (module: ModuleId, where: string, choice: ModelChoice): ModelChoice => {
    const entry = catalog.find(choice);
    if (!entry?.retiresOn || !entry.replacement || daysUntil(today, entry.retiresOn) > lead) return choice;
    const to = { ...entry.replacement, ...reasoningOf(choice) };
    migrations.push({ on: today, module, where, from: choice, to, retiresOn: entry.retiresOn });
    return to;
  };

  const overrides: Partial<Record<ModuleId, ModuleOverride>> = {};
  for (const module of MODULE_IDS) {
    const override = state.overrides[module];
    if (!override) continue;
    overrides[module] = {
      ...override,
      ...(override.primary ? { primary: swap(module, 'override', override.primary) } : {}),
      ...(override.fallbacks
        ? { fallbacks: override.fallbacks.map((c) => swap(module, 'override', c)) }
        : {}),
    };
  }
  const customProfiles = state.customProfiles.map((profile) => {
    const modules = { ...profile.modules };
    for (const module of MODULE_IDS) {
      modules[module] = { chain: profile.modules[module].chain.map((c) => swap(module, profile.id, c)) };
    }
    return { ...profile, modules };
  });
  if (migrations.length === 0) return { state, migrations };
  return {
    state: { ...state, overrides, customProfiles, migrations: [...state.migrations, ...migrations] },
    migrations,
  };
}

function reasoningOf(choice: ModelChoice): Pick<ModelChoice, 'reasoning'> {
  return choice.reasoning ? { reasoning: choice.reasoning } : {};
}
