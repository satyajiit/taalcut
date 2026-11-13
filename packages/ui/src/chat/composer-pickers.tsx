// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { useId, useRef, useState, type ReactNode } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '../components/popover';
import { EffectsButton, EffectsSheet } from '../effects/effects-picker';
import type { ComposerEffects } from '../effects/effect-types';
import { RecipeButton, RecipeSheet } from '../recipes/recipe-picker';
import type { ComposerRecipes } from '../recipes/recipe-types';

type Sheet = 'recipes' | 'effects';

export interface ComposerPickersProps {
  readonly recipes?: ComposerRecipes | undefined;
  readonly effects?: ComposerEffects | undefined;
  /** The composer's text box: where focus goes after a pick. */
  readonly focusBox: () => void;
  /** The composer, given the tool row's buttons; it becomes the sheets' anchor. */
  readonly children: (tools: ReactNode) => ReactNode;
}

/**
 * The composer's Recipes and Effects sheets (UX4, B14): one at a time, anchored to the whole composer so a sheet
 * opens above it at its width and never covers it, its tool row or the window bar. Focus goes into the sheet; after a
 * pick it goes to the text box, else back to the button that opened it.
 */
export function ComposerPickers({ recipes, effects, focusBox, children }: ComposerPickersProps) {
  const { t } = useLingui();
  const [open, setOpen] = useState<Sheet | null>(null);
  const sheetId = useId();
  const picked = useRef(false);
  const toggled = useRef(false);
  const buttons = { recipes: useRef<HTMLButtonElement>(null), effects: useRef<HTMLButtonElement>(null) };
  const opener = useRef<Sheet | null>(null);
  const hasRecipes = (recipes?.groups.some((group) => group.items.length > 0) ?? false) && recipes;
  const hasEffects = (effects?.groups.some((group) => group.items.length > 0) ?? false) && effects;

  const close = () => {
    if (open === 'effects' && toggled.current) effects?.onClose?.();
    setOpen(null);
  };
  const toggle = (sheet: Sheet) => {
    if (open === sheet) return close();
    if (open === 'effects' && toggled.current) effects?.onClose?.();
    toggled.current = false;
    opener.current = sheet;
    setOpen(sheet);
  };

  const tools =
    hasRecipes || hasEffects ? (
      <>
        {hasRecipes ? (
          <RecipeButton
            ref={buttons.recipes}
            open={open === 'recipes'}
            sheetId={sheetId}
            onClick={() => toggle('recipes')}
          />
        ) : null}
        {hasEffects ? (
          <EffectsButton
            ref={buttons.effects}
            effects={hasEffects}
            open={open === 'effects'}
            sheetId={sheetId}
            onClick={() => toggle('effects')}
          />
        ) : null}
      </>
    ) : null;

  return (
    <Popover open={open !== null} onOpenChange={(next) => (next ? undefined : close())}>
      <PopoverAnchor asChild>{children(tools)}</PopoverAnchor>
      <PopoverContent
        id={sheetId}
        side="top"
        align="start"
        sideOffset={8}
        // Clear of the window bar above, and of the window's edges.
        collisionPadding={{ top: 64, right: 12, bottom: 12, left: 12 }}
        aria-label={open === 'effects' ? t`Effects` : t`Recipes`}
        data-sheet={open ?? undefined}
        className="w-(--radix-popover-trigger-width) max-w-none gap-0 overflow-hidden p-0 shadow-lg"
        // The buttons open and close their sheet themselves: a press on one isn't a click outside.
        onInteractOutside={(event) => {
          const target = event.target instanceof Element ? event.target : null;
          if (target?.closest('[data-picker-button]')) event.preventDefault();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const sheet = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
          sheet?.querySelector<HTMLElement>('[data-picker-tile][tabindex="0"]')?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (picked.current || toggled.current) focusBox();
          else if (opener.current) buttons[opener.current].current?.focus();
          picked.current = false;
          toggled.current = false;
        }}
      >
        {open === 'effects' && hasEffects ? (
          <EffectsSheet
            effects={{
              ...hasEffects,
              onToggle: (id) => {
                toggled.current = true;
                hasEffects.onToggle(id);
              },
              onClear: () => {
                toggled.current = true;
                hasEffects.onClear?.();
              },
            }}
            onClose={close}
          />
        ) : open === 'recipes' && hasRecipes ? (
          <RecipeSheet
            recipes={hasRecipes}
            onPicked={() => {
              picked.current = true;
              setOpen(null);
            }}
            onClose={close}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
