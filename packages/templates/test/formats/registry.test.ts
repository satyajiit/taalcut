// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { FORMAT_IDS } from '@taalcut/core';
import { FORMAT_MODULES } from '../../src/formats/catalog';
import { defineFormat, type FormatSection } from '../../src/formats/format-module';
import { LABEL_BOX } from '../../src/formats/boxes';
import { createFormatRegistry, FORMAT_SUMMARIES } from '../../src/formats/registry';

const seed = {
  text: 'A slot',
  shotType: null,
  motion: null,
  subject: null,
  people: null,
  energy: 0.4,
} as const;

function slot(key: string, extra: Partial<FormatSection> = {}): FormatSection {
  return {
    key,
    role: key === 'hook' ? 'hook' : 'body',
    count: key === 'fill' ? { min: 0, pref: () => 0, max: 0 } : { min: 1, pref: () => 1, max: 1 },
    beats: key === 'hook' ? 'hook' : { min: 2, pref: 2, max: 4 },
    intent: () => seed,
    ...extra,
  };
}

function draft(sections: readonly FormatSection[], id = 'vlog') {
  return {
    id,
    version: '1.0.0',
    nameKey: `formats.${id}.name`,
    descriptionKey: `formats.${id}.description`,
    minSeconds: 6,
    maxSeconds: 90,
    defaultBpm: 120,
    audio: 'music' as const,
    captions: 'optional' as const,
    sections,
  };
}

const validSections = [slot('hook'), slot('fill', { fill: true }), slot('outro', { role: 'outro' })];

describe('format registry', () => {
  it('has exactly one module for every core format id, in that order', () => {
    expect(FORMAT_MODULES.map((module) => module.id)).toEqual([...FORMAT_IDS]);
    expect(new Set(FORMAT_MODULES.map((module) => module.id)).size).toBe(FORMAT_IDS.length);
    expect(FORMAT_SUMMARIES.map((format) => format.id)).toEqual([...FORMAT_IDS]);
  });

  it('refuses a module that cannot be planned', () => {
    expect(defineFormat(draft([slot('hook'), slot('outro')])).ok).toBe(false);
    expect(
      defineFormat(draft([slot('hook'), slot('fill', { fill: true }), slot('more', { fill: true })])).ok,
    ).toBe(false);
    expect(
      defineFormat(
        draft([
          slot('hook'),
          slot('fill', { fill: true }),
          slot('wide', { count: { min: 4, pref: () => 4, max: 1 } }),
        ]),
      ).ok,
    ).toBe(false);
    expect(
      defineFormat(
        draft([
          slot('hook'),
          slot('fill', { fill: true, label: { text: '{nope}', role: 'label', box: LABEL_BOX } }),
        ]),
      ).ok,
    ).toBe(false);
    expect(
      defineFormat(
        draft([
          slot('hook'),
          slot('fill', {
            fill: true,
            label: { text: '{label}', role: 'label', box: { x: 0, y: 0.2, width: 0.2, height: 0.05 } },
          }),
        ]),
      ).ok,
    ).toBe(false);
    expect(defineFormat(draft(validSections, 'podcast')).ok).toBe(false);
    expect(defineFormat(draft(validSections)).ok).toBe(true);
  });

  it('refuses a duplicate id and an id outside FORMAT_IDS', () => {
    const defined = defineFormat(draft(validSections));
    expect(defined.ok).toBe(true);
    if (!defined.ok) return;
    expect(createFormatRegistry([defined.value, defined.value]).ok).toBe(false);
    expect(createFormatRegistry([{ ...defined.value, id: 'podcast' }]).ok).toBe(false);
    expect(createFormatRegistry([defined.value]).ok).toBe(true);
  });
});
