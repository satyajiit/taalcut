// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The button's classes (button.tsx), apart from Next's Link so anything can wear them: a form's submit, a fixture. */
import { cn } from '#lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet';
export type ButtonSize = 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill border select-none ' +
  'transition-[background-color,color,border-color,transform] duration-(--dur-micro) ease-(--ease-out) ' +
  'not-disabled:active:scale-[0.98] motion-reduce:active:scale-100 aria-busy:cursor-progress ' +
  'disabled:cursor-not-allowed disabled:bg-control disabled:border-rule-subtle disabled:text-ink-disabled';

const VARIANTS: Record<ButtonVariant, string> = {
  // The marigold fill is too light to stand alone on white, so it takes its -strong border; hover and press deepen
  // the fill under the same ink.
  primary:
    'bg-marigold text-marigold-ink border-marigold-strong font-semibold not-disabled:hover:bg-marigold-hover ' +
    'not-disabled:active:bg-marigold-hover',
  secondary: 'bg-control text-ink border-rule not-disabled:hover:bg-control-hover not-disabled:active:bg-control-pressed',
  quiet:
    'bg-transparent text-ink-2 border-transparent not-disabled:hover:bg-hover not-disabled:hover:text-ink ' +
    'not-disabled:active:bg-pressed',
};

const SIZES: Record<ButtonSize, string> = {
  md: 'h-10 px-4 type-label',
  lg: 'h-12 px-6 type-label',
};

export function buttonClasses(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className?: string): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}
