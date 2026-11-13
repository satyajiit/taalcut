// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The recipes (P3-V11): every one is in each catalogue, names what it needs and the commands a run of it must
 * dispatch (real ones), and shows only where its needs are met and in its languages.
 */
import {
  batchCommandPayloads,
  captionCommandPayloads,
  graphicsCommandPayloads,
  mixCommandPayloads,
  musicCommandPayloads,
  RECIPE_CATEGORIES,
  renderCommandPayloads,
  styleCommandPayloads,
  timelineCommandPayloads,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_CONTEXT,
  emptyStateRecipes,
  groupRecipes,
  MAX_EMPTY_RECIPES,
  needMet,
  recipesFor,
  type RecipeContext,
} from '../src/features/recipes/recipe-filter';
import { RECIPE_CATEGORY_LABELS, RECIPE_NEEDS, RECIPES } from '../src/features/recipes/recipes';
import { activateLocale, i18n } from '../src/i18n/i18n';
import { LOCALES } from '../src/i18n/locales';

/** Every command a run may dispatch for an edit, a look, a mix or an export: each has a payload schema in core. */
const REGISTERED = new Set<string>(
  [
    timelineCommandPayloads,
    captionCommandPayloads,
    musicCommandPayloads,
    mixCommandPayloads,
    graphicsCommandPayloads,
    renderCommandPayloads,
    styleCommandPayloads,
    batchCommandPayloads,
  ].flatMap((payloads) => Object.keys(payloads)),
);

const PROJECT: RecipeContext = { project: true, timeline: false, clipSelection: false };
const CUT: RecipeContext = { project: true, timeline: true, clipSelection: false };
const PICKED: RecipeContext = { project: true, timeline: true, clipSelection: true };
const ids = (list: readonly { id: string }[]) => list.map((recipe) => recipe.id);

describe('the recipe catalogue', () => {
  it('has unique ids under their category, a valid need and at least one registered command each', () => {
    expect(new Set(ids(RECIPES)).size).toBe(RECIPES.length);
    for (const recipe of RECIPES) {
      expect(recipe.id.startsWith(`${recipe.category}.`), recipe.id).toBe(true);
      expect(RECIPE_CATEGORIES).toContain(recipe.category);
      expect(RECIPE_NEEDS).toContain(recipe.needs);
      expect(recipe.expects.length, recipe.id).toBeGreaterThan(0);
      for (const command of recipe.expects)
        expect(REGISTERED.has(command), `${recipe.id}: ${command}`).toBe(true);
    }
  });

  it('covers every category, with a heading for each', () => {
    expect(new Set(RECIPES.map((recipe) => recipe.category))).toEqual(new Set(RECIPE_CATEGORIES));
    expect(Object.keys(RECIPE_CATEGORY_LABELS).sort()).toEqual([...RECIPE_CATEGORIES].sort());
  });

  it('has every label, prompt and heading in each language’s catalogue', async () => {
    const descriptors = [
      ...RECIPES.flatMap((recipe) => [recipe.label, recipe.prompt]),
      ...Object.values(RECIPE_CATEGORY_LABELS),
    ];
    for (const locale of LOCALES) {
      await activateLocale(locale);
      const missing = descriptors.filter((descriptor) => !(descriptor.id in i18n.messages));
      expect(
        missing.map((descriptor) => descriptor.message),
        locale,
      ).toEqual([]);
    }
    await activateLocale('en');
  });
});

describe('which recipes show', () => {
  it('meets a need with anything more specific', () => {
    expect(needMet('none', EMPTY_CONTEXT)).toBe(true);
    expect(needMet('project', EMPTY_CONTEXT)).toBe(false);
    expect(needMet('project', PROJECT)).toBe(true);
    expect(needMet('timeline', PROJECT)).toBe(false);
    expect(needMet('timeline', CUT)).toBe(true);
    expect(needMet('clipSelection', CUT)).toBe(false);
    expect(needMet('clipSelection', PICKED)).toBe(true);
    // A picked clip means its project and cut are there, even when nothing else said so.
    expect(needMet('timeline', { ...EMPTY_CONTEXT, clipSelection: true })).toBe(true);
  });

  it('leaves out (never disables) what the context can’t take', () => {
    const empty = recipesFor(EMPTY_CONTEXT, 'en');
    expect(empty.every((recipe) => recipe.needs === 'none')).toBe(true);
    expect(ids(empty)).toEqual(['cut.newReel', 'captions.newReel', 'export.newHooks']);
    const cut = recipesFor(CUT, 'en');
    expect(ids(cut)).toContain('cut.tighten');
    expect(ids(cut)).not.toContain('graphics.callout');
    expect(ids(recipesFor(PICKED, 'en'))).toContain('graphics.callout');
  });

  it('shows each language its own captions recipes, there only (the pseudo-locale gets the shared set)', () => {
    const own: Record<string, readonly string[]> = {
      en: [],
      hi: ['captions.hindi', 'captions.hinglish'],
      es: ['captions.spanish'],
      'pt-BR': ['captions.portuguese'],
      'en-XA': [],
    };
    const shared = RECIPES.filter((recipe) => recipe.locales === 'all').length;
    for (const [locale, mine] of Object.entries(own)) {
      const shown = ids(recipesFor(PICKED, locale));
      expect(shown, locale).toEqual(expect.arrayContaining([...mine]));
      for (const id of Object.values(own).flat())
        expect(shown.includes(id), `${locale}: ${id}`).toBe(mine.includes(id));
      expect(shown, locale).toHaveLength(shared + mine.length);
    }
  });

  it('groups the menu by category in core’s order, with no empty group', () => {
    const groups = groupRecipes(recipesFor(CUT, 'en'));
    expect(groups.map((group) => group.category)).toEqual([...RECIPE_CATEGORIES]);
    expect(groups.every((group) => group.recipes.length > 0)).toBe(true);
    expect(groupRecipes(recipesFor(EMPTY_CONTEXT, 'en')).map((group) => group.category)).toEqual([
      'cut',
      'captions',
      'export',
    ]);
  });

  it('gives an empty state at most three, one per category, the ones made for it first', () => {
    for (const context of [EMPTY_CONTEXT, PROJECT, CUT, PICKED]) {
      const chips = emptyStateRecipes(context, 'hi');
      expect(chips.length).toBeLessThanOrEqual(MAX_EMPTY_RECIPES);
      expect(new Set(chips.map((recipe) => recipe.category)).size).toBe(chips.length);
    }
    expect(ids(emptyStateRecipes(PROJECT, 'en'))).toEqual([
      'cut.newReel',
      'captions.newReel',
      'export.newHooks',
    ]);
    expect(ids(emptyStateRecipes(PICKED, 'en'))[0]).toBe('graphics.callout');
  });
});
