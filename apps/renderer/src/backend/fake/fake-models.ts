// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- fake backend data (product names, ids, people's requests), never UI copy */

/**
 * A fake of @taalcut/models' ModelProfiles and ModelClient for the renderer:
 * the same resolution rules (override → tier → retirement), the same commands,
 * and a `call(module)` that does what the next model call would do: resolve the
 * chain, use its primary and write one cloud-call row.
 */
import {
  defineCommand,
  MODEL_MODULE_IDS,
  newId,
  ok,
  type AnyCommand,
  type ModelModuleId,
  type TaalcutError,
  MODEL_COMMANDS,
  modelCommandPayloads,
  moduleOverrideSchema,
  type HardwareTier,
  type ModelChoice,
  type ModelOption,
  type ModelSettings,
  type ModuleOverride,
  type ModuleState,
  type RetirementNotice,
} from '@taalcut/core';
import { z } from 'zod';
import {
  BUILTIN_PROFILE_IDS,
  FAKE_CATALOG,
  findEntry,
  PROFILE_CHAINS,
  type FakeProfileId,
} from './fake-model-data';
import type { FakeUsage } from './fake-usage';
import { watched, type Watched } from './watch';

export interface FakeModelState {
  activeProfileId: FakeProfileId;
  overrides: Partial<Record<ModelModuleId, ModuleOverride>>;
}

export interface CallReceipt {
  readonly module: ModelModuleId;
  readonly provider: string;
  readonly model: string;
  readonly reasoning: string;
}

export interface FakeModels {
  readonly watch: Watched<ModelSettings>;
  options(module: ModelModuleId): ModelOption[];
  commands(): AnyCommand[];
  /** The next model call for a module: resolve, use the primary, log a cloud-call row. */
  call(module: ModelModuleId): CallReceipt | TaalcutError;
}

const TIER_RANK: Record<HardwareTier, number> = { minimum: 0, recommended: 1, high: 2 };
const REASONING_MODULES: readonly ModelModuleId[] = ['agent', 'vision'];
export const RECOMMENDED_PROFILE: FakeProfileId = 'balanced';
/** Commands the bus runs but people don't pick: the inverse of "Use recommended". */
export const RESTORE_COMMAND = 'models.restore';

const key = (c: Pick<ModelChoice, 'provider' | 'model'>) => `${c.provider}/${c.model}`;
const daysUntil = (today: string, iso: string) =>
  Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

function applyOverride(chain: readonly ModelChoice[], override?: ModuleOverride): ModelChoice[] {
  if (!override) return [...chain];
  const [profilePrimary, ...profileFallbacks] = chain;
  const base = override.primary ?? profilePrimary;
  const primary = base && override.reasoning ? { ...base, reasoning: override.reasoning } : base;
  const fallbacks = override.fallbacks ?? profileFallbacks;
  return primary ? [primary, ...fallbacks] : fallbacks;
}

