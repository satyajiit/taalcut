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

describe('talkingHead', () => {
  it('is voice at 100 BPM with required captions', () => {
    const found = getFormat('talkingHead');
    expect(found.ok && found.value.summary).toMatchObject({
      defaultBpm: 100,
      audio: 'voice',
      captions: 'required',
    });
  });

  it.each(DURATIONS)('plans %i s inside the point and cutaway ranges', (seconds) => {
    const template = requirePlan('talkingHead', seconds);
    expectPlanBasics(template, 'talkingHead', seconds, 'voice');
    const names = sectionNames(template);
    expect(names[0]).toBe('Hook');
    expect(names[1]).toBe('Intro');
    expect(names.at(-2)).toBe('Cta');
    expect(names.at(-1)).toBe('Outro');
    const middle = names.slice(2, -2);
    middle.forEach((name, index) => expect(name).toBe(index % 2 === 0 ? 'Point' : 'Cutaway'));
    if (middle.length > 0) expect(middle.at(-1)).toBe('Point');
    expect(template.slots.map((slot) => slot.role)).toEqual([
      'hook',
      ...template.slots.slice(1, -1).map(() => 'body' as const),
      'outro',
    ]);

    const [intro] = beatsOf(template, 'Intro:');
    const [cta] = beatsOf(template, 'Cta:');
    const [outro] = beatsOf(template, 'Outro:');
    expect(intro).toBeGreaterThanOrEqual(seconds >= 15 ? 4 : 2);
    expect(intro).toBeLessThanOrEqual(8);
    expect(cta).toBeGreaterThanOrEqual(seconds >= 15 ? 4 : 2);
    expect(cta).toBeLessThanOrEqual(6);
    expect(outro).toBeGreaterThanOrEqual(2);
    expect(outro).toBeLessThanOrEqual(4);

    const points = beatsOf(template, 'Point:');
    const cutaways = beatsOf(template, 'Cutaway:');
    expect(cutaways).toHaveLength(Math.max(0, points.length - 1));
    if (seconds >= 15) {
      expect(points.length).toBeGreaterThan(0);
      expect(points.every((beats) => beats >= 6 && beats <= 12)).toBe(true);
      expect(cutaways.every((beats) => beats >= 2 && beats <= 4)).toBe(true);
    }

    expect(textOn(template, '{name}')).toHaveLength(1);
    expect(textOn(template, '{point}')).toHaveLength(points.length);
    expect(textOn(template, '{cta}')).toHaveLength(1);
    expect(textOn(template, '{cta}')[0]?.role).toBe('cta');
    expect(slotsNamed(template, 'Hook:')[0]?.intent.energy).toBe(0.8);
    expect(template.slots.every((slot) => slot.transitionIn === null)).toBe(true);
  });

  it('is deterministic with an injected id factory', () => {
    const input = { formatId: 'talkingHead' as const, targetSeconds: 30, createdAt: 5 };
    expect(planFormat(input, countingIds())).toEqual(planFormat(input, countingIds()));
  });
});
