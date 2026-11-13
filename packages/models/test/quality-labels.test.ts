// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B10: each module's quality label per tier and setting (models SPEC P3.6), and that the labels agree
 * with what the privacy overview says leaves this device.
 */
import { moduleQualitySchema } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createMemoryProfileStore,
  createModelProfiles,
  createModelRuntime,
  MODELS_MESSAGES_EN,
  MODULE_IDS,
  moduleNetworks,
  moduleQualities,
  moduleQuality,
  QUALITY_LABEL_KEYS,
  type HardwareTier,
  type ModuleId,
} from '@taalcut/models';

const TODAY = () => '2026-10-14';

async function setup(profile: string, tier: HardwareTier) {
  const profiles = createModelProfiles({ store: createMemoryProfileStore(), tier, today: TODAY });
  await profiles.load();
  if (profile !== 'balanced') await profiles.setActiveProfile(profile);
  const runtime = createModelRuntime({ builtinProviders: ['openai', 'google', 'anthropic'] });
  return { profiles, runtime };
}

async function labels(profile: string, tier: HardwareTier, localOnly: boolean) {
  const { profiles, runtime } = await setup(profile, tier);
  const list = moduleQualities({ selector: profiles, runtime, localOnly, tier, today: TODAY });
  return Object.fromEntries(list.map((q) => [q.module, q.quality])) as Record<ModuleId, string>;
}

describe('quality labels under Local only, with the Local only profile', () => {
  it('Recommended: the agent is lower quality, voice and images need the internet, the rest is full', async () => {
    expect(await labels('local-only', 'recommended', true)).toEqual({
      agent: 'lowerQuality',
      router: 'full',
      vision: 'full',
      embeddings: 'full',
      speech: 'full',
      voice: 'unavailable',
      music: 'lowerQuality',
      images: 'unavailable',
    });
  });

  it('High: the same as Recommended', async () => {
    expect(await labels('local-only', 'high', true)).toEqual(await labels('local-only', 'recommended', true));
  });

  it('Minimum: the agent runs on the small model, and vision has nothing that fits this Mac', async () => {
    const { profiles, runtime } = await setup('local-only', 'minimum');
    const deps = { selector: profiles, runtime, localOnly: true, tier: 'minimum' as const, today: TODAY };
    expect(moduleQuality(deps, 'agent')).toEqual({
      module: 'agent',
      quality: 'lowerQuality',
      labelKey: QUALITY_LABEL_KEYS.lowerQuality,
    });
    // Local only removed nothing: the Local only profile has no vision model for this tier at all.
    expect(moduleQuality(deps, 'vision')).toEqual({
      module: 'vision',
      quality: 'unavailable',
      labelKey: QUALITY_LABEL_KEYS.notConfigured,
    });
  });
});

describe('quality labels with a cloud profile', () => {
  it('Balanced without Local only: everything is full', async () => {
    const all = await labels('balanced', 'recommended', false);
    for (const module of MODULE_IDS) expect(all[module], module).toBe('full');
  });

  it('Balanced with Local only on: cloud-only modules need the internet; music falls back to the pack', async () => {
    const { profiles, runtime } = await setup('balanced', 'recommended');
    const deps = { selector: profiles, runtime, localOnly: true, tier: 'recommended' as const, today: TODAY };
    expect(moduleQuality(deps, 'agent')).toMatchObject({
      quality: 'unavailable',
      labelKey: QUALITY_LABEL_KEYS.needsInternet,
    });
    expect(moduleQuality(deps, 'music').quality).toBe('lowerQuality');
    // Balanced already starts vision on this Mac at Recommended: nothing was lost.
    expect(moduleQuality(deps, 'vision').quality).toBe('full');
    expect(moduleQuality(deps, 'router').quality).toBe('full');
  });

  it('the Local only profile with Local only off is still lower quality where the cloud would lead', async () => {
    const all = await labels('local-only', 'recommended', false);
    expect(all.agent).toBe('lowerQuality');
    expect(all.speech).toBe('full');
  });

  it('every label parses as core’s ModuleQuality and has an English text key', async () => {
    const { profiles, runtime } = await setup('local-only', 'minimum');
    for (const q of moduleQualities({ selector: profiles, runtime, localOnly: true, tier: 'minimum' })) {
      expect(moduleQualitySchema.safeParse(q).success).toBe(true);
    }
    for (const key of Object.values(QUALITY_LABEL_KEYS)) expect(MODELS_MESSAGES_EN[key], key).toBeTruthy();
  });
});

describe('labels agree with what leaves this device', () => {
  it.each([
    ['local-only', 'minimum', true],
    ['local-only', 'recommended', true],
    ['balanced', 'recommended', true],
    ['balanced', 'minimum', false],
    ['fast-cheap', 'high', true],
    ['best-quality', 'recommended', false],
  ] as const)('%s on %s (Local only %s)', async (profile, tier, localOnly) => {
    const { profiles, runtime } = await setup(profile, tier);
    const networks = moduleNetworks({ selector: profiles, runtime, localOnly });
    const quality = moduleQualities({ selector: profiles, runtime, localOnly, tier, today: TODAY });
    for (const network of networks) {
      const label = quality.find((q) => q.module === network.module);
      // A module that is off can't be anything but unavailable, and one that runs is never unavailable.
      expect(label?.quality === 'unavailable', network.module).toBe(network.runsOn === 'off');
      // A module that sends to the cloud first is never labelled lower quality on this Mac.
      if (network.runsOn === 'cloud') expect(label?.quality, network.module).toBe('full');
    }
  });
});
