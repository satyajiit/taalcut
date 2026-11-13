// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A fake cloud-call log (the library's CloudCall table, P1-F5), seeded with a few days of calls. `mode` is for
 * Settings › Usage's states: `empty` (nothing ever called a model), `slow` (reads take 1.5 s, to see the
 * skeleton) and `failing` (reads fail, to see Try again).
 */
import {
  newId,
  TimeoutError,
  toRpcError,
  type CloudCallRecord,
  type ModelModuleId,
  type UsageListInput,
  type UsagePage,
} from '@taalcut/core';
import { ON_DEVICE } from './fake-model-data';

export const USAGE_MODES = ['empty', 'slow', 'failing'] as const;
export type FakeUsageMode = (typeof USAGE_MODES)[number];

const SLOW_MS = 1_500;

export interface FakeUsage {
  /** What the usage namespace's reads wait for first: a delay (slow), a failure (failing), else nothing. */
  settle(): Promise<void>;
  record(record: CloudCallRecord): void;
  /** Every row, oldest first (the dashboard's summary aggregates them, as the library does in SQL). */
  all(): readonly CloudCallRecord[];
  /**
   * A page of the log, newest first, as the library's repository reads it: every filter (period start, cursor,
   * job, provider, project) applies to the rows and to `totals`; a page ends after every call from its last
   * millisecond, so the next page starts strictly before it.
   */
  list(input: UsageListInput): UsagePage;
}

type Seed = [
  module: ModelModuleId,
  provider: string,
  model: string,
  minutesAgo: number,
  tokens: [input: number, output: number, cached: number],
  costUsd: number,
  latencyMs: number,
];

const SEED: readonly Seed[] = [
  ['agent', 'openai', 'gpt-5.4', 18, [14_210, 1_120, 9_800], 0.0291, 3_420],
  ['router', 'cloudflare-workers-ai', '@cf/cloudflare/clef-flash', 19, [640, 4, 0], 0.000_024, 41],
  ['vision', ON_DEVICE, 'qwen3.5-4b', 26, [2_380, 96, 0], 0, 1_860],
  ['speech', 'elevenlabs', 'scribe_v2', 74, [0, 0, 0], 0.0183, 6_120],
  ['agent', 'openai', 'gpt-5.4', 76, [9_904, 840, 0], 0.0208, 2_710],
  ['images', 'openrouter', 'openai/gpt-image-1', 1_460, [312, 0, 0], 0.042, 11_300],
  ['agent', 'anthropic', 'claude-sonnet-5', 1_470, [22_013, 1_904, 18_000], 0.0947, 5_840],
  ['voice', 'elevenlabs', 'eleven_v4', 2_900, [0, 0, 0], 0.0336, 2_240],
];

export function createFakeUsage(
  now: () => number,
  more: (now: number) => readonly CloudCallRecord[] = () => [],
  mode?: FakeUsageMode,
): FakeUsage {
  const seed = mode === 'empty' ? [] : SEED;
  const records: CloudCallRecord[] = seed.map(
    ([module, provider, model, minutesAgo, [inputTokens, outputTokens, cached], costUsd, latencyMs]) => ({
      id: newId<'CloudCall'>(),
      module,
      provider,
      model,
      reasoning: module === 'agent' ? 'medium' : 'off',
      local: provider === ON_DEVICE,
      startedAt: now() - minutesAgo * 60_000,
      latencyMs,
      // Speech and voice send audio or a script, not tokens: about 40 kB a second of the call.
      bytesSent: inputTokens > 0 ? inputTokens * 4 : latencyMs * 40,
      bytesReceived: outputTokens * 4,
      inputTokens: inputTokens - cached,
      outputTokens,
      cachedInputTokens: cached,
      cacheWriteTokens: 0,
      costUsd,
      outcome: 'ok',
      attempt: 1,
    }),
  );
  if (mode !== 'empty') records.push(...more(now()));

  return {
    async settle() {
      if (mode === 'slow') await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
      if (mode === 'failing') throw toRpcError(TimeoutError({ ms: 30_000 }));
    },
    record: (record) => void records.push(record),
    all: () => [...records].sort((a, b) => a.startedAt - b.startedAt),
    list({ limit = 100, before, from, module, provider, projectId }) {
      const matching = records
        .filter(
          (r) =>
            (from === undefined || r.startedAt >= from) &&
            (before === undefined || r.startedAt < before) &&
            (module === undefined || r.module === module) &&
            (provider === undefined || r.provider === provider) &&
            (projectId === undefined || r.projectId === projectId),
        )
        .sort((a, b) => b.startedAt - a.startedAt);
      const boundary = matching.length > limit ? matching[limit - 1]?.startedAt : undefined;
      const page = boundary === undefined ? matching : matching.filter((r) => r.startedAt >= boundary);
      const sum = (pick: (r: CloudCallRecord) => number) => matching.reduce((total, r) => total + pick(r), 0);
      return {
        records: page,
        totals: {
          calls: matching.length,
          localCalls: matching.filter((r) => r.local).length,
          inputTokens: sum((r) => r.inputTokens),
          outputTokens: sum((r) => r.outputTokens),
          cachedInputTokens: sum((r) => r.cachedInputTokens),
          costUsd: sum((r) => r.costUsd),
        },
        ...(boundary === undefined ? {} : { nextBefore: boundary }),
      };
    },
  };
}
