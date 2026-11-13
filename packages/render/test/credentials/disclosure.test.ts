// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { PLATFORMS } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { aiInventory } from '../../src/credentials/ai-inventory';
import { DISCLOSURE_V1, disclosuresFor } from '../../src/credentials/disclosure.v1';
import { partsTimeline } from './support';

describe('disclosure reminders', () => {
  it('is versioned data with the day it was checked', () => {
    expect(DISCLOSURE_V1.version).toBe(1);
    expect(DISCLOSURE_V1.checkedOn).toBe('2026-10-14');
    expect(DISCLOSURE_V1.reminders.map((entry) => entry.platform)).toEqual([...PLATFORMS]);
  });

  it('names an i18n key, an https source and default English for every platform', () => {
    for (const entry of DISCLOSURE_V1.reminders) {
      expect(entry.titleKey).toBe(`render.disclosure.${entry.platform}.title`);
      expect(entry.stepsKey).toBe(`render.disclosure.${entry.platform}.steps`);
      expect(entry.source).toMatch(/^https:\/\//);
      expect(entry.defaultText.title.length).toBeGreaterThan(0);
      expect(entry.defaultText.steps.length).toBeGreaterThan(40);
    }
  });

  it('reminds on every platform whenever a model made a part, toggle on or off, and never otherwise', () => {
    const generated = partsTimeline({ clips: [false], voice: [false], voiceoverLines: [0] });
    expect(disclosuresFor(aiInventory(generated.timeline, generated.provenanceOf))).toEqual([
      'shorts',
      'reels',
      'tiktok',
    ]);
    const captured = partsTimeline({ clips: [false, false], music: 'ownTrack' });
    expect(disclosuresFor(aiInventory(captured.timeline, captured.provenanceOf))).toEqual([]);
  });
});
