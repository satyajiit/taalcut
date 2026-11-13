// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Every casting number comes from the versioned config; the plan's fixed constants can't be tuned away. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import raw from '../config/casting.v5.json';
import { castingConfigSchema, CASTING_CONFIG } from '../src/casting/config';
import { createCastingEngine } from '../src/casting/engine';
import { createMemoryShotCatalog } from '../src/casting/catalog';
import { world } from './fixtures/casting';
import { fakeEmbedder } from './fixtures/library';

const source = join(import.meta.dirname, '..', 'src', 'casting');

describe('casting config', () => {
  it('loads v5 and pins the constants the plan fixes', () => {
    expect(CASTING_CONFIG.version).toBe('casting.v5');
    for (const [path, value] of [
      [['beam', 'width'], 9],
      [['candidates', 'k'], 40],
      [['confidence', 'alternates'], 4],
      [['rerank', 'count'], 6],
      [['variants', 'minDifference'], 0.25],
      [['variants', 'max'], 12],
      [['inPoint', 'beatToleranceFrames'], 2],
      [['inPoint', 'sampleMs'], 50],
    ] as const) {
      const changed = structuredClone(raw) as unknown as Record<string, Record<string, unknown>>;
      changed[path[0]]![path[1]] = value;
      expect(castingConfigSchema.safeParse(changed).success, path.join('.')).toBe(false);
    }
  });

  it('has no weight or threshold written in the casting code', () => {
    // config.ts is the schema itself: it pins the plan's fixed constants.
    for (const file of readdirSync(source).filter((name) => name.endsWith('.ts') && name !== 'config.ts')) {
      const code = readFileSync(join(source, file), 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*\*)/.test(line))
        .join('\n');
      expect(code.match(/(?<![\w.])\d*\.\d+(?![\w.])/g) ?? [], file).toEqual([]);
    }
  });

  it('changes the cast when the config changes', async () => {
    const { template, profiles } = world({ slots: 4, perSlot: 4, distractors: 10, seed: 2 });
    const table = new Map(template.slots.map((slot, index) => [slot.intent.text, profiles[index * 4]!.embedding]));
    const cast = async (config: typeof CASTING_CONFIG) => {
      const engine = createCastingEngine({ catalog: createMemoryShotCatalog(profiles), embedder: fakeEmbedder(table), config });
      const result = await engine.cast({ projectId: newId<'Project'>(), template, mode: 'template', variants: 1, seed: 1 });
      if (!result.ok) throw new Error(result.error.code);
      return result.value;
    };
    const base = await cast(CASTING_CONFIG);
    const qualityOnly = await cast({
      ...CASTING_CONFIG,
      version: 'casting.v99',
      weights: { intent: 0, motion: 0, quality: 1, subject: 0, energy: 0 },
    });
    expect(qualityOnly.configVersion).toBe('casting.v99');
    const score = (result: typeof base) => result.variants[0]!.slots[0]!.pick!;
    expect(score(qualityOnly).score).not.toBeCloseTo(score(base).score, 6);
  });
});
