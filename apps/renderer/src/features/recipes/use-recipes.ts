// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Recipes in the window (P3-V11): what is on screen (the context), the kit's menu groups and chips for it, and a
 * pick: the prompt goes into the composer unsent (the same path as a card's "Ask about…", so selection chips stay
 * and the composer takes the focus) and the window counts `recipe.used { category }` (kept only with usage
 * counts on).
 */
import { useLingui } from '@lingui/react/macro';
import { callRpc, type ProjectId, type RecipeCategory, type TimelineSummary } from '@taalcut/core';
import type { ComposerRecipes, RecipeItem } from '@taalcut/ui';
import {
  Captions,
  Music,
  Palette,
  RectangleVertical,
  Scissors,
  Type,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useBackendEvents } from '../../backend/use-events';
import { useRpcQuery } from '../../backend/use-rpc';
import { askWith, useSelections } from '../../chat/selection-store';
import { useCurrentProject } from '../../shell/current-project';
import {
  emptyStateRecipes,
  groupRecipes,
  pointsAtClips,
  recipeById,
  recipesFor,
  type RecipeContext,
} from './recipe-filter';
import { RECIPE_CATEGORY_LABELS, type Recipe } from './recipes';

const ICONS: Readonly<Record<RecipeCategory, LucideIcon>> = {
  cut: Scissors,
  captions: Captions,
  music: Music,
  graphics: Type,
  style: Palette,
  reframe: RectangleVertical,
  export: Upload,
};

const NO_TIMELINES: readonly TimelineSummary[] = [];

/**
 * What is on screen around a composer: the project it talks about (`projectId`, else the one the editor has open),
 * whether that project has a cut, and whether a clip or a stretch of one is picked.
 */
export function useRecipeContext(projectId?: ProjectId | null): RecipeContext {
  const backend = useBackend();
  const open = useCurrentProject();
  const project = projectId ?? open;
  const [round, setRound] = useState(0);
  useBackendEvents(['library.changed'], ({ payload }) => {
    if (project && payload.projectId === project && payload.entity === 'timeline') setRound((n) => n + 1);
  });
  const timelines = useRpcQuery(
    async (signal) =>
      project ? backend.timelines.listByProject({ projectId: project }, { signal }) : NO_TIMELINES,
    [backend, project, round],
  );
  const hasCut = (timelines.data ?? NO_TIMELINES).some((timeline) => timeline.clipCount > 0);
  const pending = useSelections();
  const picked = useMemo(() => pointsAtClips(pending.map((entry) => entry.chip)), [pending]);
  return useMemo(
    () => ({ project: project !== null, timeline: hasCut, clipSelection: picked }),
    [project, hasCut, picked],
  );
}

/** A pick: the prompt into the composer, unsent; the category counted. */
export function useRecipePick(): (recipeId: string) => void {
  const backend = useBackend();
  const { i18n } = useLingui();
  return useCallback(
    (recipeId: string) => {
      const recipe = recipeById(recipeId);
      if (!recipe) return;
      askWith(i18n._(recipe.prompt), []);
      void callRpc(backend.telemetry.record({ event: { name: 'recipe.used', category: recipe.category } }));
    },
    [backend, i18n],
  );
}

function useItems(): (recipes: readonly Recipe[]) => RecipeItem[] {
  const { i18n } = useLingui();
  return useCallback(
    (recipes) =>
      recipes.map((recipe) => ({ id: recipe.id, label: i18n._(recipe.label), icon: ICONS[recipe.category] })),
    [i18n],
  );
}

/** The composer's Recipes menu for this context and language; undefined (no button) when nothing fits. */
export function useComposerRecipes(context: RecipeContext): ComposerRecipes | undefined {
  const { i18n } = useLingui();
  const locale = i18n.locale;
  const items = useItems();
  const onPick = useRecipePick();
  return useMemo(() => {
    const groups = groupRecipes(recipesFor(context, locale)).map((group) => ({
      id: group.category,
      label: i18n._(RECIPE_CATEGORY_LABELS[group.category]),
      items: items(group.recipes),
    }));
    return groups.length > 0 ? { groups, onPick } : undefined;
  }, [context, locale, i18n, items, onPick]);
}

/** An empty state's chips (at most three) for this context and language. */
export function useEmptyStateRecipes(
  context: RecipeContext,
  category?: RecipeCategory,
): readonly RecipeItem[] {
  const { i18n } = useLingui();
  const locale = i18n.locale;
  const items = useItems();
  return useMemo(
    () => items(emptyStateRecipes(context, locale, category)),
    [context, locale, category, items],
  );
}
