// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { predictReframe } from '../../src/adapters/reframe';
import { plannerLabels } from '../../src/reframe/fixtures';
import { scoreReframe } from '../../src/reframe/run';

describe('planVisualFraming adapter', () => {
  it('keeps the walking face in frame without jitter, and counts a subjectless clip as fallback', () => {
    const labels = plannerLabels();
    const predictions = predictReframe(labels);
    const report = scoreReframe(labels, new Map(predictions.map((row) => [row.clipId, row])));
    const subject = report.metrics.find((metric) => metric.name === 'subjectInFrame')?.value ?? 0;
    const jitter = report.metrics.find((metric) => metric.name === 'jitterFrames')?.value ?? -1;
    const fallback = report.metrics.find((metric) => metric.name === 'fallbackFrames')?.value ?? 0;
    expect(subject).toBeGreaterThanOrEqual(0.95);
    expect(jitter).toBe(0);
    expect(fallback).toBeGreaterThan(0);
    expect(report.gate.pass).toBe(true);
    expect(report.claimed).toBe(false);
    expect(report.gate.id).toBe('P3-V2');
    // The subjectless clip's fallback is the planner's own framing, not the label's.
    const empty = predictions.find((row) => row.clipId === labels[1]?.clipId);
    expect(empty?.framing).not.toBe('subject');
    expect(report.metrics.find((metric) => metric.name === 'fallbackMissed')?.value).toBe(0);
  });

  it('refuses real labels: their subject track has to come from the mac helper', () => {
    const real = plannerLabels().map((label) => ({ ...label, synthetic: false }));
    expect(() => predictReframe(real)).toThrow(/mac helper's recorded subject track/);
  });
});
