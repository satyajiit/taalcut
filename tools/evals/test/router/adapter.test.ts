// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ROUTER_GATE, routerReport } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { predictRouter, shadowLog } from '../../src/adapters/router';
import { ROUTER_BARS } from '../../src/router/metric';
import { scoreRouter } from '../../src/router/run';
import type { RouterLabel } from '../../src/router/schema';

const golden = {
  off: [{ taskId: 'task-0', promptTokens: 100, passed: true }],
  on: [{ taskId: 'task-0', promptTokens: 70, passed: true, routerInputTokens: 15 }],
};

describe('router adapter', () => {
  it('matches ROUTER_GATE', () => {
    expect(ROUTER_BARS.agreement).toBe(ROUTER_GATE.agreement);
    expect(ROUTER_BARS.tokenDrop).toBe(ROUTER_GATE.tokenDrop);
    expect(ROUTER_BARS.minTasks).toBe(ROUTER_GATE.minTasks);
  });

  it('counts a timeout and a missing family as disagreements', () => {
    const label: RouterLabel = { caseId: 'shadow', synthetic: true };
    const logs = [
      shadowLog([
        { choice: 'timeline', main: 'timeline' },
        { main: 'timeline' },
        { main: 'timeline', errorCode: 'router.timeout' },
        { choice: 'timeline', main: 'none' },
      ]),
    ];
    const prediction = predictRouter(logs, label);
    expect(prediction.n).toBe(4);
    expect(prediction.matches).toBe(1);
    const report = scoreRouter([label], new Map([[label.caseId, prediction]]));
    expect(report.gate.pass).toBe(false);
    expect(report.claimed).toBe(false);
    expect(report.liveFamilies).toEqual([]);
    expect(routerReport(logs, undefined).liveFamilies).toEqual([]);
  });

  it('recommends timeline only once 200 decisions clear the bars, and does not claim synthetic input', () => {
    const label: RouterLabel = { caseId: 'shadow', synthetic: true, ...golden };
    const logs = [shadowLog(Array.from({ length: 200 }, () => ({ choice: 'timeline', main: 'timeline' })))];
    const prediction = predictRouter(logs, label);
    const fromAgent = routerReport(logs, { off: golden.off, on: golden.on });
    expect(prediction).toMatchObject({ n: 200, matches: 200, flips: 0, measured: true });
    expect(fromAgent.agreement).toMatchObject({ n: 200, matches: 200, estimate: 1 });
    expect(fromAgent.liveFamilies).toEqual(['timeline']);
    expect(fromAgent.recommended).toBe(true);
    const report = scoreRouter([label], new Map([[label.caseId, prediction]]));
    expect(report.gate.pass).toBe(true);
    expect(report.claimed).toBe(false);
    expect(report.gate.id).toBe('P3-B11');
    expect(report.liveFamilies).toEqual(['timeline']);
  });

  it('fails the golden halves when the on-set skips a task the off-set ran (review M9)', () => {
    const skipped: RouterLabel = {
      caseId: 'shadow',
      synthetic: true,
      off: [...golden.off, { taskId: 'task-1', promptTokens: 100, passed: true }],
      on: golden.on,
    };
    const logs = [shadowLog(Array.from({ length: 200 }, () => ({ choice: 'timeline', main: 'timeline' })))];
    const prediction = predictRouter(logs, skipped);
    expect(prediction).toMatchObject({ flips: 0, measured: false, tokens: null });
    const report = scoreRouter([skipped], new Map([[skipped.caseId, prediction]]));
    expect(report.gate.pass).toBe(false);
    expect(report.liveFamilies).toEqual([]);
  });
});
