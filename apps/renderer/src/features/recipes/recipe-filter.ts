// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which recipes show where (P3-V11): only those whose `needs` are met (the rest are absent, not disabled) and
 * whose `locales` include the UI language. The pseudo-locale gets the 'all' set. There is no feature-flag filter:
 * the agent reports no flags yet, so nothing drops out on that account.
 */
import { RECIPE_CATEGORIES, type RecipeCategory, type SelectionChip } from '@taalcut/core';
import { isAppLocale } from '../../i18n/locales';
import { RECIPES, type Recipe, type RecipeNeed } from './recipes';

/** What is on screen around a composer or an empty state. */
export interface RecipeContext {
  /** A project is open (the editor, its dock, or a chat about it). */
  readonly project: boolean;
  /** That project has a cut. */
  readonly timeline: boolean;
  /** A clip or a stretch of the timeline is picked (a selection chip). */
  readonly clipSelection: boolean;
}

/** A new chat: nothing open. */
export const EMPTY_CONTEXT: RecipeContext = { project: false, timeline: false, clipSelection: false };

/** At most this many chips under an empty state. */
export const MAX_EMPTY_RECIPES = 3;

export function needMet(need: RecipeNeed, context: RecipeContext): boolean {
  switch (need) {
    case 'none':
      return true;
    case 'project':
      return context.project || context.timeline || context.clipSelection;
    case 'timeline':
      return context.timeline || context.clipSelection;
    case 'clipSelection':
      return context.clipSelection;
  }
}

export function inLocale(recipe: Recipe, locale: string): boolean {
  if (recipe.locales === 'all') return true;
  return isAppLocale(locale) && recipe.locales.includes(locale);
}

/** The recipes that fit here, in the catalogue's order. */
export function recipesFor(
  context: RecipeContext,
  locale: string,
  catalogue: readonly Recipe[] = RECIPES,
): Recipe[] {
  return catalogue.filter((recipe) => needMet(recipe.needs, context) && inLocale(recipe, locale));
}

/** The menu's groups: one per category that has a recipe here, in RECIPE_CATEGORIES' order. */
export function groupRecipes(recipes: readonly Recipe[]): { category: RecipeCategory; recipes: Recipe[] }[] {
  return RECIPE_CATEGORIES.map((category) => ({
    category,
    recipes: recipes.filter((recipe) => recipe.category === category),
  })).filter((group) => group.recipes.length > 0);
}

const SPECIFIC: Readonly<Record<RecipeNeed, number>> = { clipSelection: 3, timeline: 2, project: 1, none: 0 };

/**
 * An empty state's chips: the recipes that fit, the ones made for this context first, one per category, at most
 * three.
 */
export function emptyStateRecipes(
  context: RecipeContext,
  locale: string,
  category?: RecipeCategory,
): Recipe[] {
  const fit = recipesFor(context, locale)
    .filter((recipe) => category === undefined || recipe.category === category)
    .sort((a, b) => SPECIFIC[b.needs] - SPECIFIC[a.needs]);
  const picked: Recipe[] = [];
  for (const recipe of fit) {
    if (picked.length === MAX_EMPTY_RECIPES) break;
    if (!picked.some((other) => other.category === recipe.category)) picked.push(recipe);
  }
  return picked;
}

/** The selection chips point at a clip or a stretch of a cut. */
export function pointsAtClips(chips: readonly SelectionChip[]): boolean {
  return chips.some((chip) => chip.kind === 'clip' || chip.kind === 'range');
}

export function recipeById(id: string): Recipe | undefined {
  return RECIPES.find((recipe) => recipe.id === id);
}
