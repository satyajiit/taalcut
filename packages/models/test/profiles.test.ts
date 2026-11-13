// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P1-F2 acceptance: switching profile changes the model used by the next call,
 * with no restart. Plus the profile format, overrides with reasoning level,
 * persistence through the ModelProfileStore port and hardware-tier filtering.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  BUILTIN_PROFILE_IDS,
  BUILTIN_PROFILES,
  createMemoryProfileStore,
  createModelProfiles,
  createModelRuntime,
  currentModels,
  isCurated,
  MODEL_CATALOG,
  MODULE_IDS,
  MODULES,
  ProfileStateSchema,
  type ChatMessage,
  type ModelProfile,
} from '@taalcut/models';
import { createHarness, type Harness } from './support/harness';

const PROMPT: ChatMessage[] = [{ role: 'user', content: 'Which clip opens the reel?' }];

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

describe('switching profile', () => {
  it('changes the model used by the next call, with no restart', async () => {
    const store = createMemoryProfileStore();
    const profiles = createModelProfiles({ store, tier: 'recommended' });
    expect((await profiles.load()).ok).toBe(true);
    h = await createHarness({ selector: profiles });

    const first = await h.client.complete({ module: 'agent', messages: PROMPT });
    expect(first.ok && [first.value.provider, first.value.model, first.value.reasoning]).toEqual([
      'openai',
      'gpt-6.1-sol',
      'medium',
    ]);

    expect((await profiles.setActiveProfile('fast-cheap')).ok).toBe(true);
    const second = await h.client.complete({ module: 'agent', messages: PROMPT });
    expect(second.ok && [second.value.provider, second.value.model, second.value.reasoning]).toEqual([
      'anthropic',
      'claude-haiku-5-5',
      'low',
    ]);

    expect(h.server.requests.map((r) => [r.route, r.body.model])).toEqual([
      ['openai', 'gpt-6.1-sol'],
      ['anthropic', 'claude-haiku-5-5'],
    ]);
    // The switch was saved, so the next start-up uses it too.
    const reopened = createModelProfiles({ store });
    expect(await reopened.load()).toEqual({ ok: true, value: 'loaded' });
    expect(reopened.activeProfile().id).toBe('fast-cheap');
  });

  it('applies a per-module override, including its reasoning level, to the next call', async () => {
    const profiles = createModelProfiles({ store: createMemoryProfileStore(), tier: 'recommended' });
    await profiles.load();
    h = await createHarness({ selector: profiles });

    const changed = await profiles.setModuleOverride('agent', {
      primary: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
      reasoning: 'high',
    });
    expect(changed.ok).toBe(true);
    const overridden = await h.client.complete({ module: 'agent', messages: PROMPT });
    expect(overridden.ok && [overridden.value.provider, overridden.value.reasoning]).toEqual([
      'anthropic',
      'high',
    ]);
    expect(JSON.stringify(h.server.requests[0]?.body)).toMatch(/"thinking"|"output_config"/);
    expect(profiles.effective('agent').overridden).toBe(true);
    // The rest of Balanced's chain stays as the fallback.
    expect(profiles.effective('agent').chain.map((c) => c.provider)).toEqual(['anthropic', 'google']);

    await profiles.setModuleOverride('agent', { reasoning: 'low' });
    expect(profiles.effective('agent').chain[0]).toEqual({
      provider: 'openai',
      model: 'gpt-6.1-sol',
      reasoning: 'low',
    });

    await profiles.clearModuleOverride('agent');
    const restored = await h.client.complete({ module: 'agent', messages: PROMPT });
    expect(restored.ok && [restored.value.model, restored.value.reasoning]).toEqual([
      'gpt-6.1-sol',
      'medium',
    ]);
  });

  it('notifies listeners after a change is saved', async () => {
    const profiles = createModelProfiles({ store: createMemoryProfileStore() });
    const seen: string[] = [];
    const stop = profiles.onChange((state) => seen.push(state.activeProfileId));
    await profiles.setActiveProfile('best-quality');
    stop();
    await profiles.setActiveProfile('local-only');
    expect(seen).toEqual(['best-quality']);
  });
});