export function createFakeModels(deps: {
  usage: FakeUsage;
  tier: HardwareTier;
  today: () => string;
  now: () => number;
  initial?: Partial<FakeModelState>;
  /** Cloud providers with a key or sign-in (fake accounts). Unset: nothing is marked 'not-configured'. */
  configured?: () => ReadonlySet<string>;
}): FakeModels {
  const state: FakeModelState = {
    activeProfileId: deps.initial?.activeProfileId ?? RECOMMENDED_PROFILE,
    overrides: { ...deps.initial?.overrides },
  };
  const retired = (iso: string | undefined) => iso !== undefined && deps.today() >= iso;

  function resolve(module: ModelModuleId): Pick<ModuleState, 'chain' | 'skipped'> {
    const chain: ModelChoice[] = [];
    const skipped: ModuleState['skipped'] = [];
    const add = (choice: ModelChoice) => {
      if (!chain.some((c) => key(c) === key(choice))) chain.push(choice);
    };
    for (const choice of applyOverride(
      PROFILE_CHAINS[state.activeProfileId][module],
      state.overrides[module],
    )) {
      const entry = findEntry(choice);
      if (entry?.minTier && TIER_RANK[deps.tier] < TIER_RANK[entry.minTier]) {
        skipped.push({ choice, reason: 'needs-higher-tier' });
      } else if (retired(entry?.retiresOn)) {
        const replacedBy = entry?.replacement && { ...entry.replacement, reasoning: choice.reasoning };
        skipped.push({ choice, reason: 'retired', ...(replacedBy ? { replacedBy } : {}) });
        if (replacedBy) add(replacedBy);
      } else add(choice);
    }
    return { chain, skipped };
  }

  function retirements(): RetirementNotice[] {
    const notices: RetirementNotice[] = [];
    for (const module of MODEL_MODULE_IDS) {
      const override = state.overrides[module];
      const places: [string, ModelChoice[]][] = [
        ['override', [...(override?.primary ? [override.primary] : []), ...(override?.fallbacks ?? [])]],
        [state.activeProfileId, PROFILE_CHAINS[state.activeProfileId][module]],
      ];
      for (const [where, choices] of places) {
        for (const choice of choices) {
          const entry = findEntry(choice);
          if (!entry?.retiresOn) continue;
          const daysLeft = daysUntil(deps.today(), entry.retiresOn);
          if (daysLeft > 30) continue;
          const replacement = entry.replacement;
          notices.push({ module, where, choice, retiresOn: entry.retiresOn, daysLeft, replacement });
        }
      }
    }
    return notices;
  }

  const settings = (): ModelSettings => ({
    activeProfileId: state.activeProfileId,
    recommendedProfileId: RECOMMENDED_PROFILE,
    tier: deps.tier,
    profiles: BUILTIN_PROFILE_IDS.map((id) => ({
      id,
      labelKey: `models.profile.${id}.label`,
      descriptionKey: `models.profile.${id}.description`,
      builtin: true,
    })),
    modules: MODEL_MODULE_IDS.map((module) => ({
      module,
      labelKey: `models.module.${module}.label`,
      descriptionKey: `models.module.${module}.description`,
      reasoning: REASONING_MODULES.includes(module),
      ...resolve(module),
      ...(state.overrides[module] ? { override: state.overrides[module] } : {}),
    })),
    retirements: retirements(),
  });
  const watch = watched(settings);

  /** Applies a change and returns the state before it, for the inverse. */
  const change = (apply: () => void): FakeModelState => {
    const before = { activeProfileId: state.activeProfileId, overrides: { ...state.overrides } };
    apply();
    watch.notify();
    return before;
  };
  const restoreInvocation = (before: FakeModelState) => ({ name: RESTORE_COMMAND, payload: before });

  const commands = (): AnyCommand[] => [
    defineCommand({
      name: MODEL_COMMANDS.setProfile,
      payload: modelCommandPayloads[MODEL_COMMANDS.setProfile].refine(
        (p) => (BUILTIN_PROFILE_IDS as readonly string[]).includes(p.profileId),
        { path: ['profileId'], message: 'Unknown profile.' },
      ),
      sideEffect: 'write',
      project: () => null,
      handle: ({ profileId }) => {
        const before = change(() => (state.activeProfileId = profileId as FakeProfileId));
        return ok({
          result: null,
          inverse: { name: MODEL_COMMANDS.setProfile, payload: { profileId: before.activeProfileId } },
        });
      },
    }),
    defineCommand({
      name: MODEL_COMMANDS.setModuleOverride,
      payload: modelCommandPayloads[MODEL_COMMANDS.setModuleOverride],
      sideEffect: 'write',
      project: () => null,
      handle: ({ module, override }) => {
        const before = change(() => (state.overrides = { ...state.overrides, [module]: override }));
        return ok({ result: null, inverse: restoreInvocation(before) });
      },
    }),
    defineCommand({
      name: MODEL_COMMANDS.clearModuleOverride,
      payload: modelCommandPayloads[MODEL_COMMANDS.clearModuleOverride],
      sideEffect: 'write',
      project: () => null,
      handle: ({ module }) => {
        const before = change(() => {
          const { [module]: _gone, ...rest } = state.overrides;
          state.overrides = rest;
        });
        return ok({ result: null, inverse: restoreInvocation(before) });
      },
    }),
    defineCommand({
      name: MODEL_COMMANDS.useRecommended,
      payload: modelCommandPayloads[MODEL_COMMANDS.useRecommended],
      sideEffect: 'write',
      project: () => null,
      handle: () => {
        const before = change(() => {
          state.activeProfileId = RECOMMENDED_PROFILE;
          state.overrides = {};
        });
        return ok({ result: null, inverse: restoreInvocation(before) });
      },
    }),
    defineCommand({
      name: RESTORE_COMMAND,
      payload: z.object({
        activeProfileId: z.enum(BUILTIN_PROFILE_IDS),
        overrides: z.partialRecord(z.enum(MODEL_MODULE_IDS), moduleOverrideSchema),
      }),
      sideEffect: 'write',
      // As in @taalcut/models: only undo and redo run it.
      internal: true,
      project: () => null,
      handle: (payload) => {
        const before = change(() => {
          state.activeProfileId = payload.activeProfileId;
          state.overrides = { ...payload.overrides };
        });
        return ok({ result: null, inverse: restoreInvocation(before) });
      },
    }),
  ];

  function options(module: ModelModuleId): ModelOption[] {
    const configured = deps.configured?.();
    const inProfiles = new Set(
      BUILTIN_PROFILE_IDS.flatMap((id) => PROFILE_CHAINS[id][module].map((choice) => key(choice))),
    );
    return FAKE_CATALOG.filter((e) => e.modules.includes(module)).map((e) => {
      const unavailable =
        e.minTier && TIER_RANK[deps.tier] < TIER_RANK[e.minTier]
          ? ('needs-higher-tier' as const)
          : retired(e.retiresOn)
            ? ('retired' as const)
            : e.maxTier && TIER_RANK[deps.tier] > TIER_RANK[e.maxTier]
              ? ('not-installed' as const)
              : !e.local && configured && !configured.has(e.provider)
                ? ('not-configured' as const)
                : undefined;
      return {
        provider: e.provider,
        model: e.model,
        name: e.name,
        local: e.local,
        reasoning: e.reasoning,
        ...(e.thinking && (module === 'agent' || module === 'vision') ? { thinking: [...e.thinking] } : {}),
        ...(inProfiles.has(key(e)) ? { inProfile: true } : {}),
        ...(e.noteKey ? { noteKey: e.noteKey } : {}),
        ...(e.retiresOn ? { retiresOn: e.retiresOn } : {}),
        ...(unavailable ? { unavailable } : {}),
      };
    });
  }

  function call(module: ModelModuleId): CallReceipt | TaalcutError {
    const primary = resolve(module).chain[0];
    if (!primary) {
      return {
        code: 'models.no_model_for_module',
        messageKey: 'errors.models.no_model_for_module',
        params: { module },
        retryable: false,
      };
    }
    const entry = findEntry(primary);
    const inputTokens = 1200 + Math.round(Math.random() * 800);
    const outputTokens = 200 + Math.round(Math.random() * 300);
    const costUsd = entry?.local
      ? 0
      : (inputTokens * (entry?.usdPerMTokIn ?? 0) + outputTokens * (entry?.usdPerMTokOut ?? 0)) / 1e6;
    const reasoning = primary.reasoning ?? 'off';
    deps.usage.record({
      id: newId<'CloudCall'>(),
      module,
      provider: primary.provider,
      model: primary.model,
      reasoning,
      local: entry?.local ?? false,
      startedAt: deps.now(),
      latencyMs: 400 + Math.round(Math.random() * 1600),
      bytesSent: inputTokens * 4,
      bytesReceived: outputTokens * 4,
      inputTokens,
      outputTokens,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      costUsd,
      outcome: 'ok',
      attempt: 1,
    });
    return { module, provider: primary.provider, model: primary.model, reasoning };
  }

  return { watch, options, commands, call };
}
