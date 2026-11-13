// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UsageStore.summary (G8) over a seeded call log: totals with billed units, local days in the request's zone,
 * groups by module, provider and project (a run's calls count for its conversation's project, with the cap),
 * the filters, and refusals. The answer always parses with core's usageSummarySchema.
 */
import { newId, unwrap, usageSummarySchema, type Money, type UsageSummaryInput } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createLibraryPorts, createRepositories } from '../../src/index';
import { cloudCall } from '../fixtures/records';
import { openTestDb } from '../helpers';

const usd = (micros: number): Money => ({ currency: 'USD', micros });
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 12, 12);

async function seeded() {
  const db = openTestDb({ file: false });
  const repos = createRepositories(db);
  const ports = createLibraryPorts(db);
  const goa = unwrap(repos.projects.create({ name: 'Goa', budgetCap: usd(5_000_000) }));
  const delhi = unwrap(repos.projects.create({ name: 'Delhi' }));
  const chat = unwrap(repos.conversations.create({ projectId: goa.id }));
  const run = newId<'AgentRun'>();
  unwrap(await ports.conversations.linkRun(chat.id, run));
  const calls = [
    cloudCall({ startedAt: T0, costUsd: 0.5, inputTokens: 100, cachedInputTokens: 50, runId: run }),
    cloudCall({ startedAt: T0 + 1000, costUsd: 0.25, outputTokens: 10, projectId: delhi.id }),
    cloudCall({
      startedAt: T0 + DAY,
      module: 'voice',
      provider: 'elevenlabs',
      costUsd: 1,
      inputTokens: 0,
      outputTokens: 0,
      billed: { unit: 'character', quantity: 1200 },
      projectId: goa.id,
    }),
    cloudCall({
      startedAt: T0 + DAY + 1,
      module: 'voice',
      provider: 'elevenlabs',
      costUsd: 0.5,
      billed: { unit: 'character', quantity: 300 },
    }),
    cloudCall({ startedAt: T0 + 2 * DAY, module: 'vision', provider: 'local', local: true, costUsd: 0 }),
    // Outside the period.
    cloudCall({ startedAt: T0 + 10 * DAY, costUsd: 9 }),
  ];
  for (const call of calls) unwrap(await ports.cloudCalls.record(call));
  return { usage: ports.usage, goa, delhi };
}

const period = (overrides: Partial<UsageSummaryInput> = {}) => ({
  from: T0 - 6 * 3_600_000,
  to: T0 + 3 * DAY - 1,
  timeZone: 'UTC',
  ...overrides,
});

describe('UsageStore.summary', () => {
  it('totals the period, by day, module, provider and project', async () => {
    const { usage, goa, delhi } = await seeded();
    const summary = unwrap(await usage.summary(period()));
    expect(usageSummarySchema.safeParse(summary).success).toBe(true);
    expect(summary.totals).toMatchObject({
      calls: 5,
      localCalls: 1,
      inputTokens: 100 + 1000 * 3,
      cachedInputTokens: 50,
      costUsd: 2.25,
      bytesSent: 5 * 4096,
      units: { character: 1500 },
    });
    expect(summary.byDay.map((d) => [d.day, d.calls, d.costUsd])).toEqual([
      ['2026-10-12', 2, 0.75],
      ['2026-10-13', 2, 1.5],
      ['2026-10-14', 1, 0],
      ['2026-10-15', 0, 0],
    ]);
    expect(summary.byDay[1]?.byModule).toEqual({ voice: 1.5 });
    expect(summary.byModule.map((m) => [m.module, m.calls, m.costUsd])).toEqual([
      ['voice', 2, 1.5],
      ['agent', 2, 0.75],
      ['vision', 1, 0],
    ]);
    expect(summary.byModule[1]?.inputTokens).toBe(100 + 50 + 1000);
    expect(summary.byModule[0]?.units).toEqual({ character: 1500 });
    expect(summary.byProvider.map((p) => [p.provider, p.local, p.calls])).toEqual([
      ['elevenlabs', false, 2],
      ['openai', false, 2],
      ['local', true, 1],
    ]);
    expect(summary.byProject.map((p) => [p.projectId, p.costUsd, p.cap])).toEqual([
      [goa.id, 1.5, usd(5_000_000)],
      [null, 0.5, null],
      [delhi.id, 0.25, null],
    ]);
  });

  it('counts days in the request’s time zone', async () => {
    const { usage } = await seeded();
    // In Los Angeles (UTC-7) T0, 12:00 UTC, is 05:00 on the 12th; the first two calls stay on that day.
    const summary = unwrap(await usage.summary(period({ timeZone: 'America/Los_Angeles' })));
    expect(summary.byDay[0]?.day).toBe('2026-10-11');
    expect(summary.byDay.find((d) => d.day === '2026-10-12')?.calls).toBe(2);
  });

  it('filters by module, provider and project', async () => {
    const { usage, goa } = await seeded();
    const voice = unwrap(await usage.summary(period({ module: 'voice' })));
    expect(voice.totals.calls).toBe(2);
    const local = unwrap(await usage.summary(period({ provider: 'local' })));
    expect(local.byProvider).toHaveLength(1);
    const project = unwrap(await usage.summary(period({ projectId: goa.id })));
    expect(project.totals.calls).toBe(2);
    expect(project.byProject.map((p) => p.projectId)).toEqual([goa.id]);
  });

  it('answers an empty period with zero days filled in', async () => {
    const { usage } = await seeded();
    const empty = unwrap(await usage.summary(period({ from: T0 + 20 * DAY, to: T0 + 21 * DAY })));
    expect(empty.totals.calls).toBe(0);
    expect(empty.totals.units).toEqual({});
    expect(empty.byDay.every((d) => d.calls === 0)).toBe(true);
    expect(empty.byModule).toEqual([]);
  });

  it('refuses a reversed range and an unknown time zone', async () => {
    const { usage } = await seeded();
    const reversed = await usage.summary(period({ from: T0, to: T0 - 1 }));
    expect(reversed.ok ? null : reversed.error.code).toBe('core.validation');
    const zone = await usage.summary(period({ timeZone: 'Nowhere/Never' }));
    expect(zone.ok ? null : zone.error.params).toEqual({ field: 'timeZone' });
  });

  it('keeps billed units on the call log', async () => {
    const db = openTestDb({ file: false });
    const repos = createRepositories(db);
    const call = cloudCall({ billed: { unit: 'second', quantity: 12.5 } });
    unwrap(repos.cloudCalls.record(call));
    expect(repos.cloudCalls.list()[0]?.billed).toEqual({ unit: 'second', quantity: 12.5 });
    unwrap(repos.cloudCalls.record(cloudCall()));
    expect(repos.cloudCalls.list().filter((c) => c.billed === undefined)).toHaveLength(1);
  });
});
