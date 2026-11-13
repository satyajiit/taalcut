// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The request log's dashboard filters (round P3-3, G8): `from`, `provider` and `projectId` apply in SQL beside
 * `before` and `module`, pages hold exactly the matching rows, `totals` cover exactly them, and a call counts for
 * a project by the summary's rule (its own project, else its run's conversation's), so "Every request" lists the
 * calls the dashboard's summary counts.
 */
import { newId, unwrap, ValidationError, type CloudCallRecord, type UsageListInput } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createLibraryPorts, createRepositories } from '../../src/index';
import { cloudCall } from '../fixtures/records';
import { openTestDb } from '../helpers';

const T0 = Date.UTC(2026, 9, 12, 12);

async function seeded() {
  const db = openTestDb({ file: false });
  const repos = createRepositories(db);
  const ports = createLibraryPorts(db);
  const goa = unwrap(repos.projects.create({ name: 'Goa' }));
  const delhi = unwrap(repos.projects.create({ name: 'Delhi' }));
  const chat = unwrap(repos.conversations.create({ projectId: goa.id }));
  const run = newId<'AgentRun'>();
  unwrap(await ports.conversations.linkRun(chat.id, run));
  const calls: CloudCallRecord[] = [];
  for (let i = 0; i < 60; i++) {
    const project = i % 3 === 0 ? { projectId: goa.id } : i % 3 === 1 ? { projectId: delhi.id } : {};
    calls.push(
      cloudCall({
        // Two calls per millisecond, so pages keep same-millisecond calls together.
        startedAt: T0 + Math.floor(i / 2),
        provider: i % 2 === 0 ? 'anthropic' : 'elevenlabs',
        costUsd: (i % 5) / 100,
        inputTokens: i,
        // Every fourth unattributed call belongs to the Goa chat's run.
        ...(i % 3 === 2 && i % 4 === 0 ? { runId: run } : project),
      }),
    );
  }
  for (const call of calls) unwrap(await ports.cloudCalls.record(call));
  return { usage: ports.usage, calls, goa, delhi, run };
}

type Seeded = Awaited<ReturnType<typeof seeded>>;

/** Every page of a filter, and the first page's totals (later pages total what lies before their cursor). */
async function everyPage(usage: Seeded['usage'], input: UsageListInput) {
  const seen: CloudCallRecord[] = [];
  const first = unwrap(await usage.list(input));
  let page = first;
  for (let pages = 0; pages < 100; pages++) {
    seen.push(...page.records);
    if (page.nextBefore === undefined) return { seen, totals: first.totals };
    page = unwrap(await usage.list({ ...input, before: page.nextBefore }));
  }
  throw new Error('paging did not end');
}

const ids = (calls: readonly CloudCallRecord[]) => calls.map((call) => call.id).sort();

describe('UsageStore.list filters', () => {
  it('lists from the period start on, by provider, and totals only those rows', async () => {
    const { usage, calls } = await seeded();
    const from = T0 + 10;
    const before = T0 + 25;
    const wanted = calls.filter(
      (call) => call.startedAt >= from && call.startedAt < before && call.provider === 'anthropic',
    );
    const { seen, totals } = await everyPage(usage, { limit: 3, from, before, provider: 'anthropic' });
    expect(ids(seen)).toEqual(ids(wanted));
    expect(totals.calls).toBe(wanted.length);
    expect(totals.inputTokens).toBe(wanted.reduce((sum, call) => sum + call.inputTokens, 0));
    expect(totals.costUsd).toBeCloseTo(
      wanted.reduce((sum, call) => sum + call.costUsd, 0),
      6,
    );
  });

  it("counts a call for a project when it names it or when its run is the project's chat's", async () => {
    const { usage, calls, goa, delhi, run } = await seeded();
    const goaCalls = calls.filter((call) => call.projectId === goa.id || call.runId === run);
    expect(goaCalls.some((call) => call.runId === run)).toBe(true);
    const goaPages = await everyPage(usage, { limit: 4, projectId: goa.id });
    expect(ids(goaPages.seen)).toEqual(ids(goaCalls));
    expect(goaPages.totals.calls).toBe(goaCalls.length);
    const delhiPage = unwrap(await usage.list({ limit: 500, projectId: delhi.id }));
    expect(ids(delhiPage.records)).toEqual(ids(calls.filter((call) => call.projectId === delhi.id)));
    // The same rows the dashboard's summary counts for the project over the same period.
    const summary = unwrap(
      await usage.summary({ from: T0, to: T0 + 60, timeZone: 'UTC', projectId: goa.id }),
    );
    expect(summary.totals.calls).toBe(goaPages.totals.calls);
  });

  it('combines every filter', async () => {
    const { usage, calls, goa, run } = await seeded();
    const wanted = calls.filter(
      (call) =>
        (call.projectId === goa.id || call.runId === run) &&
        call.provider === 'anthropic' &&
        call.module === 'agent' &&
        call.startedAt >= T0 + 5,
    );
    const page = unwrap(
      await usage.list({ from: T0 + 5, provider: 'anthropic', module: 'agent', projectId: goa.id }),
    );
    expect(ids(page.records)).toEqual(ids(wanted));
    const none = unwrap(await usage.list({ provider: 'openai' }));
    expect(none.records).toEqual([]);
    expect(none.totals.calls).toBe(0);
  });

  it('refuses a period that ends before it starts, an empty provider and a project that is no id', async () => {
    const { usage } = await seeded();
    const cases: [unknown, string][] = [
      [{ from: T0 + 5, before: T0 + 5 }, 'before'],
      [{ from: -1 }, 'from'],
      [{ provider: '' }, 'provider'],
      [{ projectId: 'goa' }, 'projectId'],
    ];
    for (const [input, field] of cases) {
      const result = await usage.list(input as UsageListInput);
      expect(!result.ok && ValidationError.is(result.error) && result.error.params?.field).toBe(field);
    }
  });
});
