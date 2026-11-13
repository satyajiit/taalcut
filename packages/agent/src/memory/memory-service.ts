// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.memory's service (LRN1-MEM): Settings → Memory's list and the plain status line. Where the prompts
 * go comes from the same module plans Settings → Privacy shows (`PrivacyModulePlan`, from the models package),
 * over the modules a run's prompts use (the agent's and its skills'), so the two pages can't disagree.
 */
import {
  LOCAL_ONLY_SETTING,
  MEMORY_CLOUD_PROMPTS_SETTING,
  ok,
  type AsyncResult,
  type MemoryList,
  type MemoryListInput,
  type MemoryPromptUse,
  type MemoryScopeKind,
  type MemoryService,
  type MemoryStatus,
  type MemoryStore,
  type ModelModuleId,
  type SettingsStore,
} from '@taalcut/core';
import type { PrivacyModulePlan } from '../privacy-service';

export interface MemoryServiceDeps {
  readonly store: Pick<MemoryStore, 'list' | 'count'>;
  readonly settings: Pick<SettingsStore, 'get'>;
  /** Each module's plan with Local only as given (privacy's `modules`). */
  readonly modules: (localOnly: boolean) => readonly PrivacyModulePlan[];
  /** The modules a run's prompts go to: 'agent' and each skill's. */
  readonly promptModules: () => readonly ModelModuleId[];
}

export interface PromptPlan {
  readonly runsOn: MemoryStatus['runsOn'];
  readonly providers: readonly string[];
}

/** Where the prompt modules run, together: every one here, every one in the cloud, a mix, or none at all. */
export function promptPlan(
  plans: readonly PrivacyModulePlan[],
  modules: readonly ModelModuleId[],
): PromptPlan {
  const used = plans.filter((plan) => modules.includes(plan.module) && plan.runsOn !== 'off');
  const providers = [...new Set(used.flatMap((plan) => plan.providers))];
  if (used.length === 0) return { runsOn: 'off', providers };
  const all = (runsOn: PrivacyModulePlan['runsOn']) => used.every((plan) => plan.runsOn === runsOn);
  return { runsOn: all('this-mac') ? 'this-mac' : all('cloud') ? 'cloud' : 'both', providers };
}

/** The same decision recall makes when a run starts (recall.ts, memoryUse). */
export function promptUse(
  localOnly: boolean,
  runsOn: PromptPlan['runsOn'],
  cloudPrompts: boolean,
): MemoryPromptUse {
  if (localOnly || runsOn === 'this-mac' || runsOn === 'off') return 'on-device';
  return cloudPrompts ? 'cloud' : 'withheld';
}

export function createMemoryService(deps: MemoryServiceDeps): MemoryService {
  const count = (kind: MemoryScopeKind) => deps.store.count({ kinds: [kind] });

  return {
    async list(input: MemoryListInput): AsyncResult<MemoryList> {
      const kinds = input.scope ? { kinds: [input.scope] } : {};
      const items = await deps.store.list({ ...kinds, ...(input.query ? { query: input.query } : {}) });
      if (!items.ok) return items;
      // A search counts what it found; otherwise everything there is, past the list's cap too.
      if (input.query) return ok({ items: items.value, total: items.value.length });
      const total = await deps.store.count(kinds);
      return total.ok ? ok({ items: items.value, total: total.value }) : total;
    },

    async status(): AsyncResult<MemoryStatus> {
      const [localOnly, cloudPrompts, user, project, template] = await Promise.all([
        deps.settings.get(LOCAL_ONLY_SETTING),
        deps.settings.get(MEMORY_CLOUD_PROMPTS_SETTING),
        count('user'),
        count('project'),
        count('template'),
      ]);
      if (!localOnly.ok) return localOnly;
      if (!cloudPrompts.ok) return cloudPrompts;
      if (!user.ok) return user;
      if (!project.ok) return project;
      if (!template.ok) return template;
      const plan = promptPlan(deps.modules(localOnly.value), deps.promptModules());
      return ok({
        cloudPrompts: cloudPrompts.value,
        localOnly: localOnly.value,
        runsOn: plan.runsOn,
        providers: plan.providers.slice(0, 16),
        prompts: promptUse(localOnly.value, plan.runsOn, cloudPrompts.value),
        counts: { user: user.value, project: project.value, template: template.value },
      });
    },
  };
}
