// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: recipe chips (an empty state's starters) · genre: atmospheric studio app (chrome
 *   modern-minimal) · system: DESIGN.md v0.3 · up to three quiet pill buttons under an empty state's one action:
 *   a neutral sunken wash, a hairline, 12 px semibold ink-2 words after their task's glyph; they wrap, never
 *   scroll sideways; never on brand moments
 * states: default · hover (the hover surface, ink, a firmer rule) · focus-visible (the base ring, instant) ·
 *   active (press: scale 0.97; reduced motion: none) · disabled (ink-disabled on the canvas, no hover) ·
 *   loading: none (a pick only fills the composer, at once) · error: none (nothing is sent) · success (the
 *   prompt is in the composer, unsent, focus on it)
 * contrast: ink-2 on sunken (7:1), the rule-subtle hairline is decorative (the words carry the shape)
 * pre-emit critique: P5 H4 E5 S4 R5 V4 */

import { cn } from '#lib/cn';
import type { RecipeItem } from './recipe-types';

/** At most this many chips under an empty state (renderer SPEC P3-V11). */
export const MAX_RECIPE_CHIPS = 3;

export interface RecipeChipsProps {
  readonly items: readonly RecipeItem[];
  readonly onPick: (recipeId: string) => void;
  /** The group's accessible name ("Recipes"). */
  readonly label: string;
  readonly disabled?: boolean;
  /** `compact` (24 px) fits a timeline track's row; the default (32 px) sits under an empty state. */
  readonly size?: 'default' | 'compact';
  readonly className?: string;
}

const SIZE = {
  default: cn('h-8 px-3 text-xs'),
  compact: cn('h-6 px-2.5 text-2xs'),
} as const;

const CHIP = cn(
  'inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-pill border border-rule-subtle bg-chip',
  'font-semibold text-ink-2',
  'transition-[background-color,color,border-color,transform] duration-(--dur-micro) ease-(--ease-out)',
  'hover:border-rule hover:bg-hover hover:text-ink',
  'active:scale-[0.97] motion-reduce:active:scale-100',
  'disabled:cursor-default disabled:border-rule-subtle disabled:bg-transparent disabled:text-ink-disabled',
  '[&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-ink-3',
);

/** Up to three recipes under an empty state's action (P3-V11, U5). A pick hands the id to the host. */
export function RecipeChips({
  items,
  onPick,
  label,
  disabled = false,
  size = 'default',
  className,
}: RecipeChipsProps) {
  if (items.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={label}
      data-slot="recipe-chips"
      className={cn('flex flex-wrap gap-2', className)}
    >
      {items.slice(0, MAX_RECIPE_CHIPS).map(({ id, label: words, icon: Icon }) => (
        <button
          key={id}
          type="button"
          data-recipe={id}
          className={cn(CHIP, SIZE[size])}
          disabled={disabled}
          onClick={() => onPick(id)}
        >
          {Icon ? <Icon aria-hidden /> : null}
          <span className="truncate">{words}</span>
        </button>
      ))}
    </div>
  );
}
