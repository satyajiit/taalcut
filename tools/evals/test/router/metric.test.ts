// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { agreementMeets, ROUTER_BARS, tokenDropMeets } from '../../src/router/metric';
import { scoreRouter } from '../../src/router/run';
import type { RouterLabel, RouterPrediction } from '../../src/router/schema';

function prediction(patch: Partial<RouterPrediction> = {}): RouterPrediction {
  return {
    caseId: 'shadow',
    n: 200,
    matches: 180,
    families: [{ family: 'timeline', n: 180, matches: 180 }],
    tokens: { full: 100, routed: 70 },
    flips: 0,
    measured: true,
    ...patch,
  };
}

function score(row: RouterPrediction, synthetic = false) {
  const label: RouterLabel = { caseId: row.caseId, synthetic };
  return scoreRouter([label], new Map([[row.caseId, row]]));
}

describe('router bars', () => {
  it('counts 180/200 as 0.90 and 179/200 as a miss', () => {
    expect(agreementMeets(180, 200)).toBe(true);
    expect(agreementMeets(179, 200)).toBe(false);
    expect(score(prediction()).gate.pass).toBe(true);
    expect(score(prediction({ matches: 179 })).gate.pass).toBe(false);
    expect(score(prediction()).metrics.find((metric) => metric.name === 'agreement')?.value).toBe(0.9);
  });

  it('counts a drop from 100 to 70 as 0.30 and 71 as a miss', () => {
    expect(tokenDropMeets(100, 70)).toBe(true);
    expect(tokenDropMeets(100, 71)).toBe(false);
    expect(score(prediction()).gate.pass).toBe(true);
    expect(score(prediction({ tokens: { full: 100, routed: 71 } })).gate.pass).toBe(false);
  });

  it('turns equalSuccess off when a golden task passed off and failed on', () => {
    const report = score(prediction({ flips: 1 }));
    expect(report.metrics.find((metric) => metric.name === 'equalSuccess')?.value).toBe(0);
    expect(report.gate.pass).toBe(false);
    expect(report.liveFamilies).toEqual([]);
  });

  it('does not claim the gate below 200 decisions, even when the estimate is high', () => {
    const report = score(
      prediction({
        n: 20,
        matches: 20,
        families: [{ family: 'timeline', n: 20, matches: 20 }],
      }),
    );
    expect(report.claimed).toBe(false);
    expect(report.gate.pass).toBe(false);
    expect(report.liveFamilies).toEqual([]);
    expect(report.gate.id).toBe('P3-B11');
  });

  it('leaves a family off the live list when its own agreement misses', () => {
    const report = score(
      prediction({
        matches: 180,
        families: [
          { family: 'timeline', n: 100, matches: 100 },
          { family: 'library', n: 100, matches: 80 },
        ],
      }),
    );
    expect(report.gate.pass).toBe(true);
    expect(report.liveFamilies).toEqual(['timeline']);
    expect(report.metrics.find((metric) => metric.name === 'agreement.library')?.value).toBe(0.8);
  });

  it('does not claim a synthetic run that otherwise passes', () => {
    const report = score(prediction(), true);
    expect(report.gate.pass).toBe(true);
    expect(report.claimed).toBe(false);
    expect(report.synthetic).toBe(true);
  });

  it('scores equalSuccess 0 when no golden set was measured', () => {
    const report = score(prediction({ measured: false, tokens: null }));
    expect(report.cases[0]?.equalSuccess).toBe(0);
    expect(report.gate.pass).toBe(false);
  });

  it('uses the router gate numbers', () => {
    expect(ROUTER_BARS).toEqual({ agreement: 0.9, tokenDrop: 0.3, minTasks: 200 });
  });
});
