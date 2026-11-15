// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MATCH1 contract: a template slot may state a moment that must land on its start or end (`lands`). The field is
 * an addition: a template stored before MATCH1 parses to the same document, with nothing added.
 */
import { describe, expect, it } from 'vitest';
import {
  SLOT_EDGES,
  SLOT_MOMENT_CHARS,
  slotLandsSchema,
  TEMPLATE_SCHEMA_VERSION,
  templateSchema,
  templateSlotSchema,
  type Template,
} from '@taalcut/core';
import { formatTemplate, json, manualTemplate, referenceTemplate } from './helpers/documents';

const press = { edge: 'end', moment: 'A hand reaches the switch as the shot ends' } as const;

describe('a moment that lands on a slot’s edge (MATCH1)', () => {
  it('states the edge and what is seen, in one short line', () => {
    expect(SLOT_EDGES).toEqual(['start', 'end']);
    expect(slotLandsSchema.parse(press)).toEqual(press);
    expect(slotLandsSchema.parse({ edge: 'start', moment: '  The door opens  ' })).toEqual({
      edge: 'start',
      moment: 'The door opens',
    });
    for (const bad of [
      { edge: 'middle', moment: 'The door opens' },
      { edge: 'end' },
      { edge: 'end', moment: '   ' },
      { edge: 'end', moment: 'x'.repeat(SLOT_MOMENT_CHARS + 1) },
    ])
      expect(slotLandsSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it('is on the slot, and a template with it parses and serialises unchanged', () => {
    const template = structuredClone(referenceTemplate());
    template.slots[0]!.lands = { ...press };
    const parsed = templateSchema.parse(json(template));
    expect(parsed).toEqual(template);
    expect(parsed.slots[0]!.lands).toEqual(press);
    expect(templateSlotSchema.safeParse({ ...template.slots[0], lands: { edge: 'end' } }).success).toBe(
      false,
    );
  });

  it.each([
    ['reference', referenceTemplate],
    ['format', formatTemplate],
    ['manual', manualTemplate],
  ])('a %s template stored before MATCH1 reads as it was: no version bump, no field added', (_name, make) => {
    const stored = json(make()) as Template;
    expect(TEMPLATE_SCHEMA_VERSION).toBe(1);
    expect(stored.slots.every((slot) => !('lands' in slot))).toBe(true);
    const parsed = templateSchema.parse(stored);
    expect(json(parsed)).toEqual(stored);
    expect(parsed.slots.every((slot) => !('lands' in slot))).toBe(true);
  });
});
