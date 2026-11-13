// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-FIX: a description waits for the bundled model only when that model is the one that describes. Someone whose
 * vision model is their own server (Ollama, LM Studio on this computer) has local placement too; waiting for a bundled
 * download they may never start would stop their descriptions. Read from the profiles the agent saves, resolved as the
 * agent resolves them, and the servers saved in Settings › Advanced.
 */
import { describe, expect, it } from 'vitest';
import { ok, type ModelProfileStore, type SettingsStore } from '@taalcut/core';
import { MODEL_MISSING } from '@taalcut/library';
import { createMemoryProfileStore, createModelProfiles } from '@taalcut/models';
import { describerReader, localDescriber } from '../src/utility/roots/describer-chain';
import { indexStageWiring } from '../src/utility/roots/index-stages';

const LOCAL_OLLAMA = { 'accounts.localServers': { ollama: 'http://127.0.0.1:11434' } };
const LAN_OLLAMA = { 'accounts.localServers': { ollama: 'http://192.168.1.20:11434' } };

function settings(values: Record<string, unknown> = {}): SettingsStore {
  return {
    get: async (setting: { key: string; defaultValue: unknown }) =>
      ok(values[setting.key] ?? setting.defaultValue),
  } as unknown as SettingsStore;
}

/** A profile store whose vision module the person pointed at their own Ollama model. */
async function ownVisionModel(): Promise<ModelProfileStore> {
  const store = createMemoryProfileStore();
  const profiles = createModelProfiles({ store, tier: 'recommended' });
  await profiles.load();
  const set = await profiles.setModuleOverride('vision', {
    primary: { provider: 'ollama', model: 'qwen2.5vl:7b' },
    fallbacks: [],
  });
  if (!set.ok) throw new Error(set.error.code);
  return store;
}

/** Counts saves: the jobs process must never write the agent's profiles. */
function counted(store: ModelProfileStore): { store: ModelProfileStore; saves: () => number } {
  let saves = 0;
  return {
    store: {
      load: () => store.load(),
      save: (state, context) => {
        saves++;
        return store.save(state, context);
      },
    },
    saves: () => saves,
  };
}

describe('who describes on this Mac', () => {
  it('is their own server when one on this computer is anywhere in the vision chain', () => {
    const local = new Set(['ollama']);
    expect(localDescriber(['ollama'], local)).toBe('own-server');
    // The bundled model first falls through to their server while it isn't installed.
    expect(localDescriber(['on-device', 'ollama', 'openai'], local)).toBe('own-server');
    expect(localDescriber(['on-device', 'openai'], local)).toBe('bundled');
    // A server with no address here (unset, or a box on the LAN) never takes a local call.
    expect(localDescriber(['ollama', 'on-device'], new Set())).toBe('bundled');
    expect(localDescriber(['ollama'], new Set())).toBe('none');
    expect(localDescriber(['openai'], local)).toBe('none');
  });

  it("reads the agent's profiles: the default names the bundled model, an Ollama vision model their server", async () => {
    const fresh = counted(createMemoryProfileStore());
    expect(await describerReader(fresh.store, settings())('recommended')).toBe('bundled');
    const own = counted(await ownVisionModel());
    expect(await describerReader(own.store, settings(LOCAL_OLLAMA))('recommended')).toBe('own-server');
    // The same choice with the server on the LAN: a local description can't reach it.
    expect(await describerReader(own.store, settings(LAN_OLLAMA))('recommended')).not.toBe('own-server');
    expect(fresh.saves() + own.saves()).toBe(0);
  });
});

describe('vision.describe with a vision model of their own', () => {
  const installed = new Set(['embeddinggemma-2']);
  const wiring = (describer: 'bundled' | 'own-server' | 'none' | undefined) =>
    indexStageWiring({
      tier: async () => 'recommended',
      settings: () => settings(),
      installed: (id) => installed.has(id),
      describer: async () => describer,
    });

  it("doesn't wait for the bundled model their server stands in for, nor where nothing local describes", async () => {
    for (const describer of ['own-server', 'none'] as const) {
      const app = wiring(describer);
      await app.refresh();
      expect(app.notReady?.('vision.describe'), describer).toBeUndefined();
    }
  });

  it('waits for the bundled model when it describes, or when who describes is unknown', async () => {
    for (const describer of ['bundled', undefined] as const) {
      const app = wiring(describer);
      await app.refresh();
      expect(app.notReady?.('vision.describe'), String(describer)).toBe(MODEL_MISSING);
    }
  });
});
