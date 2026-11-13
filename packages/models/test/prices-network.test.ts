// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Prices for cost estimates (P2-X1) and what leaves this device per module
 * (P2-X2), over the built-in profiles and pi-ai's catalogue, offline.
 */
import { SENT_KINDS } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createMemoryProfileStore,
  createModelProfiles,
  createModelRuntime,
  createPriceLookup,
  estimateUsd,
  MODULE_IDS,
  MODULE_SENDS,
  moduleNetwork,
  moduleNetworks,
  type ModuleId,
} from '@taalcut/models';

const TODAY = () => '2026-10-12';

async function setup(profile = 'balanced', tier: 'minimum' | 'recommended' = 'minimum') {
  const profiles = createModelProfiles({ store: createMemoryProfileStore(), tier, today: TODAY });
  await profiles.load();
  if (profile !== 'balanced') await profiles.setActiveProfile(profile);
  const runtime = createModelRuntime({ builtinProviders: ['openai', 'google', 'anthropic'] });
  return { profiles, runtime };
}

const pricesOf = (runtime: ReturnType<typeof createModelRuntime>, provider: string, model: string) => {
  const info = runtime.findModel(provider, model);
  if (!info) throw new Error(`no ${provider}/${model}`);
  return { input: info.price.input, output: info.price.output, cacheRead: info.price.cacheRead };
};

describe('price lookup', () => {
  it("prices a module at its chain's first model, from pi-ai's catalogue", async () => {
    const { profiles, runtime } = await setup();
    const lookup = createPriceLookup({ selector: profiles, runtime, today: TODAY });
    const price = lookup.price('agent');
    expect(price).toEqual({
      module: 'agent',
      provider: 'openai',
      model: 'gpt-6.1-sol',
      local: false,
      usdPerMTok: pricesOf(runtime, 'openai', 'gpt-6.1-sol'),
    });
    expect(price!.usdPerMTok.input).toBeGreaterThan(0);
  });

  it('prices a model on this Mac at US$0, whatever a catalogue says', async () => {
    // Recommended tier: the on-device Qwen leads Balanced's vision chain.
    const { profiles, runtime } = await setup('balanced', 'recommended');
    const lookup = createPriceLookup({ selector: profiles, runtime, today: TODAY });
    expect(lookup.price('vision')).toMatchObject({
      provider: 'on-device',
      local: true,
      usdPerMTok: { input: 0, output: 0, cacheRead: 0 },
    });
    // On the floor tier it is skipped for its tier, so the cloud model that would run is priced.
    const floor = await setup();
    const cloud = createPriceLookup({ selector: floor.profiles, runtime: floor.runtime, today: TODAY });
    expect(cloud.price('vision')).toMatchObject({ provider: 'google', local: false });
    // Embeddings run on this Mac (ONNX) even though the runtime has no endpoint for them.
    expect(cloud.price('embeddings')).toMatchObject({ provider: 'onnx', local: true });
  });

  it('skips a cloud model it has no price for, and has nothing for a module that is off', async () => {
    const { profiles, runtime } = await setup('local-only');
    const lookup = createPriceLookup({ selector: profiles, runtime, today: TODAY });
    expect(lookup.price('images')).toBeUndefined();
    const balanced = await setup();
    const speech = createPriceLookup({
      selector: balanced.profiles,
      runtime: balanced.runtime,
      today: TODAY,
    });
    // Balanced's speech starts with ElevenLabs Scribe (no pi-ai price), then Parakeet on this Mac.
    expect(speech.price('speech')).toMatchObject({ provider: 'sherpa-onnx', local: true });
  });

  it('lists the options this Mac first, then cheapest first, leaving out what cannot be picked', async () => {
    const { profiles, runtime } = await setup('balanced', 'recommended');
    const lookup = createPriceLookup({
      selector: profiles,
      runtime,
      today: TODAY,
      configured: () => new Set(['openai', 'google']),
    });
    const options = lookup.options('agent');
    expect(options.length).toBeGreaterThan(2);
    expect(options[0]).toMatchObject({ local: true, usdPerMTok: { input: 0, output: 0 } });
    const cloud = options.filter((o) => !o.local);
    expect(cloud.every((o) => o.provider !== 'anthropic')).toBe(true);
    const perToken = cloud.map((o) => o.usdPerMTok.input + o.usdPerMTok.output);
    expect(perToken).toEqual([...perToken].sort((a, b) => a - b));
    const lastLocal = options.findLastIndex((o) => o.local);
    expect(options.slice(0, lastLocal + 1).every((o) => o.local)).toBe(true);
    // Out of tier on the floor: the 4B isn't offered.
    const floor = await setup();
    const small = createPriceLookup({ selector: floor.profiles, runtime: floor.runtime, today: TODAY });
    expect(small.options('agent').some((o) => o.model === 'qwen3.5-4b')).toBe(false);
  });

  it('estimates work at a price per million tokens', () => {
    const price = { usdPerMTok: { input: 2, output: 10, cacheRead: 0.5 } };
    expect(estimateUsd(price, { inputTokens: 1_000_000, outputTokens: 0 })).toBe(2);
    expect(
      estimateUsd(price, { inputTokens: 500_000, outputTokens: 100_000, cachedInputTokens: 200_000 }),
    ).toBe(1 + 1 + 0.1);
    expect(
      estimateUsd({ usdPerMTok: { input: 0, output: 0, cacheRead: 0 } }, { inputTokens: 9, outputTokens: 9 }),
    ).toBe(0);
  });
});

