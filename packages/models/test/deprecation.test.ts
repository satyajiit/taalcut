// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Deprecation watcher (PRD 8.4): gpt-image-1 shuts down on 2026-10-23. The
 * watcher reports it ahead of time, migrates the user's choices before the
 * day, and the resolver never sends a call to a retired model.
 */
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_PROFILES,
  createCatalog,
  createMemoryProfileStore,
  createModelProfiles,
  daysUntil,
  defaultProfileState,
  findRetirements,
  isRetired,
  MODEL_CATALOG,
  type ModelChoice,
} from '@taalcut/models';

const GPT_IMAGE_1: ModelChoice = { provider: 'openrouter', model: 'openai/gpt-image-1' };
// P3-B7: gpt-image-1's replacement is GPT Image 2.5 Flare (research image-generation.md, 2026-10-14).
const GPT_IMAGE_2: ModelChoice = { provider: 'openrouter', model: 'openai/gpt-image-2.5-flare' };

function profilesOn(day: { value: string }) {
  const store = createMemoryProfileStore();
  return { store, profiles: createModelProfiles({ store, today: () => day.value, tier: 'high' }) };
}

describe('deprecation watcher', () => {
  it('knows the retirement dates from PRD 8.4', () => {
    const catalog = createCatalog();
    expect(catalog.find(GPT_IMAGE_1)?.retiresOn).toBe('2026-10-23');
    expect(catalog.find({ provider: 'google', model: 'imagen-4' })?.retiresOn).toBe('2026-08-17');
    expect(isRetired(catalog.find(GPT_IMAGE_1), '2026-10-22')).toBe(false);
    expect(isRetired(catalog.find(GPT_IMAGE_1), '2026-10-23')).toBe(true);
    expect(daysUntil('2026-10-12', '2026-10-23')).toBe(11);
  });

  it('reports a retiring choice in the user override ahead of time', async () => {
    const day = { value: '2026-10-12' };
    const { profiles } = profilesOn(day);
    await profiles.setModuleOverride('images', { primary: GPT_IMAGE_1 });
    expect(profiles.retirements()).toEqual([
      {
        module: 'images',
        where: 'override',
        choice: GPT_IMAGE_1,
        retiresOn: '2026-10-23',
        daysLeft: 11,
        replacement: GPT_IMAGE_2,
      },
    ]);
    expect(profiles.retirements({ horizonDays: 7 })).toEqual([]);
    // Too early to migrate with the default seven-day lead.
    expect(await profiles.migrateRetiring()).toEqual({ ok: true, value: [] });
    const resolved = profiles.resolve('images');
    expect(resolved.ok && resolved.value.choices[0]).toEqual(GPT_IMAGE_1);
  });

  it('migrates the choice before the model dies, saves it and logs the migration', async () => {
    const day = { value: '2026-10-17' };
    const { profiles, store } = profilesOn(day);
    await profiles.setModuleOverride('images', {
      primary: GPT_IMAGE_1,
      fallbacks: [GPT_IMAGE_1, { provider: 'openrouter', model: 'x-ai/grok-imagine-image-2.0' }],
    });

    const migrated = await profiles.migrateRetiring();
    expect(migrated.ok && migrated.value.map((m) => [m.where, m.from.model, m.to.model])).toEqual([
      ['override', 'openai/gpt-image-1', 'openai/gpt-image-2.5-flare'],
      ['override', 'openai/gpt-image-1', 'openai/gpt-image-2.5-flare'],
    ]);
    expect(profiles.state().overrides.images?.primary).toEqual(GPT_IMAGE_2);
    expect(profiles.state().migrations).toHaveLength(2);
    expect((store.saved as { migrations: unknown[] }).migrations).toHaveLength(2);
    expect(profiles.retirements()).toEqual([]);
  });

  it('migrates custom profiles too', async () => {
    const day = { value: '2026-10-20' };
    const { profiles } = profilesOn(day);
    const balanced = BUILTIN_PROFILES.find((p) => p.id === 'balanced')!;
    await profiles.saveCustomProfile({
      ...balanced,
      id: 'old-images',
      modules: { ...balanced.modules, images: { chain: [GPT_IMAGE_1] } },
    });
    const migrated = await profiles.migrateRetiring();
    expect(migrated.ok && migrated.value[0]).toMatchObject({
      where: 'old-images',
      module: 'images',
      to: GPT_IMAGE_2,
    });
    expect(profiles.profiles().find((p) => p.id === 'old-images')?.modules.images.chain).toEqual([
      GPT_IMAGE_2,
    ]);
  });

  it('never resolves to a retired model, even before migration runs', async () => {
    const day = { value: '2026-10-12' };
    const { profiles } = profilesOn(day);
    await profiles.setModuleOverride('images', { primary: GPT_IMAGE_1 });
    day.value = '2026-10-23';
    const effective = profiles.effective('images');
    expect(effective.chain[0]).toEqual(GPT_IMAGE_2);
    expect(effective.skipped).toEqual([{ choice: GPT_IMAGE_1, reason: 'retired', replacedBy: GPT_IMAGE_2 }]);
  });

  it('refuses a retired model as a new choice', async () => {
    const { profiles } = profilesOn({ value: '2026-10-23' });
    const result = await profiles.setModuleOverride('images', { primary: GPT_IMAGE_1 });
    expect(!result.ok && result.error).toMatchObject({
      code: 'models.model_retired',
      params: { provider: 'openrouter', model: 'openai/gpt-image-1', retiredOn: '2026-10-23' },
    });
    expect(profiles.state().overrides.images).toBeUndefined();
  });

  it('drops a retired model that has no replacement', async () => {
    const gone = { provider: 'old', model: 'gone' };
    const catalog = createCatalog([
      ...MODEL_CATALOG,
      { ...gone, kind: 'chat', servedBy: 'pi-ai', local: false, retiresOn: '2026-11-01' },
    ]);
    const day = { value: '2026-10-12' };
    const profiles = createModelProfiles({
      store: createMemoryProfileStore(),
      catalog,
      today: () => day.value,
    });
    await profiles.setModuleOverride('agent', { primary: gone });
    day.value = '2026-11-01';
    const effective = profiles.effective('agent');
    expect(effective.chain.map((c) => c.provider)).toEqual(['anthropic', 'google']);
    expect(effective.skipped).toEqual([{ choice: gone, reason: 'retired' }]);
  });

  it('flags nothing in the built-in profiles for the next 30 days', () => {
    const notices = findRetirements(defaultProfileState(), BUILTIN_PROFILES, createCatalog(), '2026-10-12');
    expect(notices).toEqual([]);
  });
});
