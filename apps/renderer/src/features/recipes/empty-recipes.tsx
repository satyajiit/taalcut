// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: empty-state recipes (wiring) · system: DESIGN.md v0.3 · the kit's RecipeChips under an
 *   empty state's one action: up to three starters that fit what is on screen · states: the kit's */

import { useLingui } from '@lingui/react/macro';
import type { RecipeCategory } from '@taalcut/core';
import { RecipeChips } from '@taalcut/ui';
import type { RecipeContext } from './recipe-filter';
import { useEmptyStateRecipes, useRecipePick } from './use-recipes';

export interface EmptyRecipesProps {
  readonly context: RecipeContext;
  /** Only this task's recipes (an empty caption row offers caption starters). */
  readonly category?: RecipeCategory;
  readonly size?: 'default' | 'compact';
  readonly className?: string;
}

/**
 * Up to three recipe chips for an empty state; nothing when none fits. A pick fills the composer, unsent, so the
 * chips stay live while a run goes.
 */
export function EmptyRecipes({ context, category, size, className }: EmptyRecipesProps) {
  const { t } = useLingui();
  const items = useEmptyStateRecipes(context, category);
  const onPick = useRecipePick();
  return (
    <RecipeChips
      items={items}
      onPick={onPick}
      label={t`Recipes`}
      {...(size ? { size } : {})}
      {...(className ? { className } : {})}
    />
  );
}
