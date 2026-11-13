// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: number ticker (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system: the
 *   UX4 motion grammar
 * a count that changes in place ticks from the old number to the new one (--dur-long, --ease-out), so you see it
 *   grow or shrink instead of finding it changed. The first number shows at once (what was there when the page
 *   opened shows at once). The digits are tabular, so the width holds while it runs; the text is written straight
 *   to the element on the animation's frames, never through React. Screen readers get the final number only.
 * states: n/a (a number, not a control)
 * reduced motion: the new number at once */
import { useLingui } from '@lingui/react/macro';
import { animate, useReducedMotion } from 'motion/react';
import { useLayoutEffect, useRef } from 'react';
import { cn } from '#lib/cn';
import { EASE_OUT, TICK_DURATION } from '#lib/motion';

export interface NumberTickerProps {
  value: number;
  /** Turn a number into its words (a size, a currency). Defaults to the language's plain number. */
  format?: (value: number) => string;
  className?: string;
}

/** The decimals the target has, so the in-between numbers have as many (a whole count stays whole). */
function decimalsOf(value: number): number {
  const text = String(value);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : Math.min(text.length - dot - 1, 4);
}

/** A number that ticks to its new value when it changes. */
export function NumberTicker({ value, format, className }: NumberTickerProps) {
  const { i18n } = useLingui();
  const reduce = useReducedMotion() ?? false;
  const shown = useRef<HTMLSpanElement>(null);
  const from = useRef(value);
  const words = format ?? ((n: number) => i18n.number(n));

  // React never writes the visible digits: they are set here, so a tick in progress is never overwritten.
  useLayoutEffect(() => {
    const element = shown.current;
    if (!element) return;
    const start = from.current;
    from.current = value;
    if (start === value || reduce) {
      element.textContent = words(value);
      return;
    }
    const places = decimalsOf(value);
    const controls = animate(start, value, {
      duration: TICK_DURATION,
      ease: EASE_OUT,
      onUpdate: (latest) => {
        element.textContent = words(Number(latest.toFixed(places)));
      },
    });
    return () => controls.stop();
    // `words` is rebuilt every render; the locale is what changes its output.
  }, [value, reduce, i18n.locale]);

  return (
    <span data-slot="number-ticker" className={cn('tabular-nums', className)}>
      <span aria-hidden ref={shown} />
      <span className="sr-only">{words(value)}</span>
    </span>
  );
}
