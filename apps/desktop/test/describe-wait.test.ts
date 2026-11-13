// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * vision.describe waits for the model that describes (LIB1-FIX). It waited only for EmbeddingGemma, so a clip
 * imported while Qwen3.5 4B was still downloading was described as `not_yet`, the stage was done, and nothing ran it
 * again. On this Mac, on a tier that has a describing model, it now waits for the runtime and the model's weights
 * and projector too. A cloud description never waits for a local model, and a tier without one skips once with
 * `no_local_model` instead of waiting for ever.
 */
import { describe, expect, it } from 'vitest';
import { ok, UPLOAD_CONSENTS_SETTING, type SettingsStore } from '@taalcut/core';
import { MODEL_MISSING } from '@taalcut/library';
import type { Tier } from '@taalcut/vision';
import { describerModel, describerNeeds, indexStageWiring } from '../src/utility/roots/index-stages';

const DESCRIBER = ['local-llm-runtime', 'local-llm-qwen3-5-4b', 'local-llm-qwen3-5-4b-mmproj'];
const CONSENT = { vision: { id: 'c1', module: 'vision', providers: ['openai'], grantedAt: 1 } };

function settings(values: Record<string, unknown>): SettingsStore {
  return {
    get: async (setting: { key: string; defaultValue: unknown }) =>
      ok(values[setting.key] ?? setting.defaultValue),
  } as unknown as SettingsStore;
}

function wiring(tier: Tier, installed: Set<string>, values: Record<string, unknown> = {}) {
  return indexStageWiring({
    tier: async () => tier,
    settings: () => settings(values),
    installed: (id) => installed.has(id),
  });
}

describe('vision.describe waits for the model that describes', () => {
  it('names the runtime, the weights and the projector where the tier has a describing model', () => {
    for (const tier of ['recommended', 'high'] as const) {
      const needs = describerNeeds(tier);
      expect(needs.map((anyOf) => anyOf[0])).toEqual(DESCRIBER);
      // Any of the runtime's builds will do: a Linux GPU build has its own id.
      expect(needs[0]).toEqual(
        expect.arrayContaining(['local-llm-runtime-cuda', 'local-llm-runtime-vulkan']),
      );
      expect(describerModel(tier)).toBe('local-llm-qwen3-5-4b');
    }
    // 8 GB Macs get a text-only model: nothing to wait for, nothing to name.
    expect(describerNeeds('minimum')).toEqual([]);
    expect(describerModel('minimum')).toBeUndefined();
  });

  it('waits on this Mac until each part of the describing model is installed, then runs', async () => {
    const installed = new Set(['embeddinggemma-2']);
    const app = wiring('recommended', installed);
    await app.refresh();
    expect(app.notReady?.('vision.describe')).toBe(MODEL_MISSING);
    // The stages that only embed don't wait for it.
    expect(app.notReady?.('vision.embed')).toBeUndefined();
    for (const id of DESCRIBER) {
      expect(app.notReady?.('vision.describe'), `before ${id}`).toBe(MODEL_MISSING);
      installed.add(id);
      await app.refresh();
    }
    expect(app.notReady?.('vision.describe')).toBeUndefined();
    // Still waits for EmbeddingGemma, which stores its vectors in the same job.
    installed.delete('embeddinggemma-2');
    await app.refresh();
    expect(app.notReady?.('vision.describe')).toBe(MODEL_MISSING);
  });

  it('takes a Linux GPU build of the runtime as the runtime', async () => {
    const installed = new Set(['embeddinggemma-2', 'local-llm-runtime-vulkan', ...DESCRIBER.slice(1)]);
    const app = wiring('recommended', installed);
    await app.refresh();
    expect(app.notReady?.('vision.describe')).toBeUndefined();
  });

  it('never waits for a local model when descriptions go to the cloud', async () => {
    const installed = new Set(['embeddinggemma-2']);
    const app = wiring('recommended', installed, { [UPLOAD_CONSENTS_SETTING.key]: CONSENT });
    await app.refresh();
    expect(app.notReady?.('vision.describe')).toBeUndefined();
    installed.delete('embeddinggemma-2');
    await app.refresh();
    expect(app.notReady?.('vision.describe')).toBe(MODEL_MISSING);
  });

  it('runs on a tier without a describing model, which skips once with no_local_model', async () => {
    const app = wiring('minimum', new Set(['embeddinggemma-2']));
    await app.refresh();
    expect(app.notReady?.('vision.describe')).toBeUndefined();
  });
});
