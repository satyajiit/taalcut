// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-X1 "estimates within ±30% of actual" (SPEC section 14): costAccuracy
 * pairs each estimate.recorded with its estimate.settled across recorded run
 * logs, as the evals lane's `cost` command reads them from disk. At US$0.01
 * or more an estimate must be within ±30%; below it, within US$0.003. A run
 * that stopped mid-step leaves its estimate unsettled and uncounted.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId, unwrap } from '@taalcut/core';
import { costAccuracy, createFileEventLogStore, withinTolerance, type AgentEvent } from '@taalcut/agent';
import { afterEach, describe, expect, it } from 'vitest';
import { flowHarness } from './support/flow-harness';
import { flowScript } from './support/flow-script';
import { createWorld } from './support/flow-world';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function event<T extends AgentEvent['type']>(
  runId: string,
  seq: number,
  type: T,
  payload: unknown,
): AgentEvent {
  return { runId, seq, type, v: 1, at: seq, payload } as unknown as AgentEvent;
}
const recorded = (runId: string, estimateId: string, usd: number, seq = 1) =>
  event(runId, seq, 'estimate.recorded', {
    estimateId,
    labelKey: 'skills.x',
    skill: 'x.y',
    estimate: { usd, tokens: 0 },
    lines: [],
  });
const settled = (runId: string, estimateId: string, usd: number, seq = 2) =>
  event(runId, seq, 'estimate.settled', { estimateId, actual: { usd, tokens: 0 } });

describe('cost accuracy', () => {
  it('holds estimates of a cent or more to ±30%, and smaller ones to US$0.003', () => {
    expect(withinTolerance(0.13, 0.1)).toBe(true);
    expect(withinTolerance(0.131, 0.1)).toBe(false);
    expect(withinTolerance(0.069, 0.1)).toBe(false);
    expect(withinTolerance(0.005, 0.002)).toBe(true);
    expect(withinTolerance(0.006, 0.002)).toBe(false);
    const run = newId<'Run'>();
    const report = costAccuracy([
      [
        recorded(run, 'a', 0.1),
        settled(run, 'a', 0.12),
        recorded(run, 'b', 0.01, 3),
        settled(run, 'b', 0, 4),
        recorded(run, 'c', 0.2, 5),
      ],
    ]);
    expect(report.pairs.map((p) => [p.estimateId, p.within])).toEqual([
      ['a', true],
      ['b', false],
    ]);
    expect(report.pairs[1]?.error).toBe(Infinity);
    expect(report.unsettled).toEqual([{ runId: run, estimateId: 'c' }]);
    expect(report.passed).toBe(false);
    expect(costAccuracy([]).passed).toBe(true);
  });

  it('reads recorded flow runs from disk and pairs every step estimate', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'taalcut-cost-'));
    dirs.push(dir);
    const store = createFileEventLogStore(dir);
    for (const rerankUsd of [0.045, 0.06]) {
      const h = flowHarness({
        store,
        world: createWorld({ rerankUsd }),
        script: flowScript({ ask: false, rerank: 5 }),
        skills: { rerankEstimateUsd: 0.05 },
        settings: { autonomy: 'autopilot' },
      });
      const outcome = unwrap(
        await h.agent.run({
          conversationId: 'c',
          projectId: h.world.projectId,
          message: 'Copy',
          start: { path: 'reference', reference: { kind: 'link', url: 'https://www.instagram.com/reel/k/' } },
        }),
      );
      expect(outcome.status).toBe('completed');
    }
    // As the evals lane reads them: the JSONL files, nothing else.
    const runs = readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) =>
        readFileSync(join(dir, f), 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as AgentEvent),
      );
    const report = costAccuracy(runs);
    expect(report.pairs).toHaveLength(2);
    expect(report.pairs.map((p) => p.skill)).toEqual(['timeline.librarian', 'timeline.librarian']);
    expect(report.unsettled).toEqual([]);
    expect(report.passed).toBe(true);
  });
});
