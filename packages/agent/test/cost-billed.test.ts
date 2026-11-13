// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Review M8: a paid image, voice or music line said "0 tokens" beside its money, because nothing carried what the
 * provider bills. A tool's estimate names it (`billed`), the estimate line keeps it, and the cost card shows it.
 */
import {
  cardSchema,
  defineTool,
  defineToolModule,
  newId,
  NO_TOOL_RETRY,
  ok,
  unwrap,
  type RunId,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { stepCostCard } from '../src/chat-cards';
import { mergeLines } from '../src/costs';
import type { EstimateLine } from '../src/flow-events';
import { call, harness, ofType, plan, turns } from './support/harness';

const stills = defineToolModule({
  id: 'images',
  tools: [
    defineTool({
      name: 'images.generate',
      version: '1.0.0',
      description: 'Generates two stills.',
      input: z.object({ prompt: z.string() }),
      output: z.object({ made: z.int() }),
      costClass: 'paid',
      sideEffect: 'read',
      timeoutMs: 2_000,
      retry: NO_TOOL_RETRY,
      permission: { network: 'internet', cloudModules: ['images'] },
      estimateCost: () => ({ usd: 0.08, billed: { unit: 'image', quantity: 2 } }),
      run: async (_input, ctx) => {
        ctx.reportUsage({ usd: 0.08 });
        return ok({ made: 2 });
      },
    }),
  ],
});

const line = (module: EstimateLine['module'], extra: Partial<EstimateLine> = {}): EstimateLine => ({
  module,
  provider: 'p',
  model: 'm',
  local: false,
  tokens: 0,
  usd: 0.04,
  ...extra,
});

describe('what a paid line bills', () => {
  it('goes from the tool estimate to the estimate line to the cost card', async () => {
    const h = harness({
      modules: [stills],
      script: turns(
        plan('Make stills'),
        { toolCalls: [call('images_generate', { prompt: 'dusk' })] },
        {
          text: 'Made two stills.',
        },
      ),
    });
    const done = unwrap(await h.agent.run({ conversationId: 'c', message: 'stills' }));
    const recorded = ofType(await h.events(done.runId), 'estimate.recorded')[0]?.payload;
    expect(recorded?.lines).toEqual([
      expect.objectContaining({ module: 'images', usd: 0.08, billed: { unit: 'image', quantity: 2 } }),
    ]);
    if (!recorded) return;
    const card = stepCostCard(newId<'AgentRun'>() as RunId, null, recorded, { usd: 0.08, tokens: 0 });
    expect(cardSchema.safeParse(card).success).toBe(true);
    expect(card).toMatchObject({ lines: [{ billed: { unit: 'image', quantity: 2 } }] });
  });

  it('adds up on one module when the units match, and falls back to tokens when they differ', () => {
    const seconds = { unit: 'second', quantity: 182 } as const;
    expect(
      mergeLines([
        line('music', { billed: seconds }),
        line('music', { billed: { unit: 'second', quantity: 2 } }),
      ]).lines,
    ).toEqual([expect.objectContaining({ usd: 0.08, billed: { unit: 'second', quantity: 184 } })]);
    const mixed = mergeLines([line('music', { billed: seconds }), line('music', { tokens: 900 })]).lines;
    expect(mixed).toHaveLength(1);
    expect(mixed[0]).not.toHaveProperty('billed');
    expect(mixed[0]?.tokens).toBe(900);
  });
});
