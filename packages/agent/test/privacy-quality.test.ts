// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B10: Settings → Privacy's quality labels come from the same read of Local only as the module plans, so
 * "what leaves this device" and "lower quality on this Mac" can't disagree (models SPEC P3.6).
 */
import {
  createMemorySettingsStore,
  LOCAL_ONLY_SETTING,
  ok,
  privacyOverviewSchema,
  unwrap,
} from '@taalcut/core';
import { createMemoryConsentStore, createPrivacyService } from '@taalcut/agent';
import {
  createMemoryProfileStore,
  createModelProfiles,
  createModelRuntime,
  moduleNetworks,
  moduleQualities,
} from '@taalcut/models';
import { describe, expect, it } from 'vitest';

const TODAY = () => '2026-10-14';

async function setup(profile: string) {
  const profiles = createModelProfiles({
    store: createMemoryProfileStore(),
    tier: 'recommended',
    today: TODAY,
  });
  await profiles.load();
  if (profile !== 'balanced') await profiles.setActiveProfile(profile);
  const runtime = createModelRuntime({ builtinProviders: ['openai', 'google', 'anthropic'] });
  const settings = createMemorySettingsStore();
  const seen: boolean[] = [];
  const service = createPrivacyService({
    settings,
    consents: createMemoryConsentStore(),
    cloudCalls: async () => ok([]),
    modules: (localOnly) => {
      seen.push(localOnly);
      return moduleNetworks({ selector: profiles, runtime, localOnly });
    },
    quality: (localOnly) => {
      seen.push(localOnly);
      return moduleQualities({ selector: profiles, runtime, localOnly, tier: profiles.tier(), today: TODAY });
    },
  });
  return { settings, service, seen };
}

describe('privacy overview quality', () => {
  it('reports every module’s label, from the same Local only value as the plans', async () => {
    const { settings, service, seen } = await setup('local-only');
    unwrap(await settings.set(LOCAL_ONLY_SETTING, true));
    const overview = unwrap(await service.overview());
    expect(privacyOverviewSchema.safeParse(overview).success).toBe(true);
    expect(seen).toEqual([true, true]);
    expect(overview.quality.map((q) => [q.module, q.quality])).toEqual([
      ['agent', 'lowerQuality'],
      ['router', 'full'],
      ['vision', 'full'],
      ['embeddings', 'full'],
      ['speech', 'full'],
      ['voice', 'unavailable'],
      ['music', 'lowerQuality'],
      ['images', 'unavailable'],
    ]);
    // Nothing that is labelled usable sends to the cloud under Local only.
    for (const module of overview.modules) expect(module.providers, module.module).toEqual([]);
  });

  it('a module the overview shows as off is the one labelled unavailable', async () => {
    const { settings, service } = await setup('balanced');
    unwrap(await settings.set(LOCAL_ONLY_SETTING, true));
    const overview = unwrap(await service.overview());
    for (const module of overview.modules) {
      const label = overview.quality.find((q) => q.module === module.module);
      expect(label?.quality === 'unavailable', module.module).toBe(module.runsOn === 'off');
    }
  });

  it('without a quality source, no label is reported', async () => {
    const service = createPrivacyService({
      settings: createMemorySettingsStore(),
      consents: createMemoryConsentStore(),
      cloudCalls: async () => ok([]),
      modules: () => [],
    });
    expect(unwrap(await service.overview()).quality).toEqual([]);
  });
});
