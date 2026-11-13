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

describe('podcastClip', () => {
  it('is voice at 100 BPM with required captions', () => {
    const found = getFormat('podcastClip');
    expect(found.ok && found.value.summary).toMatchObject({
      defaultBpm: 100,
      audio: 'voice',
      captions: 'required',
    });
  });

  it.each(DURATIONS)('plans %i s with alternating host and guest', (seconds) => {
    const template = requirePlan('podcastClip', seconds);
    expectPlanBasics(template, 'podcastClip', seconds, 'voice');
    const names = sectionNames(template);
    expect(names[0]).toBe('Hook');
    expect(names.at(-1)).toBe('Outro');
    const speakers = slotsNamed(template, 'Speaker:');
    const reactions = slotsNamed(template, 'Reaction:');
    expect(names.slice(1, 1 + speakers.length).every((name) => name === 'Speaker')).toBe(true);
    expect(names.slice(1 + speakers.length, -1).every((name) => name === 'Reaction')).toBe(true);
    expect(reactions).toHaveLength(seconds >= 30 ? 2 : seconds >= 15 ? 1 : 0);
    expect(template.slots.map((slot) => slot.role).at(-1)).toBe('outro');
    expect(template.slots[0]?.role).toBe('hook');

    const speakerBeats = beatsOf(template, 'Speaker:');
    expect(speakerBeats.length).toBeGreaterThan(0);
    if (seconds >= 15) expect(speakerBeats.every((beats) => beats >= 6 && beats <= 12)).toBe(true);
    expect(beatsOf(template, 'Reaction:').every((beats) => beats === 2)).toBe(true);
    const [outro] = beatsOf(template, 'Outro:');
    expect(outro).toBeGreaterThanOrEqual(2);
    expect(outro).toBeLessThanOrEqual(4);

    speakers.forEach((slot, index) => {
      expect(slot.intent.subject).toBe(index % 2 === 0 ? 'host' : 'guest');
      expect(slot.intent.people).toBe(1);
      expect(slot.intent.energy).toBe(0.5);
    });
    expect(reactions.every((slot) => slot.intent.energy === 0.6 && slot.intent.shotType === 'close')).toBe(
      true,
    );
    expect(slotsNamed(template, 'Outro:')[0]?.intent.people).toBe(2);
    expect(textOn(template, '{show}')).toHaveLength(1);
    expect(textOn(template, '{show}')[0]?.role).toBe('title');
    expect(textOn(template, '{guest}')).toHaveLength(speakers.length >= 2 ? 1 : 0);
    expect(template.slots.every((slot) => slot.transitionIn === null)).toBe(true);
  });

  it('is deterministic with an injected id factory', () => {
    const input = { formatId: 'podcastClip' as const, targetSeconds: 30, createdAt: 5 };
    expect(planFormat(input, countingIds())).toEqual(planFormat(input, countingIds()));
  });
});
