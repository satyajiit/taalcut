// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The HyperFrames fixtures (HFW1 hf): twelve made-up compositions, one per family of what the lowering takes, each
 * passing the gate (HyperFrames' own lint included) and lowering to motion data.
 */
import { describe, expect, it } from 'vitest';
import { HF_FIXTURES } from './fixture-list';
import { gatedFixture } from './support';

describe('the HyperFrames fixtures', () => {
  it.each(HF_FIXTURES)('%s passes the gate and lowers', async (name) => {
    const prepared = await gatedFixture(`${name}.html`);
    expect(prepared.motion.tweens.length).toBeGreaterThan(0);
    for (const tween of prepared.motion.tweens) expect(tween.at).toBeGreaterThanOrEqual(0);
  });
});
