// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The one place a run's casting config is resolved: the learned item's weights when there is one for this config,
 * recorded on the cast; deleting the item (Reset) gives the default ranking back.
 */
import { newId, ok, type MemoryItemView, type MemoryStore, type CastingWeights } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createMemoryShotCatalog } from '../../src/casting/catalog';
import { CASTING_CONFIG } from '../../src/casting/config';
import { createCastingEngine, type CastResult } from '../../src/casting/engine';
import { learnedCastingConfig, staticCastingConfig } from '../../src/casting/learned/config-source';
import { world } from '../fixtures/casting';
import { fakeEmbedder } from '../fixtures/library';

function learnedItem(weights: CastingWeights, configVersion = 'casting.v5'): MemoryItemView {
  return {
    id: newId<'MemoryItem'>(),
    scope: { kind: 'user' },
    text: 'Leans toward sharp, well-exposed shots.',
    source: 'learned',
    data: { kind: 'casting-weights', configVersion, defaults: CASTING_CONFIG.weights, weights, pairs: 20 },
    conversationId: null,
    revision: 2,
    createdAt: 1_000,
    updatedAt: 2_000,
    scopeName: null,
  };
}

function memory(items: MemoryItemView[]): Pick<MemoryStore, 'list'> {
  return { list: async () => ok(items.slice(0, 1)) };
}

const leaning = { intent: 0.2, motion: 0.3, quality: 0.3, subject: 0.075, energy: 0.125 };

describe('learnedCastingConfig', () => {
  it('is the config as it is without a learned item', async () => {
    const resolved = await learnedCastingConfig({ store: memory([]) }).resolve();
    expect(resolved.ok && resolved.value).toEqual({
      config: CASTING_CONFIG,
      weights: { source: 'default', values: CASTING_CONFIG.weights },
      label: 'casting.v5',
    });
  });

  it('overlays the learned weights and says whose they are', async () => {
    const item = learnedItem(leaning);
    const resolved = await learnedCastingConfig({ store: memory([item]) }).resolve();
    if (!resolved.ok) throw new Error(resolved.error.code);
    expect(resolved.value.config).toEqual({ ...CASTING_CONFIG, weights: leaning });
    expect(resolved.value.weights).toEqual({
      source: 'learned',
      values: leaning,
      memoryId: item.id,
      updatedAt: 2_000,
    });
    expect(resolved.value.label).toBe('casting.v5+learned@2000');
  });

  it('brings stored weights inside the bounds, and ignores another config version', async () => {
    const wild = await learnedCastingConfig({
      store: memory([learnedItem({ ...leaning, motion: 4 })]),
    }).resolve();
    expect(wild.ok && wild.value.config.weights.motion).toBe(0.3);
    const other = await learnedCastingConfig({
      store: memory([learnedItem(leaning, 'casting.v1')]),
    }).resolve();
    expect(other.ok && other.value.weights.source).toBe('default');
  });
});

describe('casting through the resolved config', () => {
  const { template, profiles } = world({ slots: 5, perSlot: 4, confusers: 4, distractors: 20, seed: 11 });
  const items: MemoryItemView[] = [];
  // Each slot's line embeds near its own shots, so its cosines rise above casting's floor (FIX-CAST).
  const near = new Map(template.slots.map((slot, index) => [slot.intent.text, profiles[index * 4]!.embedding]));
  const engine = createCastingEngine({
    catalog: createMemoryShotCatalog(profiles),
    embedder: fakeEmbedder(near),
    configSource: learnedCastingConfig({ store: memory(items) }),
  });
  const cast = async () => {
    const result = await engine.cast({
      projectId: newId<'Project'>(),
      template,
      mode: 'template',
      variants: 1,
      seed: 1,
    });
    if (!result.ok) throw new Error(result.error.code);
    return result.value;
  };
  const ranking = (result: CastResult) =>
    result.variants.map((variant) =>
      variant.slots.map((slot) => [slot.pick?.shotId, ...slot.alternates.map((alt) => alt.shotId)]),
    );

  it('records the learned weights on the cast, and a reset restores the default ranking', async () => {
    const before = await cast();
    expect(before.weights.source).toBe('default');
    items.push(learnedItem(leaning));
    const learned = await cast();
    expect(learned.configVersion).toBe('casting.v5+learned@2000');
    expect(learned.weights.values).toEqual(leaning);
    expect(ranking(learned)).not.toEqual(ranking(before));
    // Reset deletes the item.
    items.length = 0;
    const reset = await cast();
    expect(reset.configVersion).toBe('casting.v5');
    expect(ranking(reset)).toEqual(ranking(before));
  });

  it('applies to the alternates too', async () => {
    const plain = createCastingEngine({
      catalog: createMemoryShotCatalog(profiles),
      embedder: fakeEmbedder(new Map()),
      configSource: staticCastingConfig(),
    });
    const [, second] = template.slots;
    if (!second) throw new Error('the template has one slot');
    const request = {
      template,
      slotId: second.id,
      previous: null,
      next: null,
      used: [],
      exclude: [],
      limit: 6,
    };
    items.push(learnedItem(leaning));
    const learned = await engine.alternates(request);
    items.length = 0;
    const base = await plain.alternates(request);
    if (!learned.ok || !base.ok) throw new Error('alternates failed');
    expect(learned.value.map((c) => c.score)).not.toEqual(base.value.map((c) => c.score));
  });
});
