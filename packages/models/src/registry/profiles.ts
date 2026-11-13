// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The profiles service (R27, P1-F2). It keeps the validated state in memory
 * and resolves a module's chain on every call, so switching profile or
 * overriding a module changes the next call with no restart. Changes are saved
 * first and applied after the save succeeds, so memory never runs ahead of the
 * store.
 */
import {
  err,
  ok,
  type AsyncResult,
  type CommandContext,
  type ModelProfileStore,
  type Result,
} from '@taalcut/core';
import type { ModelSelector, ResolvedChain } from '../client/model-client';
import {
  ModelRetired,
  NoModelForModule,
  ProfileInvalid,
  ProfileNotFound,
  ProfileStoreFailed,
} from '../errors';
import type { ComputeBackend } from '../hardware/compute';
import type { HardwareAssessment } from '../hardware/tiers';
import type { HardwareTier } from '../hardware/types';
import type { ModuleId } from '../modules';
import { BUILTIN_PROFILES } from './builtin-profiles';
import { createCatalog, daysUntil, isRetired, type Catalog } from './catalog';
import {
  findRetirements,
  migrateRetiring,
  type MigrateOptions,
  type RetirementNotice,
  type WatchOptions,
} from './deprecation';
import {
  defaultProfileState,
  ModelProfileSchema,
  ModuleOverrideSchema,
  ProfileStateSchema,
  type MigrationRecord,
  type ModelProfile,
  type ModuleOverride,
  type ProfileState,
} from './profile-schema';
import { resolveModule, type EffectiveModule } from './resolve';

export type LoadOutcome = 'loaded' | 'first-run' | 'reset-invalid';

/** The user's choices, without custom profiles and migration history. */
export type ProfileSelection = Pick<ProfileState, 'activeProfileId' | 'overrides'>;

export interface ModelProfiles extends ModelSelector {
  /**
   * Reads the store. Invalid saved state is replaced by defaults (and reported), never thrown. Saved choices of
   * models retiring within a week, or gone (pi-ai dropped them, or a newer generation replaced them), move to
   * their replacements and are saved; retirements() reports each move for the rest of the session (UX3-AGT).
   */
  load(): AsyncResult<LoadOutcome>;
  state(): ProfileState;
  profiles(): readonly ModelProfile[];
  activeProfile(): ModelProfile;
  /*
   * The setters take the command context when a command makes the change: the store then commits
   * the save with that command's audit row, so a command that fails to record changes nothing.
   */
  setActiveProfile(id: string, context?: CommandContext): AsyncResult<void>;
  setModuleOverride(module: ModuleId, override: ModuleOverride, context?: CommandContext): AsyncResult<void>;
  clearModuleOverride(module: ModuleId, context?: CommandContext): AsyncResult<void>;
  /** Sets the active profile and every override at once (Settings' "use recommended", and undo). */
  setSelection(selection: ProfileSelection, context?: CommandContext): AsyncResult<void>;
  saveCustomProfile(profile: ModelProfile): AsyncResult<void>;
  /** The hardware tier decides which local models a chain may use (G14). */
  setTier(tier: HardwareTier): void;
  tier(): HardwareTier;
  /** Tier plus compute backends from the probe: local models that would run on the CPU go last (ADR 0002). */
  setHardware(assessment: Pick<HardwareAssessment, 'tier' | 'compute'>): void;
  effective(module: ModuleId): EffectiveModule;
  retirements(options?: WatchOptions): readonly RetirementNotice[];
  /** Moves the user's retiring choices to their replacements and saves. */
  migrateRetiring(options?: MigrateOptions): AsyncResult<readonly MigrationRecord[]>;
  /** Called after every applied change. Returns an unsubscribe function. */
  onChange(listener: (state: ProfileState) => void): () => void;
}

export interface ModelProfilesDeps {
  readonly store: ModelProfileStore;
  readonly catalog?: Catalog;
  /** Today's date as 'YYYY-MM-DD'. Injected so the deprecation watcher is testable. */
  readonly today?: () => string;
  /** Until the hardware probe reports, assume the floor. */
  readonly tier?: HardwareTier;
  /** The machine's compute backends; until known, local choices keep their profile order. */
  readonly backends?: readonly ComputeBackend[];
  /** Defaults to the four built-ins. */
  readonly builtins?: readonly ModelProfile[];
}

const utcToday = (): string => new Date().toISOString().slice(0, 10);

