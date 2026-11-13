// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { planFormat } from '../../src/index';
import { getFormat } from '../../src/formats/registry';
import {
  beatsOf,
  countingIds,
  expectPlanBasics,
  requirePlan,
  sectionNames,
  slotsNamed,
  textOn,
} from './helpers';

const DURATIONS = [6, 15, 30, 60, 90] as const;

describe('tutorial', () => {
  it('is voice at 100 BPM with recommended captions', () => {
    const found = getFormat('tutorial');
    expect(found.ok && found.value.summary).toMatchObject({
      defaultBpm: 100,
      audio: 'voice',
      captions: 'recommended',
    });
  });

  it.each(DURATIONS)('plans %i s with a step for every {step}', (seconds) => {
    const template = requirePlan('tutorial', seconds);
    expectPlanBasics(template, 'tutorial', seconds, 'voice');
    const names = sectionNames(template);
    const steps = slotsNamed(template, 'Step:');
    expect(names[0]).toBe('Hook');
    expect(names[1]).toBe('Intro');
    expect(names.slice(2, 2 + steps.length).every((name) => name === 'Step')).toBe(true);
    expect(names.at(-2)).toBe('Result');
    expect(names.at(-1)).toBe('Outro');
    expect(template.slots[0]?.role).toBe('hook');
    expect(template.slots.at(-1)?.role).toBe('outro');

    const [intro] = beatsOf(template, 'Intro:');
    const [result] = beatsOf(template, 'Result:');
    const [outro] = beatsOf(template, 'Outro:');
    expect(intro).toBeGreaterThanOrEqual(seconds >= 15 ? 4 : 2);
    expect(intro).toBeLessThanOrEqual(4);
    expect(result).toBeGreaterThanOrEqual(seconds >= 15 ? 4 : 2);
    expect(result).toBeLessThanOrEqual(4);
    expect(outro).toBeGreaterThanOrEqual(2);
    expect(outro).toBeLessThanOrEqual(4);
    const stepBeats = beatsOf(template, 'Step:');
    if (seconds >= 15) {
      expect(stepBeats.length).toBeGreaterThan(0);
      expect(stepBeats.every((beats) => beats >= 4 && beats <= 8)).toBe(true);
    }
    if (seconds >= 30) expect(steps.some((slot) => slot.intent.shotType === 'screen')).toBe(true);
    expect(steps.every((slot) => slot.intent.energy === 0.5)).toBe(true);
    expect(slotsNamed(template, 'Intro:')[0]?.intent.text).toContain('overhead');
    expect(slotsNamed(template, 'Hook:')[0]?.intent.energy).toBe(0.85);

    expect(textOn(template, '{title}')).toHaveLength(1);
    expect(textOn(template, '{title}')[0]?.role).toBe('title');
    expect(textOn(template, '{step}')).toHaveLength(steps.length);
    expect(textOn(template, '{cta}')).toHaveLength(1);
    expect(textOn(template, '{cta}')[0]?.role).toBe('cta');
  });

  it('is deterministic with an injected id factory', () => {
    const input = { formatId: 'tutorial' as const, targetSeconds: 30, createdAt: 5 };
    expect(planFormat(input, countingIds())).toEqual(planFormat(input, countingIds()));
  });
});
