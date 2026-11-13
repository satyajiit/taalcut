// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B11 "the switch-on rule only flips a family at ≥ 90 % agreement and ≥ 30 % token drop at equal eval
 * success; the result is reported, not forced" (SPEC section 24), on synthetic run logs: the Wilson interval,
 * timeouts and errors as disagreements, and each half of the rule failing on its own.
 */
import { newId, type RunId, type ToolRunId } from '@taalcut/core';
import {
  newEvent,
  routerReport,
  wilson,
  type AgentEvent,
  type NewAgentEvent,
  type RouterGolden,
} from '@taalcut/agent';
import { describe, expect, it } from 'vitest';

interface Synthetic {
  /** The router's choice; undefined for a timeout. */
  readonly choice?: string;
  readonly errorCode?: string;
  /** The main model's first domain tool family, or 'none'. */
  readonly main: string;
}

/** One run's log with one decision per entry, shaped like the loop writes it. */
function log(decisions: readonly Synthetic[]): AgentEvent[] {
  const runId = newId<'AgentRun'>() as RunId;
  const fresh: NewAgentEvent[] = [];
  for (const d of decisions) {
    const modelCallId = newId<'ModelCall'>();
    fresh.push(
      d.choice === undefined
        ? newEvent(
            'route.timeout',
            { modelCallId, afterMs: 2000, ...(d.errorCode ? { errorCode: d.errorCode } : {}) },
            1,
          )
        : newEvent(
            'route.shadow',
            {
              modelCallId,
              router: {
                choice: d.choice,
                top3: [],
                confidence: 0.9,
                model: 'typesafe/jev-1.13.0',
                latencyMs: 300,
                costUsd: 0,
              },
            },
            1,
          ),
      newEvent(
        'model.responded',
        {
          modelCallId,
          provider: 'stand-in',
          model: 'main-1',
          local: false,
          message: { role: 'assistant', parts: [], provider: 'stand-in', model: 'main-1' },
          text: '',
          toolCalls: [],
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 0,
            costUsd: 0,
          },
          latencyMs: 1,
          stopReason: 'stop',
        },
        1,
      ),
      ...(d.main === 'none'
        ? [newEvent('tool.requested', toolCall(modelCallId, 'findTools', true), 1)]
        : [newEvent('tool.requested', toolCall(modelCallId, `${d.main}.act`, false), 1)]),
    );
  }
  return fresh.map((event, seq) => ({ ...event, runId, seq }) as AgentEvent);
}

function toolCall(modelCallId: string, tool: string, meta: boolean) {
  return {
    toolCallId: newId<'ToolRun'>() as ToolRunId,
    modelCallId,
    modelToolCallId: 'call-1',
    tool,
    callName: tool.replace('.', '_'),
    meta,
    input: {},
    sideEffect: 'read' as const,
  };
}

/** `matches` agreeing decisions out of `n`, the rest disagreeing; family 'timeline'. */
function decisions(n: number, matches: number, family = 'timeline'): Synthetic[] {
  return Array.from({ length: n }, (_, i) => ({ choice: family, main: i < matches ? family : 'library' }));
}

function golden(full: number, routed: number, flip = false): RouterGolden {
  const tasks = Array.from({ length: 10 }, (_, i) => `task-${i}`);
  return {
    off: tasks.map((taskId) => ({ taskId, promptTokens: full, passed: true })),
    on: tasks.map((taskId, i) => ({
      taskId,
      promptTokens: routed,
      passed: !(flip && i === 3),
      routerInputTokens: 150,
    })),
  };
}

