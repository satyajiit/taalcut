// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A month of cloud calls for Settings › Usage's dashboard (G8): the agent most days, descriptions on import days,
 * speech and voice billed in characters and seconds, generated images by the image, across the fake's projects.
 * Deterministic (a seeded generator), so screenshots and tests see the same month.
 */
import { newId, type Billed, type CloudCallRecord, type ModelModuleId, type ProjectId } from '@taalcut/core';
import { prng } from '../library/seed';
import { GOLDEN_PROJECT, TEASER_PROJECT, TRIP_PROJECT } from '../make/ids';
import { ON_DEVICE } from '../fake-model-data';

const DAY = 86_400_000;

interface Kind {
  readonly module: ModelModuleId;
  readonly provider: string;
  readonly model: string;
  /** Calls a day, when this kind runs that day. */
  readonly perDay: number;
  /** Share of days it runs. */
  readonly days: number;
  readonly cost: number;
  readonly tokens?: readonly [input: number, output: number];
  readonly billed?: (random: () => number) => Billed;
}

const KINDS: readonly Kind[] = [
  {
    module: 'agent',
    provider: 'openai',
    model: 'gpt-5.4',
    perDay: 6,
    days: 0.8,
    cost: 0.024,
    tokens: [12_000, 900],
  },
  {
    module: 'agent',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    perDay: 2,
    days: 0.3,
    cost: 0.06,
    tokens: [18_000, 1_400],
  },
  {
    module: 'router',
    provider: 'cloudflare-workers-ai',
    model: '@cf/cloudflare/clef-flash',
    perDay: 8,
    days: 0.8,
    cost: 0.000_03,
    tokens: [600, 4],
  },
  {
    module: 'vision',
    provider: ON_DEVICE,
    model: 'qwen3.5-4b',
    perDay: 30,
    days: 0.35,
    cost: 0,
    tokens: [2_300, 90],
  },
  {
    module: 'vision',
    provider: 'google',
    model: 'gemini-3-flash',
    perDay: 20,
    days: 0.2,
    cost: 0.0011,
    tokens: [1_900, 80],
  },
  {
    module: 'speech',
    provider: 'elevenlabs',
    model: 'scribe_v2',
    perDay: 2,
    days: 0.3,
    cost: 0.016,
    billed: (random) => ({ unit: 'second', quantity: Math.round(40 + random() * 80) }),
  },
  {
    module: 'voice',
    provider: 'elevenlabs',
    model: 'eleven_v4',
    perDay: 1,
    days: 0.15,
    cost: 0.034,
    billed: (random) => ({ unit: 'character', quantity: Math.round(300 + random() * 600) }),
  },
  {
    module: 'images',
    provider: 'openrouter',
    model: 'openai/gpt-image-1',
    perDay: 2,
    days: 0.12,
    cost: 0.042,
    billed: () => ({ unit: 'image', quantity: 1 }),
  },
];

const PROJECTS: readonly (ProjectId | undefined)[] = [
  GOLDEN_PROJECT,
  TRIP_PROJECT,
  TEASER_PROJECT,
  undefined,
];

/** One call of `kind` on the day starting at `dayStart`; draws from `random` in a fixed order (the month stays the same). */
function oneCall(
  kind: Kind,
  dayStart: number,
  projectId: ProjectId | undefined,
  random: () => number,
): CloudCallRecord {
  const [input, output] = kind.tokens ?? [0, 0];
  const local = kind.provider === ON_DEVICE;
  const latencyMs = Math.round(400 + random() * 4_000);
  return {
    id: newId<'CloudCall'>(),
    module: kind.module,
    provider: kind.provider,
    model: kind.model,
    reasoning: kind.module === 'agent' ? 'medium' : 'off',
    local,
    startedAt: Math.round(dayStart + (9 + random() * 12) * 3_600_000),
    latencyMs,
    bytesSent: sentBytes(local, input, latencyMs),
    bytesReceived: output * 4,
    inputTokens: input,
    outputTokens: output,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    costUsd: Math.round(kind.cost * (0.7 + random() * 0.6) * 1e6) / 1e6,
    outcome: 'ok',
    attempt: 1,
    ...(projectId ? { projectId } : {}),
    ...(kind.billed ? { billed: kind.billed(random) } : {}),
  };
}

/** Nothing leaves the Mac for a local call; a billed call sends about its length's worth. */
function sentBytes(local: boolean, input: number, latencyMs: number): number {
  if (local) return 0;
  return input > 0 ? input * 4 : latencyMs * 40;
}

/** The calls `kind` made that day: none on most of its quiet days, else around its daily count, one project each. */
function dayCalls(kind: Kind, dayStart: number, random: () => number): CloudCallRecord[] {
  if (random() > kind.days) return [];
  const calls = Math.max(1, Math.round(kind.perDay * (0.5 + random())));
  const projectId = PROJECTS[Math.floor(random() * PROJECTS.length)];
  return Array.from({ length: calls }, () => oneCall(kind, dayStart, projectId, random));
}

/** Thirty days before `now` (yesterday back), so the seed's last two days stay as they were. */
export function usageHistory(now: number): CloudCallRecord[] {
  const random = prng(4242);
  const records: CloudCallRecord[] = [];
  for (let daysAgo = 30; daysAgo >= 2; daysAgo -= 1) {
    const dayStart = now - daysAgo * DAY;
    for (const kind of KINDS) records.push(...dayCalls(kind, dayStart, random));
  }
  return records;
}
