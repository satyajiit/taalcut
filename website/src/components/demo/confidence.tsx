// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: confidence · mode: Persuade (product UI, the app's own) · system: WEB2 Remix Vernacular
 * How sure the AI is about a pick, as the app shows it (packages/ui/src/make/confidence.tsx): the word High, Medium or
 * Low beside a three-step meter in neutral ink, never a status colour (a less sure pick is not an error).
 * states: empty (no pick yet: three grey steps, no word) · filling (the steps rise one after another as the pick
 *   lands) · high · medium · low · reduced motion (filled at once) · static (a label, never a control) */

import { motion } from 'motion/react';
import { cn } from '#lib/cn';
import { EASE_OUT } from '#lib/motion';
import { CONFIDENCE_STEPS, CONFIDENCE_WORD, type ConfidenceLevel } from './picks';

const HEIGHTS = ['h-1.5', 'h-2', 'h-2.5'] as const;

export function Confidence({ level, filled = true, className }: { readonly level: ConfidenceLevel; readonly filled?: boolean; readonly className?: string }) {
  return (
    <span data-confidence={filled ? level : 'none'} className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-ink-2', className)}>
      <span aria-hidden className="inline-flex items-end gap-px">
        {HEIGHTS.map((height, i) => (
          <span key={height} className={cn('relative block w-1 overflow-hidden rounded-[1px] bg-rule', height)}>
            <motion.span
              className="absolute inset-0 origin-bottom bg-ink-2"
              initial={false}
              animate={{ scaleY: filled && i < CONFIDENCE_STEPS[level] ? 1 : 0 }}
              transition={{ duration: 0.32, ease: EASE_OUT, delay: filled ? 0.12 + i * 0.07 : 0 }}
            />
          </span>
        ))}
      </span>
      {filled ? (
        <span>
          <span className="sr-only">How sure: </span>
          {CONFIDENCE_WORD[level]}
        </span>
      ) : null}
    </span>
  );
}
