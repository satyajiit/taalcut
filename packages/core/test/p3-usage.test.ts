// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Settings › Usage's dashboard and the limits a run meets (G8), and the stream helper that serves them. */
import { describe, expect, it } from 'vitest';
import {
  cloudCallRecordSchema,
  latestValues,
  newId,
  ok,
  usageContract,
  usageLimitSchema,
  usageRouter,
  usageSummaryInputSchema,
  usageSummarySchema,
  UsageLimitsToken,
  type CloudCallRecord,
  type UsageLimit,
  type UsageLimits,
  type UsageStore,
  type UsageSummary,
} from '@taalcut/core';
import { serve } from './helpers/phase3';

const totals = { calls: 0, localCalls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0 };
const summary: UsageSummary = {
  from: 0,
  to: 86_400_000,
  totals: { ...totals, calls: 2, costUsd: 0.12, bytesSent: 4_000, units: { character: 1_240, image: 2 } },
  byDay: [{ day: '2026-10-14', costUsd: 0.12, calls: 2, byModule: { voice: 0.1, images: 0.02 } }],
  byModule: [
    { module: 'voice', calls: 1, inputTokens: 0, outputTokens: 0, costUsd: 0.1, units: { character: 1_240 } },
  ],
  byProvider: [
    {
      provider: 'elevenlabs',
      local: false,
      calls: 1,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0.1,
      units: {},
    },
  ],
  byProject: [
    { projectId: null, cap: null, calls: 2, inputTokens: 0, outputTokens: 0, costUsd: 0.12, units: {} },
  ],
};
const limit: UsageLimit = {
  provider: 'openai',
  model: 'gpt-5.2',
  modules: ['agent'],
  kind: 'quota',
  since: 1,
  resetsAt: null,
  waiting: ['run'],
  billingUrl: 'https://platform.openai.com/settings/organization/billing',
};
const input = { from: 0, to: 86_400_000, timeZone: 'Asia/Kolkata' };
const page = { records: [], totals };

function fakeLimits(initial: readonly UsageLimit[]) {
  let current = initial;
  const listeners = new Set<(limits: readonly UsageLimit[]) => void>();
  const limits: UsageLimits = {
    current: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const set = (next: readonly UsageLimit[]) => {
    current = next;
    for (const listener of listeners) listener(next);
  };
  return { limits, set, listeners };
}

describe('usage summary and limits', () => {
  it('describes spend by day, module, provider and project, with billed units', () => {
    expect(usageSummarySchema.parse(summary)).toEqual(summary);
    expect(
      usageSummarySchema.safeParse({ ...summary, byDay: [{ ...summary.byDay[0], day: '14/10' }] }).success,
    ).toBe(false);
    expect(usageSummaryInputSchema.safeParse({ ...input, from: 2, to: 1 }).success).toBe(false);
    expect(usageLimitSchema.safeParse({ ...limit, billingUrl: 'http://example.com' }).success).toBe(false);
    expect(UsageLimitsToken.key).toBe('core.usageLimits');
  });

  it('keeps billed quantities on a cloud call', () => {
    const record: CloudCallRecord = cloudCallRecordSchema.parse({
      id: newId<'CloudCall'>(),
      module: 'voice',
      provider: 'elevenlabs',
      model: 'eleven_v3',
      reasoning: 'off',
      local: false,
      startedAt: 1,
      latencyMs: 2,
      bytesSent: 10,
      bytesReceived: 20,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.1,
      outcome: 'ok',
      attempt: 1,
      billed: { unit: 'character', quantity: 1_240 },
    });
    expect(record.billed).toEqual({ unit: 'character', quantity: 1_240 });
  });

  it('answers not-implemented until the store and the models client serve them', async () => {
    const store: UsageStore = { list: async () => ok(page) };
    const client = serve(usageContract, usageRouter(store));
    await expect(client.summary(input)).rejects.toMatchObject({
      data: { code: 'core.not_implemented', params: { feature: 'usage.summary' } },
    });
    await expect(client.limits()).rejects.toMatchObject({ data: { code: 'core.not_implemented' } });
    await expect(client.limitsChanged()).rejects.toMatchObject({ data: { code: 'core.not_implemented' } });
  });

  it('serves the summary from the store and the limits as they change', async () => {
    const asked: unknown[] = [];
    const store: UsageStore = {
      list: async () => ok(page),
      summary: async (request) => {
        asked.push(request);
        return ok(summary);
      },
    };
    const { limits, set, listeners } = fakeLimits([limit]);
    const client = serve(usageContract, usageRouter(store, limits));
    expect(await client.summary({ ...input, module: 'voice' })).toEqual(summary);
    expect(asked).toEqual([{ ...input, module: 'voice' }]);
    expect(await client.limits()).toEqual([limit]);

    const stop = new AbortController();
    const stream = await client.limitsChanged(undefined, { signal: stop.signal });
    const seen: (readonly UsageLimit[])[] = [];
    for await (const next of stream) {
      seen.push(next);
      if (seen.length === 1) set([]);
      else break;
    }
    stop.abort();
    expect(seen).toEqual([[limit], []]);
    await expect.poll(() => listeners.size).toBe(0);
  });
});

describe('latestValues', () => {
  it('yields the current value, then only the latest of several changes, until aborted', async () => {
    let listener: ((value: number) => void) | undefined;
    let unsubscribed = false;
    const stop = new AbortController();
    const values = latestValues(
      () => 1,
      (next) => {
        listener = next;
        return () => {
          unsubscribed = true;
        };
      },
      stop.signal,
    );
    expect((await values.next()).value).toBe(1);
    const waiting = values.next();
    listener?.(2);
    listener?.(3);
    expect((await waiting).value).toBe(3);
    const ended = values.next();
    stop.abort();
    expect((await ended).done).toBe(true);
    expect(unsubscribed).toBe(true);
  });

  it('ends at once when the signal is already aborted', async () => {
    const stop = new AbortController();
    stop.abort();
    const values = latestValues(
      () => 1,
      () => () => undefined,
      stop.signal,
    );
    expect((await values.next()).done).toBe(true);
  });
});
