// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scoreCostDir, scoreCostEvents } from '../src/cost/score';

const line = (model: string) => ({ provider: 'recorded', model, usd: 0.01 });

describe('estimate accuracy', () => {
  it('accepts ±30% at a cent or more, and ±$0.003 below that', () => {
    const inside = scoreCostEvents([
      {
        type: 'estimate.recorded',
        estimateId: 'big',
        stepId: 'analyst',
        estimate: { usd: 0.1 },
        lines: [line('gemini')],
      },
      { type: 'estimate.settled', estimateId: 'big', actual: { usd: 0.13 } },
      {
        type: 'estimate.recorded',
        estimateId: 'tiny',
        stepId: 'caption',
        estimate: { usd: 0.002 },
        lines: [line('local')],
      },
      { type: 'estimate.settled', estimateId: 'tiny', actual: { usd: 0.004 } },
    ]);
    expect(inside.pass).toBe(true);
    expect(inside.checked).toBe(2);

    const outside = scoreCostEvents([
      {
        type: 'estimate.recorded',
        estimateId: 'big',
        stepId: 'analyst',
        estimate: { usd: 0.1 },
        lines: [line('gemini')],
      },
      { type: 'estimate.settled', estimateId: 'big', actual: { usd: 0.14 } },
      {
        type: 'estimate.recorded',
        estimateId: 'tiny',
        stepId: 'caption',
        estimate: { usd: 0.001 },
        lines: [line('local')],
      },
      { type: 'estimate.settled', estimateId: 'tiny', actual: { usd: 0.005 } },
    ]);
    expect(outside.pass).toBe(false);
    expect(outside.outliers.map((item) => item.estimateId).sort()).toEqual(['big', 'tiny']);
    expect(outside.outliers.find((item) => item.estimateId === 'big')?.models).toEqual(['gemini']);
    expect(outside.outliers.find((item) => item.estimateId === 'big')?.stepId).toBe('analyst');
  });

  it('reads a directory of run logs', () => {
    const dir = join(tmpdir(), `taalcut-cost-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'run.json'),
      `${JSON.stringify([
        {
          type: 'estimate.recorded',
          estimateId: 'e1',
          stepId: 'review',
          estimate: { usd: 0.02 },
          lines: [line('gemini')],
        },
        { type: 'estimate.settled', estimateId: 'e1', actual: { usd: 0.02 } },
      ])}\n`,
    );
    expect(scoreCostDir(dir).pass).toBe(true);
  });
});
