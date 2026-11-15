// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * KEEP1 contract: a template slot may state whose footage it plays (`footage`), `template.slot.setFootage` changes
 * it, and a timeline's cast notes a slot filled from the reel (`reelKept`). The field and the note are additions:
 * a template or a timeline stored before KEEP1 parses to the same document, with nothing added.
 */
import { describe, expect, it } from 'vitest';
import {
  CAST_NOTES,
  keepsReelFootage,
  newId,
  SLOT_FOOTAGE_REASON_CHARS,
  slotCastSchema,
  slotFootageSchema,
  templateCommandPayloads,
  TEMPLATE_COMMANDS,
  TEMPLATE_SCHEMA_VERSION,
  templateSchema,
  templateSlotSchema,
  TemplateNoPersonSlot,
  TemplateNoReel,
  type Template,
} from '@taalcut/core';
import { at, formatTemplate, json, manualTemplate, referenceTemplate } from './helpers/documents';

const film = { from: 'reel', by: 'analyst', reason: 'A film scene the joke lands on' } as const;

describe('a slot’s footage (KEEP1)', () => {
  it('states whose footage it is, who said so and why', () => {
    expect(slotFootageSchema.parse(film)).toEqual(film);
    expect(slotFootageSchema.parse({ from: 'person', by: 'user', reason: null })).toEqual({
      from: 'person',
      by: 'user',
      reason: null,
    });
    for (const bad of [
      { from: 'stock', by: 'analyst', reason: null },
      { from: 'reel', by: 'maker', reason: null },
      { from: 'reel', by: 'analyst' },
      { from: 'reel', by: 'analyst', reason: '   ' },
      { from: 'reel', by: 'analyst', reason: 'x'.repeat(SLOT_FOOTAGE_REASON_CHARS + 1) },
    ])
      expect(slotFootageSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(keepsReelFootage({ footage: film })).toBe(true);
    expect(keepsReelFootage({ footage: { from: 'person', by: 'user', reason: null } })).toBe(false);
    expect(keepsReelFootage({})).toBe(false);
  });

  it('is on the slot, and a template with it parses and serialises unchanged', () => {
    const template = structuredClone(referenceTemplate());
    template.slots[1]!.footage = { ...film };
    const parsed = templateSchema.parse(json(template));
    expect(parsed).toEqual(template);
    expect(parsed.slots[1]!.footage).toEqual(film);
    expect(templateSlotSchema.safeParse({ ...template.slots[1], footage: { from: 'reel' } }).success).toBe(
      false,
    );
  });

  it.each([
    ['reference', referenceTemplate],
    ['format', formatTemplate],
    ['manual', manualTemplate],
  ])('a %s template stored before KEEP1 reads as it was: no version bump, no field added', (_name, make) => {
    const stored = json(make()) as Template;
    expect(TEMPLATE_SCHEMA_VERSION).toBe(1);
    expect(stored.slots.every((slot) => !('footage' in slot))).toBe(true);
    const parsed = templateSchema.parse(stored);
    expect(json(parsed)).toEqual(stored);
    expect(parsed.slots.every((slot) => !('footage' in slot))).toBe(true);
    expect(parsed.slots.some(keepsReelFootage)).toBe(false);
  });

  it('template.slot.setFootage takes the slot and whose footage, nothing else', () => {
    expect(TEMPLATE_COMMANDS.setFootage).toBe('template.slot.setFootage');
    const schema = templateCommandPayloads[TEMPLATE_COMMANDS.setFootage];
    const where = { projectId: newId<'Project'>(), templateId: newId<'Template'>(), baseVersion: 3 };
    const slotId = newId<'TemplateSlot'>();
    expect(schema.parse({ ...where, slotId, from: 'reel' })).toEqual({ ...where, slotId, from: 'reel' });
    expect(schema.safeParse({ ...where, slotId, from: 'film' }).success).toBe(false);
    expect(schema.safeParse({ ...where, from: 'reel' }).success).toBe(false);
    expect(TemplateNoPersonSlot().code).toBe('templates.no_person_slot');
    expect(TemplateNoReel().code).toBe('templates.no_reel');
  });
});

describe('a cast slot filled from the reel (KEEP1)', () => {
  it('is noted reelKept, after every note there was', () => {
    expect(CAST_NOTES.slice(0, 7)).toEqual([
      'noCandidates',
      'orientationRelaxed',
      'reranked',
      'userPick',
      'gapFilled',
      'dropped',
      'filmRequested',
    ]);
    expect(CAST_NOTES.at(-1)).toBe('reelKept');
    const slot = {
      slotId: newId<'TemplateSlot'>(),
      clipId: newId<'TimelineItem'>(),
      pick: {
        assetId: newId<'Asset'>(),
        shotId: null,
        sourceStart: at(324),
        syncPoint: null,
        score: 0,
        parts: {
          intent: 0,
          motion: 0,
          quality: 0,
          subject: 0,
          energy: 0,
          hook: null,
          rerank: null,
          penalty: 0,
        },
      },
      alternates: [],
      confidence: null,
      needsRerank: false,
      note: 'reelKept',
    };
    expect(slotCastSchema.parse(json(slot))).toEqual(slot);
  });
});
