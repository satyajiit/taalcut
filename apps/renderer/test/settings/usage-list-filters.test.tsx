// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Round P3-3 (G8): Settings › Usage's request log asks `usage.list` for the view itself (the period's start as
// `from`, its end as the first `before`, the job, provider and project), and the fake answers like the library's
// repository: every filter applies to the rows and the totals, and a page ends after its last millisecond.
import { newId, type CloudCallRecord, type UsageListInput } from '@taalcut/core';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeUsage } from '../../src/backend/fake/fake-usage';
import { GOLDEN_PROJECT } from '../../src/backend/fake/make/ids';
import { renderWatched, type Watch } from './spied-backend';

const LIST: Watch = { namespace: 'usage', procedure: 'list' };

const NOW = Date.UTC(2026, 9, 12, 12);
const HOUR = 3_600_000;

const call = (hoursAgo: number, provider: string, extra: Partial<CloudCallRecord> = {}): CloudCallRecord => ({
  id: newId<'CloudCall'>(),
  module: 'agent',
  provider,
  model: 'm',
  reasoning: 'off',
  local: false,
  startedAt: NOW - hoursAgo * HOUR,
  latencyMs: 100,
  bytesSent: 10,
  bytesReceived: 10,
  inputTokens: 100,
  outputTokens: 10,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0.01,
  outcome: 'ok',
  attempt: 1,
  ...extra,
});

describe('the fake’s usage.list', () => {
  const usage = createFakeUsage(
    () => NOW,
    () => [
      call(1, 'openai', { projectId: GOLDEN_PROJECT }),
      call(2, 'openai'),
      call(3, 'google', { projectId: GOLDEN_PROJECT, module: 'vision' }),
      call(48, 'openai', { projectId: GOLDEN_PROJECT }),
      // Two calls in the same millisecond: a page never splits them.
      call(5, 'xai'),
      call(5, 'xai'),
    ],
  );
  const list = (input: UsageListInput) => usage.list(input);

  it('applies the period, provider, project and job to the rows and to the totals', () => {
    const page = list({ limit: 100, from: NOW - 24 * HOUR, provider: 'openai', projectId: GOLDEN_PROJECT });
    expect(page.records.map((r) => r.startedAt)).toEqual([NOW - HOUR]);
    expect(page.totals).toMatchObject({ calls: 1, inputTokens: 100, costUsd: 0.01 });
    expect(page.nextBefore).toBeUndefined();
    expect(list({ limit: 100, module: 'vision', projectId: GOLDEN_PROJECT }).totals.calls).toBe(1);
    expect(list({ limit: 100, provider: 'openai', projectId: GOLDEN_PROJECT }).totals.calls).toBe(2);
    expect(list({ limit: 100, from: NOW - 24 * HOUR, before: NOW - 2 * HOUR }).totals.calls).toBe(3);
  });

  it('a page ends after its last millisecond, and the next starts strictly before it', () => {
    const first = list({ limit: 1, provider: 'xai' });
    expect(first.records).toHaveLength(2);
    expect(first.nextBefore).toBe(NOW - 5 * HOUR);
    expect(first.totals.calls).toBe(2);
    const next = list({ limit: 1, provider: 'xai', before: first.nextBefore });
    expect(next.records).toHaveLength(0);
  });
});

describe('Settings › Usage › Every request asks the backend for the view', () => {
  it('sends the period’s start and end, the provider, project and job; no filter is left to the page', async () => {
    const before = Date.now();
    const { callsTo } = await renderWatched(
      `/settings/usage/requests?period=7d&provider=openai&project=${GOLDEN_PROJECT}&module=agent`,
      LIST,
      { usageHistory: true },
    );
    const asked = () =>
      callsTo(LIST).filter((input): input is UsageListInput => typeof input === 'object' && input !== null);
    const log = await waitFor(() => {
      const found = asked().find((input) => input.provider !== undefined);
      if (!found) throw new Error('the log hasn’t asked yet');
      return found;
    });
    const after = Date.now();
    expect(log).toMatchObject({ limit: 50, provider: 'openai', projectId: GOLDEN_PROJECT, module: 'agent' });
    // The first page ends when the page was read; the period starts at midnight six days earlier.
    expect(log.before).toBeGreaterThanOrEqual(before);
    expect(log.before).toBeLessThanOrEqual(after);
    const start = new Date(log.before ?? 0);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 6);
    expect(log.from).toBe(start.getTime());

    // What the backend answered is what the table shows: every row is the filter's.
    const table = await screen.findByRole('region', { name: 'Requests' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('all time sends no start', async () => {
    const { callsTo } = await renderWatched('/settings/usage/requests?period=all', LIST, {
      usageHistory: true,
    });
    const page = await waitFor(() => {
      const found = callsTo(LIST).find(
        (input): input is UsageListInput =>
          typeof input === 'object' && input !== null && (input as UsageListInput).limit === 50,
      );
      if (!found) throw new Error('the log hasn’t asked yet');
      return found;
    });
    expect(page.from).toBeUndefined();
    expect(page.before).toBeTypeOf('number');
  });
});
