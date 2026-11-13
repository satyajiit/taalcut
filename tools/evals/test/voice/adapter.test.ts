// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { predictVoice } from '../../src/adapters/voice';
import { voiceCase } from '../../src/voice/fixtures';
import { scoreVoice } from '../../src/voice/run';

describe('planPlacement adapter', () => {
  it('lands every first word on its slot beat, with no overlap and nothing past the timeline', () => {
    const built = voiceCase();
    const [prediction] = predictVoice([built.label]);
    if (prediction === undefined) throw new Error('no prediction');
    const report = scoreVoice([built.label], new Map([[built.label.caseId, prediction]]));
    expect(report.metrics.find((metric) => metric.name === 'onBeatShare')?.value).toBe(1);
    expect(report.metrics.find((metric) => metric.name === 'overlaps')?.value).toBe(0);
    expect(report.metrics.find((metric) => metric.name === 'outside')?.value).toBe(0);
    expect(report.gate.pass).toBe(true);
    expect(report.claimed).toBe(false);
    expect(report.gate.id).toBe('P3-B6');
  });
});
