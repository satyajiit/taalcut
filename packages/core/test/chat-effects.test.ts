// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  CHAT_EFFECT_CATEGORIES,
  CHAT_EFFECT_IDS,
  CHAT_EFFECT_SPECS,
  chatEffectIdSchema,
  newId,
  selectionChipSchema,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';

describe('chat effects and effect selection chips', () => {
  it('defines a complete spec with category, label, toolNames, and instruction for every effect id', () => {
    expect(CHAT_EFFECT_IDS.length).toBeGreaterThanOrEqual(15);
    for (const id of CHAT_EFFECT_IDS) {
      expect(chatEffectIdSchema.parse(id)).toBe(id);
      const spec = CHAT_EFFECT_SPECS[id];
      expect(spec.id).toBe(id);
      expect(CHAT_EFFECT_CATEGORIES).toContain(spec.category);
      expect(spec.label.length).toBeGreaterThan(2);
      expect(spec.toolNames.length).toBeGreaterThan(0);
      expect(spec.instruction.length).toBeGreaterThan(20);
    }
  });

  it('parses single and multiple effect selection chips alongside clip, range, and slot chips', () => {
    const clipChip = selectionChipSchema.parse({
      kind: 'clip',
      timelineId: newId<'Timeline'>(),
      clipId: newId<'TimelineItem'>(),
    });
    const effectChip1 = selectionChipSchema.parse({
      kind: 'effect',
      effectId: 'kineticTitle',
    });
    const effectChip2 = selectionChipSchema.parse({
      kind: 'effect',
      effectId: 'whipPan',
    });

    expect(clipChip.kind).toBe('clip');
    expect(effectChip1).toEqual({ kind: 'effect', effectId: 'kineticTitle' });
    expect(effectChip2).toEqual({ kind: 'effect', effectId: 'whipPan' });
    expect(() => selectionChipSchema.parse({ kind: 'effect', effectId: 'notAnEffect' })).toThrow();
  });
});
