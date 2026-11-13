// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import type { EnergyCurve, Template } from '@taalcut/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { GOLDEN_TIMELINES } from '../src/backend/fake/make/ids';
import {
  beatsForEnergy,
  energyCurveOf,
  fasterEnergy,
  mergeNext,
  middleSplit,
  sectionSlots,
  slowerEnergy,
  splitAt,
  withBeats,
  withEnergy,
} from '../src/features/timeline/energy/energy-model';
import {
  bandName,
  bandValueText,
  energyErrorWords,
  pacingWords,
  replanWords,
} from '../src/features/timeline/energy/pacing-words';
import { activateLocale } from '../src/i18n/i18n';

async function golden(): Promise<Template> {
  const { client } = createFakeBackend({ phase2: { library: { tickMs: 0 } }, make: { renderTickMs: 0 } });
  const timeline = await client.timelines.get({ timelineId: GOLDEN_TIMELINES[0]! });
  const ref = timeline.template!;
  return (await client.templates.get({ templateId: ref.id, version: ref.version })).template;
}

/** Every slot in exactly one band, in order. */
function coversEverySlot(template: Template, curve: EnergyCurve) {
  const spans = sectionSlots(template, curve);
  expect(spans[0]?.from).toBe(0);
  expect(spans.at(-1)?.to).toBe(template.slots.length - 1);
  spans.slice(1).forEach((span, at) => expect(span.from).toBe((spans[at]?.to ?? -2) + 1));
}

describe('the energy curve as the Pacing tab edits it (P3-V12)', () => {
  beforeAll(() => activateLocale('en'));

  it('energy sets the pacing at config/energy.v1.json’s steps', () => {
    expect([1, 0.85, 0.84, 0.65, 0.5, 0.4, 0.3, 0.2, 0.1, 0].map(beatsForEnergy)).toEqual([
      1, 1, 2, 2, 4, 4, 8, 8, 16, 16,
    ]);
  });

  it('Faster and Slower are a drag’s equal: one pacing step, stopping at the ends', () => {
    expect([0.5, 0.65, 0.85, 1].map(fasterEnergy)).toEqual([0.65, 0.85, 1, null]);
    expect([0.7, 0.4, 0.2, 0.1, 0].map(slowerEnergy)).toEqual([0.4, 0.2, 0, 0, null]);
  });

  it('a band’s new energy lands on a whole percent and sets its pacing; the menu’s beats keep the energy', async () => {
    const template = await golden();
    const curve = energyCurveOf(template);
    expect(curve.sections.length).toBe(5);
    coversEverySlot(template, curve);

    const raised = withEnergy(curve, 1, 0.873);
    expect(raised.sections[1]).toMatchObject({ energy: 0.87, beatsPerClip: 1 });
    expect(withEnergy(curve, 1, 1.4).sections[1]?.energy).toBe(1);
    expect(raised.sections.filter((_, at) => at !== 1)).toEqual(curve.sections.filter((_, at) => at !== 1));

    const typed = withBeats(raised, 1, 8);
    expect(typed.sections[1]).toMatchObject({ energy: 0.87, beatsPerClip: 8 });
  });

  it('S splits a band at a slot boundary and M merges it back, every slot still in one band', async () => {
    const template = await golden();
    const curve = energyCurveOf(template);
    const widest = sectionSlots(template, curve).findIndex((span) => span.to > span.from);
    const after = middleSplit(template, curve, widest);
    expect(after).not.toBeNull();
    const split = splitAt(template, curve, widest, after ?? -1);
    expect(split?.sections.length).toBe(6);
    coversEverySlot(template, split ?? curve);
    // A split can't fall outside the band.
    expect(splitAt(template, curve, widest, template.slots.length - 1)).toBeNull();

    const merged = mergeNext(split ?? curve, widest);
    expect(merged?.sections.length).toBe(5);
    expect(sectionSlots(template, merged ?? curve)).toEqual(sectionSlots(template, curve));
    expect(mergeNext(curve, curve.sections.length - 1)).toBeNull();
  });

  it('says the band and the change in words', () => {
    expect(pacingWords(i18n, 2)).toBe('Cut every 2 beats');
    expect(pacingWords(i18n, 1)).toBe('Cut every beat');
    expect(pacingWords(i18n, 0.5)).toBe('Cut every half beat');
    expect(bandValueText(i18n, 0.8, 1)).toBe('Energy 80%, cut every beat');
    expect(bandValueText(i18n, 0.35, 8)).toBe('Energy 35%, cut every 8 beats');
    expect(bandName(i18n, 1, 5)).toBe('Section 2 of 5');
    expect(replanWords(i18n, 4, 6)).toBe('4 shots will be picked again');
    expect(replanWords(i18n, 0, 3)).toBe('3 cuts move; your shots stay');
    expect(replanWords(i18n, 0, 0)).toBe('The cuts stay where they are');
    expect(energyErrorWords(i18n, { code: 'templates.no_beat_map', messageKey: 'x', retryable: false })).toBe(
      'This video follows speech, not music beats',
    );
  });
});