describe('profile format', () => {
  const runtime = createModelRuntime();

  it('ships the four built-in profiles, each setting every module, with i18n keys only', () => {
    expect(BUILTIN_PROFILES.map((p) => p.id)).toEqual([...BUILTIN_PROFILE_IDS]);
    for (const profile of BUILTIN_PROFILES) {
      expect(Object.keys(profile.modules).sort()).toEqual([...MODULE_IDS].sort());
      expect(profile.labelKey).toBe(`models.profile.${profile.id}.label`);
    }
    expect(Object.values(MODULES).every((m) => m.labelKey.startsWith('models.module.'))).toBe(true);
  });

  it('only names models that pi-ai 1.4.0 or the Taalcut catalogue knows, of the kind each module needs', () => {
    const catalog = new Map(MODEL_CATALOG.map((e) => [`${e.provider}/${e.model}`, e]));
    for (const profile of BUILTIN_PROFILES) {
      for (const module of MODULE_IDS) {
        for (const choice of profile.modules[module].chain) {
          const key = `${choice.provider}/${choice.model}`;
          const kinds = MODULES[module].kinds;
          const piKinds = (['chat', 'image', 'classifier'] as const).filter((k) => kinds.includes(k));
          const kind =
            catalog.get(key)?.kind ??
            piKinds.find((k) => runtime.findModel(choice.provider, choice.model, k));
          expect(kind, `${profile.id}.${module}: ${key}`).toBeDefined();
          expect(kinds, `${profile.id}.${module}: ${key} is ${kind}`).toContain(kind);
          if (module === 'vision' && catalog.get(key)?.servedBy !== 'embedded-runtime') {
            expect(runtime.findModel(choice.provider, choice.model)?.input).toContain('image');
          }
        }
      }
    }
  });

  it('picks each provider’s current model for its role, at a thinking level that model takes (UX3-AGT)', () => {
    for (const profile of BUILTIN_PROFILES) {
      for (const module of MODULE_IDS) {
        for (const choice of profile.modules[module].chain) {
          const where = `${profile.id}.${module}: ${choice.provider}/${choice.model}`;
          if (isCurated(choice.provider))
            expect(currentModels(choice.provider), where).toContain(choice.model);
          const found = runtime.findModel(choice.provider, choice.model);
          if (choice.reasoning && found?.thinking) expect(found.thinking, where).toContain(choice.reasoning);
        }
      }
    }
  });

  it('keeps the Local only profile on this machine', () => {
    const localOnly = BUILTIN_PROFILES.find((p) => p.id === 'local-only')!;
    const choices = MODULE_IDS.flatMap((m) => localOnly.modules[m].chain);
    expect(choices.length).toBeGreaterThan(0);
    for (const choice of choices) {
      expect(
        MODEL_CATALOG.find((e) => e.provider === choice.provider && e.model === choice.model)?.local,
      ).toBe(true);
    }
    expect(localOnly.modules.voice.chain).toEqual([]);
  });

  it('needs nothing the user installs: no profile uses Ollama or another own server (D16)', () => {
    const catalog = new Map(MODEL_CATALOG.map((e) => [`${e.provider}/${e.model}`, e]));
    for (const profile of BUILTIN_PROFILES) {
      for (const module of MODULE_IDS) {
        for (const choice of profile.modules[module].chain) {
          const entry = catalog.get(`${choice.provider}/${choice.model}`);
          expect(entry?.servedBy, `${profile.id}.${module}: ${choice.provider}/${choice.model}`).not.toBe(
            'own-server',
          );
          expect(choice.provider).not.toMatch(/ollama|lm-?studio/i);
        }
      }
    }
    const localOnly = BUILTIN_PROFILES.find((p) => p.id === 'local-only')!;
    // Local only runs in the bundled runtimes (MLX for the 9B, llama.cpp for the rest), not a server the user
    // installs.
    expect(localOnly.modules.agent.chain).toEqual([
      { provider: 'on-device', model: 'qwen3.5-9b', reasoning: 'off' },
      { provider: 'on-device', model: 'qwen3.5-4b', reasoning: 'off' },
      { provider: 'on-device', model: 'qwen3.5-0.8b', reasoning: 'off' },
    ]);
    expect(localOnly.modules.vision.chain).toEqual([
      { provider: 'on-device', model: 'qwen3.5-9b', reasoning: 'off' },
      { provider: 'on-device', model: 'qwen3.5-4b', reasoning: 'off' },
    ]);
  });

  it('routes with Jev first and Clef second, as spike 04 decided', () => {
    for (const profile of BUILTIN_PROFILES.filter((p) => p.id !== 'local-only')) {
      expect(profile.modules.router.chain[0]).toEqual({ provider: 'typesafe', model: 'jev-1.13.0' });
      expect(profile.modules.router.chain[1]?.provider).toBe('cloudflare-workers-ai');
    }
  });

  it('rejects invalid overrides, unknown profiles and bad custom profiles as values', async () => {
    const profiles = createModelProfiles({ store: createMemoryProfileStore() });
    const empty = await profiles.setModuleOverride('agent', {});
    expect(!empty.ok && empty.error.code).toBe('models.profile_invalid');
    const badLevel = await profiles.setModuleOverride('agent', { reasoning: 'extreme' as never });
    expect(!badLevel.ok && badLevel.error.code).toBe('models.profile_invalid');
    const missing = await profiles.setActiveProfile('turbo');
    expect(!missing.ok && missing.error).toMatchObject({
      code: 'models.profile_not_found',
      params: { profile: 'turbo' },
    });
    const builtin = await profiles.saveCustomProfile(BUILTIN_PROFILES[0]!);
    expect(!builtin.ok && builtin.error.code).toBe('models.profile_invalid');
    const broken = await profiles.saveCustomProfile({ id: 'Bad Id' } as unknown as ModelProfile);
    expect(!broken.ok && broken.error.code).toBe('models.profile_invalid');
  });

  it('saves custom profiles as data and can make them active', async () => {
    const store = createMemoryProfileStore();
    const profiles = createModelProfiles({ store });
    const base = BUILTIN_PROFILES.find((p) => p.id === 'balanced')!;
    const custom: ModelProfile = {
      ...base,
      id: 'my-studio',
      labelKey: 'models.profile.custom.label',
      modules: {
        ...base.modules,
        agent: { chain: [{ provider: 'anthropic', model: 'claude-opus-5-5', reasoning: 'max' }] },
      },
    };
    expect((await profiles.saveCustomProfile(custom)).ok).toBe(true);
    expect((await profiles.setActiveProfile('my-studio')).ok).toBe(true);
    expect(profiles.resolve('agent')).toEqual({
      ok: true,
      value: { module: 'agent', choices: custom.modules.agent.chain },
    });
    expect(ProfileStateSchema.parse(store.saved).customProfiles).toHaveLength(1);
  });

  it('replaces unreadable saved state with defaults instead of failing start-up', async () => {
    const profiles = createModelProfiles({ store: createMemoryProfileStore({ version: 9, junk: true }) });
    expect(await profiles.load()).toEqual({ ok: true, value: 'reset-invalid' });
    expect(profiles.activeProfile().id).toBe('balanced');
    const firstRun = createModelProfiles({ store: createMemoryProfileStore() });
    expect(await firstRun.load()).toEqual({ ok: true, value: 'first-run' });
  });

  it('reports a module that is off in the profile', async () => {
    const profiles = createModelProfiles({ store: createMemoryProfileStore() });
    await profiles.setActiveProfile('local-only');
    const voice = profiles.resolve('voice');
    expect(!voice.ok && voice.error.code).toBe('models.no_model_for_module');
  });
});