describe('what leaves this device, per module', () => {
  it('says where each module runs, its cloud providers in chain order and what it sends', async () => {
    const { profiles, runtime } = await setup();
    const all = moduleNetworks({ selector: profiles, runtime });
    expect(all.map((n) => n.module)).toEqual([...MODULE_IDS]);
    const by = (module: ModuleId) => all.find((n) => n.module === module)!;
    expect(by('agent')).toEqual({
      module: 'agent',
      runsOn: 'cloud',
      providers: ['openai', 'anthropic', 'google'],
      sends: ['messages', 'tool-results', 'prompts'],
    });
    // The 4B is out of tier on the floor: vision goes to the cloud.
    expect(by('vision')).toMatchObject({
      runsOn: 'cloud',
      providers: ['google', 'openai'],
      sends: ['frames', 'audio', 'prompts'],
    });
    expect(by('embeddings')).toMatchObject({ runsOn: 'this-mac', providers: [] });
    expect(by('speech')).toMatchObject({ runsOn: 'both', providers: ['elevenlabs'], sends: ['audio'] });
    expect(by('router')).toMatchObject({ runsOn: 'both', providers: ['typesafe', 'cloudflare-workers-ai'] });
  });

  it('with Local only on, counts only what runs here: cloud-only modules are off', async () => {
    const { profiles, runtime } = await setup();
    const all = moduleNetworks({ selector: profiles, runtime, localOnly: true });
    for (const network of all) expect(network.providers).toEqual([]);
    expect(all.find((n) => n.module === 'agent')).toMatchObject({ runsOn: 'off' });
    expect(all.find((n) => n.module === 'speech')).toMatchObject({ runsOn: 'this-mac' });
  });

  it('an empty chain is off; the Local only profile sends nothing', async () => {
    const { profiles, runtime } = await setup('local-only', 'recommended');
    expect(moduleNetwork({ selector: profiles, runtime }, 'voice')).toMatchObject({
      runsOn: 'off',
      providers: [],
    });
    for (const network of moduleNetworks({ selector: profiles, runtime })) {
      expect(network.providers).toEqual([]);
      expect(['this-mac', 'off']).toContain(network.runsOn);
    }
  });

  it('names only kinds the privacy panel knows', () => {
    for (const module of MODULE_IDS)
      for (const kind of MODULE_SENDS[module]) expect(SENT_KINDS as readonly string[]).toContain(kind);
  });
});
