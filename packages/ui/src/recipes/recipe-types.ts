// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { LucideIcon } from 'lucide-react';

/** One recipe as the kit shows it: already translated, already filtered for where it shows (P3-V11, U5). */
export interface RecipeItem {
  readonly id: string;
  /** The chip's words: "Tighten the cut". */
  readonly label: string;
  /** Its task's glyph (decorative): on a chip, where no heading names the task. */
  readonly icon?: LucideIcon;
}

/** Recipes of one task ("Cut", "Captions"…), in the menu under its heading. */
export interface RecipeGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly RecipeItem[];
}

/** The composer's Recipes button and its menu. Without it (or with no recipes) the button doesn't show. */
export interface ComposerRecipes {
  /** Already filtered for this context and locale, already translated. */
  readonly groups: readonly RecipeGroup[];
  /** The host puts the recipe's prompt into the box, unsent (the same path as CardActions.ask). */
  onPick(recipeId: string): void;
}
