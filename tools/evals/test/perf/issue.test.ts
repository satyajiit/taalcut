// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RUNNER_ALLOWLIST,
  reportRegression,
  type GhClient,
  type GhIssue,
} from '../../src/perf/issue';

interface FakeGh extends GhClient {
  created: { title: string; body: string; labels: string[] }[];
  comments: { number: number; body: string }[];
  lists: number;
}

function fakeGh(open: GhIssue[]): FakeGh {
  const client: FakeGh = {
    created: [],
    comments: [],
    lists: 0,
    async listOpen(): Promise<GhIssue[]> {
      client.lists += 1;
      return open;
    },
    async create(input): Promise<GhIssue> {
      client.created.push(input);
      return { number: 50, title: input.title };
    },
    async comment(number: number, body: string): Promise<void> {
      client.comments.push({ number, body });
    },
  };
  return client;
}

const allow = DEFAULT_RUNNER_ALLOWLIST;

async function report(
  client: GhClient,
  overrides: Partial<Parameters<typeof reportRegression>[0]> = {},
): Promise<Awaited<ReturnType<typeof reportRegression>>> {
  return reportRegression({
    client,
    fileIssues: false,
    runnerAllowlist: allow,
    runnerId: 'm1-8gb',
    metric: 'index-1h',
    title: 'Perf: index-1h on m1-8gb +12%',
    body: 'index-1h regressed',
    ...overrides,
  });
}

describe('reportRegression', () => {
  it('dry-runs when fileIssues is false and does not create', async () => {
    const client = fakeGh([{ number: 4, title: 'Perf: index-1h on m1-8gb +12%' }]);
    const result = await report(client, { fileIssues: false });
    expect(result.action).toBe('dry-run');
    expect(result.command).toContain('perf-regression');
    expect(result.command).toContain('Perf: index-1h on m1-8gb +12%');
    expect(result.command).toContain('gh issue create');
    expect(client.created).toEqual([]);
    expect(client.comments).toEqual([]);
    expect(client.lists).toBe(0);
  });

  it('comments on the open issue for that metric and runner instead of creating', async () => {
    const client = fakeGh([
      { number: 9, title: 'Perf: index-1h on m1-8gb +3%' },
      { number: 4, title: 'Perf: index-1h on m1-8gb +12%' },
      { number: 2, title: 'Perf: preview-fps on m1-8gb +20%' },
    ]);
    const result = await report(client, { fileIssues: true, body: 'still worse' });
    expect(result.action).toBe('commented');
    expect(client.created).toEqual([]);
    expect(client.comments).toEqual([{ number: 4, body: 'still worse' }]);
    expect(result.command).toContain('gh issue comment 4');
  });

  it('creates when no open issue matches', async () => {
    const client = fakeGh([{ number: 2, title: 'Perf: preview-fps on m1-8gb +20%' }]);
    const result = await report(client, {
      fileIssues: true,
      metric: 'index-1h',
      title: 'Perf: index-1h on m1-8gb +12%',
    });
    expect(result.action).toBe('created');
    expect(client.comments).toEqual([]);
    expect(client.created).toEqual([
      {
        title: 'Perf: index-1h on m1-8gb +12%',
        body: 'index-1h regressed',
        labels: ['perf-regression'],
      },
    ]);
  });

  it('skips a runner that is not allowlisted even when fileIssues is true', async () => {
    const client = fakeGh([]);
    const result = await report(client, { fileIssues: true, runnerId: 'random-laptop' });
    expect(result.action).toBe('skipped');
    expect(result.command).toContain('random-laptop');
    expect(result.command).toContain('allowlist');
    expect(client.created).toEqual([]);
    expect(client.comments).toEqual([]);
    expect(client.lists).toBe(0);
  });
});
