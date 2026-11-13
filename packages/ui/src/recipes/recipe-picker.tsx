// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · component: the composer's Recipes picker (UX4, B14: the Effects picker's anatomy) · Operate
 * system: DESIGN.md v0.7 · the Recipes button in the tool row and its sheet above the composer: starter sentences by
 *   task, each tile its task's glyph in a square, its words, and nothing else. One pick: the sentence goes in the
 *   box, unsent, the sheet closes and the focus is in the box. Nothing is sent from here.
 * states: as PickerButton and PickerSheet (composer-picker.tsx) */
import { useLingui } from '@lingui/react/macro';
import { BookOpenText } from 'lucide-react';
import { forwardRef } from 'react';
import { PickerButton, PickerSheet } from '../chat/composer-picker';
import type { ComposerRecipes } from './recipe-types';

export interface RecipeButtonProps {
  readonly open: boolean;
  readonly sheetId: string;
  readonly onClick: () => void;
}

/** The tool row's Recipes button. */
export const RecipeButton = forwardRef<HTMLButtonElement, RecipeButtonProps>(function RecipeButton(
  { open, sheetId, onClick },
  ref,
) {
  const { t } = useLingui();
  return (
    <PickerButton
      ref={ref}
      data-slot="recipes-button"
      data-picker-button=""
      icon={<BookOpenText />}
      label={t`Recipes`}
      open={open}
      sheetId={sheetId}
      onClick={onClick}
    />
  );
});

/** The sheet: recipes by task. A pick hands the id to the host, which puts the sentence in the box. */
export function RecipeSheet({
  recipes,
  onPicked,
  onClose,
}: {
  recipes: ComposerRecipes;
  onPicked: () => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const groups = recipes.groups
    .filter((group) => group.items.length > 0)
    .map((group) => ({
      id: group.id,
      label: group.label,
      tiles: group.items.map(({ id, label, icon: Icon = BookOpenText }) => ({
        id,
        label,
        picture: (
          <span
            aria-hidden
            className="grid size-9 shrink-0 place-items-center rounded-md bg-chip text-ink-2 [&_svg]:size-4"
          >
            <Icon />
          </span>
        ),
      })),
    }));
  return (
    <PickerSheet
      slot="recipe-menu"
      title={t`Recipes`}
      hint={t`A sentence to start from goes in the box. Change it or send it.`}
      groups={groups}
      mode="one"
      tileAttribute="data-recipe"
      onPick={(id) => {
        onPicked();
        recipes.onPick(id);
      }}
      onClose={onClose}
    />
  );
}
