// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: how sure the AI is · mode: Operate · system: WEB2 Remix Vernacular (the app's neutral ink: a
 *   low pick is not an error)
 * rebuilt lean from packages/ui/src/make/confidence.tsx: "How sure", then a three-step meter in neutral ink (the
 *   steps it hasn't reached in the rule colour) and the word High, Medium or Low beside it
 * states: high · medium · low · not interactive */

import { cn } from '#lib/cn';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

const WORDS: Readonly<Record<ConfidenceLevel, string>> = { high: 'High', medium: 'Medium', low: 'Low' };
const STEPS: Readonly<Record<ConfidenceLevel, number>> = { high: 3, medium: 2, low: 1 };
const HEIGHTS = ['h-1.5', 'h-2', 'h-2.5'] as const;

export function Confidence({
  level,
  className,
}: {
  readonly level: ConfidenceLevel;
  readonly className?: string;
}) {
  return (
    <span
      data-slot="confidence"
      data-level={level}
      className={cn('inline-flex items-center gap-1.5 type-meta whitespace-nowrap text-ink-2', className)}
    >
      <span>How sure:</span>
      <span aria-hidden className="inline-flex items-end gap-px">
        {HEIGHTS.map((height, i) => (
          <span
            key={height}
            className={cn('block w-1 rounded-[1px]', height, i < STEPS[level] ? 'bg-ink-2' : 'bg-rule')}
          />
        ))}
      </span>
      <span className="text-ink">{WORDS[level]}</span>
    </span>
  );
}