describe('hardware tier filtering', () => {
  it('runs vision in the cloud on an 8 GB Mac and locally on 16 GB (PRD 11)', () => {
    const profiles = createModelProfiles({ store: createMemoryProfileStore(), tier: 'minimum' });
    const minimum = profiles.effective('vision');
    expect(minimum.chain[0]).toMatchObject({ provider: 'google' });
    expect(minimum.skipped).toEqual([
      {
        choice: { provider: 'on-device', model: 'qwen3.5-9b', reasoning: 'off' },
        reason: 'needs-higher-tier',
      },
      {
        choice: { provider: 'on-device', model: 'qwen3.5-4b', reasoning: 'off' },
        reason: 'needs-higher-tier',
      },
    ]);

    profiles.setTier('recommended');
    expect(profiles.effective('vision').chain[0]).toMatchObject({
      provider: 'on-device',
      model: 'qwen3.5-4b',
    });
    // MLX1: High Macs try the 9B first, then the 4B (where the 9B isn't served, the call moves on at once).
    profiles.setTier('high');
    expect(profiles.effective('vision').chain.slice(0, 2)).toMatchObject([
      { provider: 'on-device', model: 'qwen3.5-9b' },
      { provider: 'on-device', model: 'qwen3.5-4b' },
    ]);
    // Embeddings stay on-device on every tier.
    expect(profiles.effective('embeddings').chain).toEqual([{ provider: 'onnx', model: 'embeddinggemma-2' }]);
  });

  it('runs Local only on the 0.8B on the smallest tier, text only (spike 08, J8b)', async () => {
    const profiles = createModelProfiles({ store: createMemoryProfileStore(), tier: 'minimum' });
    await profiles.setActiveProfile('local-only');
    const skipped4b = [
      {
        choice: { provider: 'on-device', model: 'qwen3.5-9b', reasoning: 'off' },
        reason: 'needs-higher-tier',
      },
      {
        choice: { provider: 'on-device', model: 'qwen3.5-4b', reasoning: 'off' },
        reason: 'needs-higher-tier',
      },
    ];
    expect(profiles.effective('agent')).toMatchObject({
      chain: [{ provider: 'on-device', model: 'qwen3.5-0.8b', reasoning: 'off' }],
      skipped: skipped4b,
    });
    // The 0.8B has no projector, so Local only has no vision model on an 8 GB Mac.
    expect(profiles.effective('vision')).toMatchObject({ chain: [], skipped: skipped4b });
    expect(profiles.resolve('vision')).toMatchObject({
      ok: false,
      error: { code: 'models.no_model_for_module' },
    });
    // Everything that isn't a language model still runs on device.
    expect(profiles.effective('embeddings').chain).toEqual([{ provider: 'onnx', model: 'embeddinggemma-2' }]);
    expect(profiles.effective('speech').chain[0]).toMatchObject({ provider: 'sherpa-onnx' });

    profiles.setTier('recommended');
    expect(profiles.effective('agent').chain[0]).toEqual({
      provider: 'on-device',
      model: 'qwen3.5-4b',
      reasoning: 'off',
    });
  });
});
