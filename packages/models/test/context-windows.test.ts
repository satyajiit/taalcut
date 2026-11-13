// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Context windows by tier (LRN1-CTX, SPEC "Context windows by tier"): computed from llama-server's measured
 * footprints with the q8_0 KV cache the sidecar runs. Each tier gets the largest measured window whose peak, beside
 * the embedder, fits the share of its memory floor spike 08 gave the Recommended tier's models (the 4B with its
 * projector at 8,192 with an f16 cache).
 */
import { describe, expect, it } from 'vitest';
import {
  contextWindowFor,
  KV_CACHE_TYPE,
  llamaCppRuntimeSpec,
  llamaServerArgs,
  localModelBudgetBytes,
  MEASURED_EMBEDDER_BYTES,
  MEASURED_PEAK_BYTES,
  RECOMMENDED_SHARE_SIDECAR_BYTES,
  SMALLEST_LOCAL_WINDOW,
  type HardwareTier,
} from '../src/index';
import { HOST_PROMPT_CACHE_MIB, MEASURED_HOST_CACHE_BYTES } from '../src/local-runtime/llama-cpp-spec';

const TIERS: readonly [HardwareTier, string][] = [
  ['minimum', 'qwen3.5-0.8b'],
  ['recommended', 'qwen3.5-4b'],
  ['high', 'qwen3.5-4b'],
];
const measured = (model: string) => new Map(Object.entries(MEASURED_PEAK_BYTES[model] ?? {}));
const peak = (model: string, window: number) =>
  (measured(model).get(String(window)) ?? Infinity) + MEASURED_EMBEDDER_BYTES;

describe('context windows by tier', () => {
  it('gives each tier the window its measured footprint allows', () => {
    expect(TIERS.map(([tier]) => contextWindowFor(tier))).toEqual([32_768, 12_288, 32_768]);
  });

  it("budgets every tier at spike 08's share: the 4B at 8,192 with an f16 cache, beside the embedder", () => {
    expect(localModelBudgetBytes('recommended')).toBe(
      RECOMMENDED_SHARE_SIDECAR_BYTES + MEASURED_EMBEDDER_BYTES,
    );
    expect(localModelBudgetBytes('minimum')).toBe(localModelBudgetBytes('recommended') / 2);
    expect(localModelBudgetBytes('high')).toBe(localModelBudgetBytes('recommended') * 2);
    // The q8_0 cache is what frees the room: the same 4B at 8,192 now peaks lower than the share.
    expect(peak('qwen3.5-4b', 8_192)).toBeLessThan(localModelBudgetBytes('recommended'));
  });

  it('takes the largest window that fits, and the next one measured would not', () => {
    for (const [tier, model] of TIERS) {
      const window = contextWindowFor(tier);
      expect(peak(model, window), tier).toBeLessThanOrEqual(localModelBudgetBytes(tier));
      const next = [...measured(model).keys()].map(Number).find((at) => at > window);
      if (next) expect(peak(model, next), tier).toBeGreaterThan(localModelBudgetBytes(tier));
    }
  });

  it('counts the host prompt cache in the budget: High keeps 32,768 with its 1 GiB (AGT1)', () => {
    const cache = MEASURED_HOST_CACHE_BYTES[HOST_PROMPT_CACHE_MIB.high]!;
    expect(cache).toBeGreaterThan(1024 ** 3);
    expect(peak('qwen3.5-4b', 32_768) + cache).toBeLessThanOrEqual(localModelBudgetBytes('high'));
    expect(contextWindowFor('high')).toBe(32_768);
    expect(HOST_PROMPT_CACHE_MIB.recommended).toBe(0);
  });

  it('never gives a tier less than the smallest local window', () => {
    for (const [tier] of TIERS)
      expect(contextWindowFor(tier), tier).toBeGreaterThanOrEqual(SMALLEST_LOCAL_WINDOW);
  });

  it("serves each tier's model at that window, with the cache it was measured with", () => {
    for (const [tier, model] of TIERS) {
      const served = llamaCppRuntimeSpec(tier).models.find((m) => m.id === model);
      expect(served?.contextWindow, tier).toBe(contextWindowFor(tier));
      if (!served) continue;
      const args = llamaServerArgs({ model: served, weights: '/w.gguf', port: 4100, backend: 'metal' });
      expect(args[args.indexOf('--ctx-size') + 1], tier).toBe(String(contextWindowFor(tier)));
      expect(args[args.indexOf('--cache-type-k') + 1], tier).toBe(KV_CACHE_TYPE);
      expect(args[args.indexOf('--cache-type-v') + 1], tier).toBe(KV_CACHE_TYPE);
    }
  });
});
