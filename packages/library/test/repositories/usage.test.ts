// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Settings → Usage over 10k cloud calls: keyset pages, module filter, totals, indexes. */
import { unwrap, ValidationError, type CloudCallRecord, type ModelModuleId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createLibraryPorts, createRepositories } from '../../src/index';
import { cloudCall } from '../fixtures/records';
import { openTestDb } from '../helpers';

const MODULES: readonly ModelModuleId[] = ['agent', 'vision', 'router'];
const T0 = Date.UTC(2026, 9, 1);

/** 10k calls over 2,000 distinct milliseconds (five per millisecond), across three modules. */
function seeded() {
  const db = openTestDb({ file: false });
  const repos = createRepositories(db);
  const calls: CloudCallRecord[] = [];
  db.transaction(() => {
    for (let i = 0; i < 10_000; i++) {
      const call = cloudCall({
        module: MODULES[i % 3]!,
        startedAt: T0 + Math.floor(i / 5) * 1000,
        inputTokens: i % 97,
        outputTokens: i % 13,
        cachedInputTokens: i % 7,
        costUsd: (i % 11) / 1000,
        local: i % 10 === 0,
      });
      unwrap(repos.cloudCalls.record(call));
      calls.push(call);
    }
  });
  return { db, usage: createLibraryPorts(db).usage, calls };
}

const newestFirst = (a: CloudCallRecord, b: CloudCallRecord) =>
  b.startedAt - a.startedAt || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0);

async function pageThrough(usage: ReturnType<typeof seeded>['usage'], limit: number, module?: ModelModuleId) {
  const seen: CloudCallRecord[] = [];
  let before: number | undefined;
  for (let pages = 0; pages < 1000; pages++) {
    const page = unwrap(
      await usage.list({ limit, ...(before === undefined ? {} : { before }), ...(module ? { module } : {}) }),
    );
    seen.push(...page.records);
    if (page.nextBefore === undefined) return seen;
    expect(page.records.length).toBeGreaterThanOrEqual(limit);
    before = page.nextBefore;
  }
  throw new Error('paging did not end');
}

describe('UsageStore', () => {
  it('pages through 10k calls newest first, each exactly once, even across same-millisecond calls', async () => {
    const { usage, calls } = seeded();
    for (const limit of [500, 333]) {
      const seen = await pageThrough(usage, limit);
      expect(seen.map((c) => c.id)).toEqual([...calls].sort(newestFirst).map((c) => c.id));
    }
    const agentOnly = await pageThrough(usage, 250, 'agent');
    expect(agentOnly).toHaveLength(calls.filter((c) => c.module === 'agent').length);
    expect(agentOnly.every((c) => c.module === 'agent')).toBe(true);
  });

  it('totals every call matching the filter, not just the page', async () => {
    const { usage, calls } = seeded();
    const sum = (rows: CloudCallRecord[], pick: (c: CloudCallRecord) => number) =>
      rows.reduce((n, c) => n + pick(c), 0);
    const expectTotals = (rows: CloudCallRecord[]) => ({
      calls: rows.length,
      localCalls: rows.filter((c) => c.local).length,
      inputTokens: sum(rows, (c) => c.inputTokens),
      outputTokens: sum(rows, (c) => c.outputTokens),
      cachedInputTokens: sum(rows, (c) => c.cachedInputTokens),
    });
    const first = unwrap(await usage.list({ limit: 10 }));
    expect(first.records).toHaveLength(10);
    expect(first.totals).toMatchObject(expectTotals(calls));
    expect(first.totals.costUsd).toBeCloseTo(
      sum(calls, (c) => c.costUsd),
      6,
    );
    const before = T0 + 1_000 * 1_000;
    const vision = unwrap(await usage.list({ limit: 10, module: 'vision', before }));
    expect(vision.totals).toMatchObject(
      expectTotals(calls.filter((c) => c.module === 'vision' && c.startedAt < before)),
    );
    const none = unwrap(await usage.list({ before: T0 }));
    expect(none).toEqual({
      records: [],
      totals: { calls: 0, localCalls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0 },
    });
  });

  it('pages and totals with an index, and validates its input', async () => {
    const { db, usage } = seeded();
    const plan = (sql: string) =>
      db.driver
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all()
        .map((row) => String(row.detail))
        .join('; ');
    expect(
      plan('SELECT * FROM cloud_calls WHERE started_at < 1 ORDER BY started_at DESC, id DESC LIMIT 101'),
    ).toMatch(/USING INDEX cloud_calls_started_idx/);
    expect(
      plan(
        "SELECT * FROM cloud_calls WHERE module = 'agent' AND started_at < 1 ORDER BY started_at DESC, id DESC LIMIT 101",
      ),
    ).toMatch(/USING INDEX cloud_calls_module_idx/);
    for (const bad of [{ limit: 0 }, { limit: 501 }, { limit: 1.5 }, { before: -1 }]) {
      const result = await usage.list(bad);
      expect(!result.ok && ValidationError.is(result.error)).toBe(true);
    }
    const t0 = performance.now();
    unwrap(await usage.list({ limit: 500 }));
    process.stdout.write(
      `[usage] first page of 500 with totals over 10k calls: ${(performance.now() - t0).toFixed(1)} ms\n`,
    );
  });
});
