// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Template fit reads casting's config per call (LRN1-PREF): learned weights that change while the process runs
 * rank the next fit, and the result says which weights ranked it.
 */
import { fitTemplatesInputSchema, ok, type CastingWeights } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { CASTING_CONFIG } from '../../src/casting/config';
import type { CastingConfigSource, ResolvedCastingConfig } from '../../src/casting/learned/config-source';
import { createTemplateFitter } from '../../src/fit/fit-templates';
import { fitWorld, nth, shot, themed } from './fit-world';

const input = () => fitTemplatesInputSchema.parse({ pool: { capturedFrom: 0 } });

describe('template fit through the resolved casting config', () => {
  it('ranks with the weights the source holds at each call and reports their label', async () => {
    const pool = [1, 2, 3].map((seed) => shot('beach', seed, { quality: 0.95 }));
    const world = await fitWorld([{ template: themed(['beach', 'beach']) }], pool);
    let current: ResolvedCastingConfig = {
      config: CASTING_CONFIG,
      weights: { source: 'default', values: CASTING_CONFIG.weights },
      label: CASTING_CONFIG.version,
    };
    const source: CastingConfigSource = { resolve: async () => ok(current) };
    const fitter = createTemplateFitter({
      profiles: world.catalog,
      templates: world.store,
      vectors: async () => ok(world.vectors),
      config: source,
    });
    const first = await fitter.fitTemplates(input());
    if (!first.ok) throw new Error(first.error.code);
    expect(first.value.configVersion).toBe('casting.v5');

    const qualityFirst: CastingWeights = {
      intent: 0.2,
      motion: 0.15,
      quality: 0.3,
      subject: 0.15,
      energy: 0.2,
    };
    current = {
      config: { ...CASTING_CONFIG, weights: qualityFirst },
      weights: { source: 'default', values: qualityFirst },
      label: 'casting.v5+learned@42',
    };
    const second = await fitter.fitTemplates(input());
    if (!second.ok) throw new Error(second.error.code);
    expect(second.value.configVersion).toBe('casting.v5+learned@42');
    expect(nth(second.value.fits, 0).meanScore).not.toBeCloseTo(nth(first.value.fits, 0).meanScore ?? 0, 6);
  });
});
