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

describe('beforeAfter', () => {
  it('is music at 120 BPM with optional captions', () => {
    const found = getFormat('beforeAfter');
    expect(found.ok && found.value.summary).toMatchObject({
      defaultBpm: 120,
      audio: 'music',
      captions: 'optional',
    });
  });

  it.each(DURATIONS)('plans %i s with equal before and after counts', (seconds) => {
    const template = requirePlan('beforeAfter', seconds);
    expectPlanBasics(template, 'beforeAfter', seconds, 'music');
    const names = sectionNames(template);
    const befores = slotsNamed(template, 'Before:');
    const afters = slotsNamed(template, 'After:');
    expect(names[0]).toBe('Hook');
    expect(names.slice(1, 1 + befores.length).every((name) => name === 'Before')).toBe(true);
    expect(names.slice(1 + befores.length, -1).every((name) => name === 'After')).toBe(true);
    expect(names.at(-1)).toBe('Outro');
    expect(befores.length).toBeGreaterThan(0);
    expect(afters).toHaveLength(befores.length);
    expect(beatsOf(template, 'Before:').every((beats) => beats >= 2 && beats <= 4)).toBe(true);
    expect(beatsOf(template, 'After:').every((beats) => beats >= 2 && beats <= 4)).toBe(true);
    const [outro] = beatsOf(template, 'Outro:');
    expect(outro).toBeGreaterThanOrEqual(2);
    expect(outro).toBeLessThanOrEqual(4);
    expect(template.slots.at(-1)?.role).toBe('outro');

    befores.forEach((slot) => expect(slot.intent.text).toContain('same angle as after'));
    expect(befores.every((slot) => slot.intent.energy === 0.35)).toBe(true);
    expect(afters.every((slot) => slot.intent.energy === 0.8)).toBe(true);
    expect(textOn(template, '{before}')).toHaveLength(1);
    expect(textOn(template, '{after}')).toHaveLength(1);

    const whip = {
      kind: 'whip',
      direction: null,
      confidence: 1,
      before: { value: 2 },
      after: { value: 2 },
    };
    expect(afters[0]?.transitionIn).toMatchObject(whip);
    expect(afters.slice(1).every((slot) => slot.transitionIn === null)).toBe(true);
    const whipped = template.slots.filter((slot) => slot.transitionIn !== null);
    expect(whipped).toHaveLength(1);
    expect(whipped[0]?.id).toBe(afters[0]?.id);
    expect(template.slots[0]?.transitionIn).toBeNull();
  });

  it('is deterministic with an injected id factory', () => {
    const input = { formatId: 'beforeAfter' as const, targetSeconds: 30, createdAt: 5 };
    expect(planFormat(input, countingIds())).toEqual(planFormat(input, countingIds()));
  });
});
