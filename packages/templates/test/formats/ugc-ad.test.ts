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
  slotBeatCounts,
  slotsNamed,
  textOn,
} from './helpers';

const DURATIONS = [6, 15, 30, 60, 90] as const;

describe('ugcAd', () => {
  it('is music at 120 BPM with recommended captions', () => {
    const found = getFormat('ugcAd');
    expect(found.ok && found.value.summary).toMatchObject({
      defaultBpm: 120,
      audio: 'music',
      captions: 'recommended',
    });
  });

  it.each(DURATIONS)('plans %i s with the demo keeping at least 40%', (seconds) => {
    const template = requirePlan('ugcAd', seconds);
    expectPlanBasics(template, 'ugcAd', seconds, 'music');
    const names = sectionNames(template);
    const problems = slotsNamed(template, 'Problem:');
    const demos = slotsNamed(template, 'Demo:');
    const results = slotsNamed(template, 'Result:');
    expect(names[0]).toBe('Hook');
    expect(names.slice(1, 1 + problems.length).every((name) => name === 'Problem')).toBe(true);
    expect(
      names.slice(1 + problems.length, 1 + problems.length + demos.length).every((name) => name === 'Demo'),
    ).toBe(true);
    expect(names.slice(1 + problems.length + demos.length, -1).every((name) => name === 'Result')).toBe(true);
    expect(names.at(-1)).toBe('Cta');
    expect(template.slots.at(-1)?.role).toBe('body');

    expect(problems).toHaveLength(seconds >= 30 ? 3 : seconds >= 15 ? 2 : 1);
    expect(beatsOf(template, 'Problem:').every((beats) => beats >= 2 && beats <= 4)).toBe(true);
    expect(demos.length).toBeGreaterThan(0);
    expect(beatsOf(template, 'Demo:').every((beats) => beats >= 2 && beats <= 4)).toBe(true);
    if (seconds >= 15) expect(results).toHaveLength(2);
    expect(beatsOf(template, 'Result:').every((beats) => beats >= 2 && beats <= 4)).toBe(true);
    const [cta] = beatsOf(template, 'Cta:');
    expect(cta).toBeGreaterThanOrEqual(2);
    expect(cta).toBeLessThanOrEqual(4);
    if (seconds >= 15) expect(cta).toBe(4);

    const total = slotBeatCounts(template).reduce((sum, beats) => sum + beats, 0);
    const demo = beatsOf(template, 'Demo:').reduce((sum, beats) => sum + beats, 0);
    if (seconds >= 15) expect(demo / total).toBeGreaterThanOrEqual(0.4);
    expect(demo / total).toBeGreaterThan(0);

    expect(textOn(template, '{problem}')).toHaveLength(1);
    expect(textOn(template, '{benefit}')).toHaveLength(results.length > 0 ? 1 : 0);
    expect(textOn(template, '{offer}')).toHaveLength(1);
    expect(textOn(template, '{offer}')[0]?.role).toBe('label');
    expect(textOn(template, '{cta}')).toHaveLength(1);
    expect(textOn(template, '{cta}')[0]?.role).toBe('cta');
    expect(slotsNamed(template, 'Hook:')[0]?.intent.energy).toBe(0.95);
    expect(slotsNamed(template, 'Cta:')[0]?.intent.energy).toBe(0.9);
  });

  it('is deterministic with an injected id factory', () => {
    const input = { formatId: 'ugcAd' as const, targetSeconds: 30, createdAt: 5 };
    expect(planFormat(input, countingIds())).toEqual(planFormat(input, countingIds()));
  });
});