describe('router switch-on report', () => {
  it('prints the Wilson interval: n = 200, p = 0.90 has a lower bound near 0.85', () => {
    const interval = wilson(180, 200);
    expect(interval.low).toBeCloseTo(0.8506, 3);
    expect(interval.high).toBeCloseTo(0.9343, 3);
    expect(wilson(0, 0)).toEqual({ low: 0, high: 0 });
  });

  it('recommends at 90 % over 200 decisions with a 30 % token drop and no flips, and names the live families', () => {
    const report = routerReport([log(decisions(200, 180))], golden(10_000, 7_000), {
      now: () => 5,
      id: 'r-1',
    });
    expect(report.agreement).toMatchObject({ n: 200, matches: 180, estimate: 0.9 });
    expect(report.tokens).toMatchObject({
      tasks: 10,
      full: 100_000,
      routed: 70_000,
      routerInputTokens: 1_500,
    });
    expect(report.tokens?.drop).toBeCloseTo(0.3, 10);
    expect(report.criteria).toEqual({ enoughTasks: true, agreement: true, tokens: true, equalSuccess: true });
    expect(report).toMatchObject({
      id: 'r-1',
      generatedAt: 5,
      recommended: true,
      liveFamilies: ['timeline'],
    });
    expect(report.reasons[0]).toContain('95 % Wilson 85.1 %');
  });

  it('does not recommend at 89 %', () => {
    const report = routerReport([log(decisions(200, 178))], golden(10_000, 6_000));
    expect(report.criteria.agreement).toBe(false);
    expect(report.recommended).toBe(false);
    expect(report.liveFamilies).toEqual([]);
    expect(report.reasons).toContain('Agreement is under 90 %: the router stays in shadow.');
  });

  it('does not recommend a 29 % token drop', () => {
    const report = routerReport([log(decisions(200, 190))], golden(10_000, 7_100));
    expect(report.criteria).toMatchObject({ agreement: true, tokens: false });
    expect(report.recommended).toBe(false);
  });

  it('does not recommend when one golden task flips from pass to fail', () => {
    const report = routerReport([log(decisions(200, 190))], golden(10_000, 5_000, true));
    expect(report.flips).toEqual(['task-3']);
    expect(report.recommended).toBe(false);
  });

  // Review M9: a golden "on" set that leaves out the tasks that would fail must not pass the rule.
  it('does not recommend when the on-set omits golden tasks: equal success and the saving are unproven', () => {
    const tasks = Array.from({ length: 20 }, (_, i) => `task-${String(i).padStart(2, '0')}`);
    const partial: RouterGolden = {
      off: tasks.map((taskId) => ({ taskId, promptTokens: 10_000, passed: true })),
      on: tasks.slice(0, 12).map((taskId) => ({ taskId, promptTokens: 7_000, passed: true })),
    };
    const report = routerReport([log(decisions(200, 190))], partial);
    expect(report.flips).toEqual([]);
    expect(report.unpaired).toEqual(tasks.slice(12));
    expect(report.criteria).toMatchObject({ agreement: true, tokens: false, equalSuccess: false });
    expect(report.recommended).toBe(false);
    expect(report.liveFamilies).toEqual([]);
    expect(
      report.reasons.some((reason) => reason.includes('8 golden tasks ran with the router off and never on')),
    ).toBe(true);
  });

  it('counts a task that failed both off and on as equal, not as a flip', () => {
    const both = golden(10_000, 6_000);
    const failing: RouterGolden = {
      off: both.off.map((run, i) => (i === 2 ? { ...run, passed: false } : run)),
      on: both.on.map((run, i) => (i === 2 ? { ...run, passed: false } : run)),
    };
    const report = routerReport([log(decisions(200, 190))], failing);
    expect(report.criteria.equalSuccess).toBe(true);
    expect(report.recommended).toBe(true);
  });

  it('does not recommend without golden runs: the saving is unmeasured', () => {
    const report = routerReport([log(decisions(250, 245))], undefined);
    expect(report.tokens).toBeNull();
    expect(report.recommended).toBe(false);
    expect(report.reasons).toContain('No golden runs: the token saving is unmeasured.');
  });

  it('needs 200 decisions even at 100 %', () => {
    const report = routerReport([log(decisions(150, 150))], golden(10_000, 5_000));
    expect(report.criteria).toMatchObject({ enoughTasks: false, agreement: false });
  });

  it('counts timeouts and errors as disagreements and reports their rate beside agreement', () => {
    const report = routerReport(
      [
        log([
          ...decisions(196, 196),
          { main: 'timeline' },
          { main: 'timeline' },
          { main: 'timeline', errorCode: 'models.rate_limited' },
          { main: 'none' },
        ]),
      ],
      golden(10_000, 5_000),
      { minTasks: 200 },
    );
    expect(report.agreement).toMatchObject({ n: 200, matches: 196, estimate: 0.98 });
    expect(report.unanswered).toEqual({ timeouts: 3, errors: 1, rate: 0.02 });
  });

  it('a Wilson lower bound at 90 % also meets the agreement half', () => {
    // 970 of 1,000: point 0.97, lower bound well above 0.90.
    const report = routerReport([log(decisions(1000, 970))], golden(10_000, 6_000));
    expect(report.agreement.wilson.low).toBeGreaterThan(0.9);
    expect(report.recommended).toBe(true);
  });

  it('keeps a weak family in shadow while the global gate passes, and says so', () => {
    const report = routerReport(
      [log([...decisions(190, 190, 'timeline'), ...decisions(20, 14, 'audio')])],
      golden(10_000, 6_000),
    );
    expect(report.recommended).toBe(true);
    expect(report.families.map((f) => [f.family, f.n, f.matches])).toEqual([
      ['audio', 20, 14],
      ['timeline', 190, 190],
    ]);
    expect(report.liveFamilies).toEqual(['timeline']);
    expect(report.reasons).toContain('audio stays in shadow (70.0 % of 20).');
  });

  it('ignores a decision whose turn the main model never answered', () => {
    const events = log(decisions(3, 3)).filter((e, i) => !(e.type === 'model.responded' && i === 1));
    expect(routerReport([events], undefined).agreement.n).toBe(2);
  });
});