export function createModelProfiles(deps: ModelProfilesDeps): ModelProfiles {
  const catalog = deps.catalog ?? createCatalog();
  const builtins = deps.builtins ?? BUILTIN_PROFILES;
  const today = deps.today ?? utcToday;
  let tier: HardwareTier = deps.tier ?? 'minimum';
  let backends: readonly ComputeBackend[] | undefined = deps.backends;
  let forcedCpu = false;
  let state: ProfileState = defaultProfileState();
  /** What load() moved: said once, in this session's retirement notices. */
  let moved: readonly MigrationRecord[] = [];
  const listeners = new Set<(state: ProfileState) => void>();

  const allProfiles = (s: ProfileState): ModelProfile[] => [
    ...builtins,
    ...s.customProfiles.filter((c) => !builtins.some((b) => b.id === c.id)),
  ];
  const findProfile = (s: ProfileState, id: string) => allProfiles(s).find((p) => p.id === id);
  const active = (): ModelProfile => findProfile(state, state.activeProfileId) ?? builtins[0]!;

  /**
   * Validates, saves, then applies. With a command's context the store stages the save until the
   * audit row commits; if that fails, the bus runs the command's inverse, which puts memory back.
   */
  async function commit(next: ProfileState, context?: CommandContext): AsyncResult<void> {
    const parsed = ProfileStateSchema.safeParse(next);
    if (!parsed.success) return err(ProfileInvalid(undefined, { detail: parsed.error.message }));
    if (!findProfile(parsed.data, parsed.data.activeProfileId)) {
      return err(ProfileNotFound({ profile: parsed.data.activeProfileId }));
    }
    const saved = await deps.store
      .save(parsed.data, context)
      .catch((cause: unknown) => err(ProfileStoreFailed(undefined, { detail: String(cause) })));
    if (!saved.ok) return saved;
    state = parsed.data;
    for (const listener of listeners) listener(state);
    return ok(undefined);
  }

  const effective = (module: ModuleId): EffectiveModule =>
    resolveModule(module, active().modules[module], state.overrides[module], {
      catalog,
      tier,
      today: today(),
      ...(backends ? { backends } : {}),
      ...(forcedCpu ? { forcedCpu } : {}),
    });

  return {
    async load() {
      const loaded = await deps.store
        .load()
        .catch((cause: unknown) => err(ProfileStoreFailed(undefined, { detail: String(cause) })));
      if (!loaded.ok) return loaded;
      if (loaded.value === undefined) return ok('first-run');
      const parsed = ProfileStateSchema.safeParse(loaded.value);
      if (!parsed.success || !findProfile(parsed.data, parsed.data.activeProfileId)) {
        state = defaultProfileState();
        return ok('reset-invalid');
      }
      state = parsed.data;
      const migrated = migrateRetiring(state, catalog, today());
      if (migrated.migrations.length > 0) {
        const saved = await commit(migrated.state);
        if (saved.ok) moved = migrated.migrations;
        else console.warn(`models: couldn't move retired model choices: ${saved.error.code}`);
      }
      return ok('loaded');
    },
    state: () => state,
    profiles: () => allProfiles(state),
    activeProfile: active,
    setActiveProfile(id, context) {
      if (!findProfile(state, id)) return Promise.resolve(err(ProfileNotFound({ profile: id })));
      return commit({ ...state, activeProfileId: id }, context);
    },
    setModuleOverride(module, override, context) {
      const parsed = ModuleOverrideSchema.safeParse(override);
      if (!parsed.success)
        return Promise.resolve(err(ProfileInvalid({ field: module }, { detail: parsed.error.message })));
      // Choosing a model that is already gone would only fall through to the next one; say so instead.
      const primary = parsed.data.primary;
      const entry = primary ? catalog.find(primary) : undefined;
      if (primary && entry?.retiresOn && isRetired(entry, today())) {
        return Promise.resolve(
          err(ModelRetired({ provider: primary.provider, model: primary.model, retiredOn: entry.retiresOn })),
        );
      }
      return commit({ ...state, overrides: { ...state.overrides, [module]: parsed.data } }, context);
    },
    clearModuleOverride(module, context) {
      const { [module]: _removed, ...rest } = state.overrides;
      return commit({ ...state, overrides: rest }, context);
    },
    setSelection(selection, context) {
      if (!findProfile(state, selection.activeProfileId))
        return Promise.resolve(err(ProfileNotFound({ profile: selection.activeProfileId })));
      return commit(
        { ...state, activeProfileId: selection.activeProfileId, overrides: selection.overrides },
        context,
      );
    },
    saveCustomProfile(profile) {
      const parsed = ModelProfileSchema.safeParse(profile);
      if (!parsed.success)
        return Promise.resolve(err(ProfileInvalid({ field: 'profile' }, { detail: parsed.error.message })));
      if (builtins.some((b) => b.id === profile.id)) {
        return Promise.resolve(
          err(ProfileInvalid({ field: 'id' }, { detail: 'Built-in profiles cannot be replaced.' })),
        );
      }
      const others = state.customProfiles.filter((p) => p.id !== profile.id);
      return commit({ ...state, customProfiles: [...others, parsed.data] });
    },
    setTier(next) {
      tier = next;
      for (const listener of listeners) listener(state);
    },
    tier: () => tier,
    setHardware(assessment) {
      tier = assessment.tier;
      backends = assessment.compute.backends;
      forcedCpu = assessment.compute.forcedCpu ?? false;
      for (const listener of listeners) listener(state);
    },
    effective,
    resolve(module): Result<ResolvedChain> {
      const resolved = effective(module);
      if (resolved.chain.length === 0) return err(NoModelForModule({ module }));
      return ok({ module, choices: resolved.chain });
    },
    retirements: (options) => [
      ...findRetirements(state, allProfiles(state), catalog, today(), options),
      ...moved.map(({ module, where, from, to, retiresOn }) => ({
        module,
        where,
        choice: from,
        retiresOn,
        daysLeft: daysUntil(today(), retiresOn),
        replacement: to,
      })),
    ],
    async migrateRetiring(options) {
      const { state: next, migrations } = migrateRetiring(state, catalog, today(), options);
      if (migrations.length === 0) return ok([]);
      const saved = await commit(next);
      return saved.ok ? ok(migrations) : saved;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
