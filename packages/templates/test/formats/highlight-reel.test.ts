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

describe('highlightReel', () => {
  it('is music at 128 BPM with optional captions', () => {
    const found = getFormat('highlightReel');
    expect(found.ok && found.value.summary).toMatchObject({
      defaultBpm: 128,
      audio: 'music',
      captions: 'optional',
    });
  });

  it.each(DURATIONS)('plans %i s with a slow-down ramp and rising build', (seconds) => {
    const template = requirePlan('highlightReel', seconds);
    expectPlanBasics(template, 'highlightReel', seconds, 'music');
    const names = sectionNames(template);
    const builds = slotsNamed(template, 'Build:');
    const peaks = slotsNamed(template, 'Peak:');
    expect(names[0]).toBe('Hook');
    expect(names.slice(1, 1 + builds.length).every((name) => name === 'Build')).toBe(true);
    expect(
      names.slice(1 + builds.length, 1 + builds.length + peaks.length).every((name) => name === 'Peak'),
    ).toBe(true);
    expect(names.slice(-3)).toEqual(['Slow-down', 'Finale', 'Outro']);
    expect(peaks).toHaveLength(seconds >= 60 ? 5 : seconds >= 30 ? 4 : 3);
    expect(peaks.every((slot) => slot.role === 'peak' && slot.intent.energy === 1)).toBe(true);
    expect(beatsOf(template, 'Peak:').every((beats) => beats >= 1 && beats <= 2)).toBe(true);
    if (seconds >= 15) {
      expect(builds.length).toBeGreaterThan(0);
      expect(beatsOf(template, 'Build:').every((beats) => beats >= 2 && beats <= 4)).toBe(true);
    } else expect(builds).toHaveLength(0);

    const energies = builds.map((slot) => slot.intent.energy);
    if (energies.length > 0) expect(energies[0]).toBe(0.5);
    if (energies.length > 1) expect(energies.at(-1)).toBe(0.85);
    for (let index = 1; index < energies.length; index++) {
      const previous = energies[index - 1];
      const current = energies[index];
      if (previous === undefined || current === undefined) throw new Error('missing energy');
      expect(previous).toBeLessThanOrEqual(current);
    }
    expect(slotsNamed(template, 'Slow-down:')[0]?.role).toBe('body');
    expect(slotsNamed(template, 'Finale:')[0]?.intent.energy).toBe(0.9);
    expect(slotsNamed(template, 'Finale:')[0]?.role).toBe('body');
    expect(slotsNamed(template, 'Outro:')[0]?.intent.energy).toBe(0.3);
    expect(slotsNamed(template, 'Outro:')[0]?.role).toBe('outro');
    expect(textOn(template, '{title}')).toHaveLength(builds.length > 0 ? 1 : 0);

    const slow = slotsNamed(template, 'Slow-down:')[0];
    const ramp = slow?.speedRamp;
    expect(ramp?.curve).toBe('ease');
    expect(ramp?.points.map((point) => point.speed)).toEqual([1, 0.5, 1]);
    expect(ramp?.points[0]?.at.value).toBe(0);
    expect(ramp?.points[1]?.at.value).toBe(Math.floor((slow?.duration.value ?? 0) / 2));
    expect(ramp?.points[2]?.at.value).toBe(slow?.duration.value);
    const ramped = template.slots.filter((slot) => slot.speedRamp !== null);
    expect(ramped).toHaveLength(1);
    expect(ramped[0]?.id).toBe(slow?.id);
  });

  it('is deterministic with an injected id factory', () => {
    const input = { formatId: 'highlightReel' as const, targetSeconds: 30, createdAt: 5 };
    expect(planFormat(input, countingIds())).toEqual(planFormat(input, countingIds()));
  });
});
