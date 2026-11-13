// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { CHAT_EFFECT_CATEGORIES, CHAT_EFFECT_IDS } from '@taalcut/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearEffectSelections,
  resetSelectionsForTests,
  selectionKey,
  selectionStore,
  toggleSelection,
} from '../src/chat/selection-store';
import {
  buildEffectGroups,
  EFFECT_CATEGORY_LABELS,
  EFFECT_COPY,
  starterPromptForEffects,
} from '../src/features/effects/effects';
import { activateLocale, i18n } from '../src/i18n/i18n';

describe('the Composer video effects catalogue and selection store', () => {
  beforeEach(async () => {
    resetSelectionsForTests();
    await activateLocale('en');
  });

  it('groups all 19 effect ids under the 4 categories with localised labels and descriptions', () => {
    const groups = buildEffectGroups(i18n);
    expect(groups.map((g) => g.id)).toEqual([...CHAT_EFFECT_CATEGORIES]);
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
    const totalItems = groups.flatMap((g) => g.items);
    expect(totalItems.map((item) => item.id).sort()).toEqual([...CHAT_EFFECT_IDS].sort());
    for (const item of totalItems) {
      expect(item.label.length).toBeGreaterThan(2);
      expect(item.description && item.description.length).toBeGreaterThan(5);
    }
    expect(Object.keys(EFFECT_CATEGORY_LABELS).sort()).toEqual([...CHAT_EFFECT_CATEGORIES].sort());
    expect(Object.keys(EFFECT_COPY).sort()).toEqual([...CHAT_EFFECT_IDS].sort());
  });

  it('builds a clean starter prompt for single and multiple effects', () => {
    expect(starterPromptForEffects(i18n, [])).toBe('');
    expect(starterPromptForEffects(i18n, ['kineticTitle'])).toBe('Apply effects: Word-by-word title');
    expect(starterPromptForEffects(i18n, ['kineticTitle', 'whipPan', 'popCaptions'])).toBe(
      'Apply effects: Word-by-word title, Whip pan, Pop captions',
    );
  });

  it('toggles single and multiple effect chips in selectionStore and clears only effect chips', () => {
    expect(selectionKey({ kind: 'effect', effectId: 'kineticTitle' })).toBe('effect:kineticTitle');

    expect(toggleSelection({ kind: 'effect', effectId: 'kineticTitle' })).toBe('added');
    expect(toggleSelection({ kind: 'effect', effectId: 'whipPan' })).toBe('added');
    expect(selectionStore.selections().map((s) => s.key)).toEqual(['effect:kineticTitle', 'effect:whipPan']);

    // Toggling an already selected effect removes it
    expect(toggleSelection({ kind: 'effect', effectId: 'kineticTitle' })).toBe('removed');
    expect(selectionStore.selections().map((s) => s.key)).toEqual(['effect:whipPan']);

    // Clear effects removes effect chips while leaving non-effect chips intact
    clearEffectSelections();
    expect(selectionStore.selections()).toEqual([]);
  });
});
