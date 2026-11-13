// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TRACE_FIXTURES } from '../src/backend/fake/trace-fixtures';
import { placeSpans, traceTotals, traceWindow } from '../src/features/traces/span-tree';
import { renderApp } from './render-app';

const gate = TRACE_FIXTURES.find((t) => t.status === 'succeeded')!;
const running = TRACE_FIXTURES.find((t) => t.status === 'running')!;

describe('span tree', () => {
  it('orders spans depth first, with depth and a place on the run’s timeline', () => {
    const placed = placeSpans(gate);
    expect(placed.map((p) => [p.span.kind, p.depth])).toEqual([
      ['run', 0],
      ['step', 1],
      ['model', 2],
      ['tool', 2],
      ['step', 1],
      ['model', 2],
      ['tool', 2],
      ['tool', 2],
      ['step', 1],
      ['model', 2],
      ['tool', 2],
      ['model', 2],
    ]);
    expect(placed[0]).toMatchObject({ from: 0, to: 1, open: false });
    for (const p of placed) expect(p.from).toBeLessThanOrEqual(p.to);
  });

  it('totals tokens, cost, cache hits and retries over model and tool calls only', () => {
    expect(traceTotals(gate)).toMatchObject({ modelCalls: 4, toolCalls: 4, cacheHits: 1, retries: 1 });
    expect(traceTotals(gate).costUsd).toBeCloseTo(0.0152, 6);
  });

  it('draws spans that are still running up to the latest moment seen', () => {
    const { end } = traceWindow(running);
    const open = placeSpans(running).filter((p) => p.open);
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((p) => p.to === 1)).toBe(true);
    expect(end).toBeGreaterThan(running.startedAt);
  });
});

describe('/dev/traces', () => {
  it('lists runs newest first, shows the chosen run’s waterfall, and a span’s details', async () => {
    await renderApp(`/dev/traces?run=${gate.runId}`);
    const runs = await screen.findByRole('navigation', { name: 'Runs' });
    expect(within(runs).getAllByRole('link')).toHaveLength(3);
    expect(await screen.findByText(/Complete: every call/)).toBeTruthy();
    const spans = screen.getByRole('list', { name: 'Spans, in order' });
    fireEvent.click(within(spans).getAllByRole('button', { name: /vision\.describeFrame/ })[0]!);
    const details = screen.getByRole('region', { name: 'vision.describeFrame' });
    expect(within(details).getByText('$0.0012')).toBeTruthy();
  });

  it('shows the newest run when ?run is missing or not an id', async () => {
    await renderApp('/dev/traces?run=not-a-run');
    const runs = await screen.findByRole('navigation', { name: 'Runs' });
    await waitFor(() =>
      expect(within(runs).getAllByRole('link')[0]!.getAttribute('aria-current')).toBe('page'),
    );
  });
});
