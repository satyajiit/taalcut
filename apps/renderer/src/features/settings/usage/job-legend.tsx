// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: Usage › Spend by day, the jobs' legend · genre: atmospheric studio app (chrome
 *   modern-minimal) · system: DESIGN.md v0.3
 * the jobs as toggle chips in the series' order: the one pressed is drawn in the accent (its swatch
 *   primary-strong on the selection wash), the others neutral; a chip's swatch mirrors its mark in the chart.
 * states: default · hover (chip ink and edge) · focus (base ring) · active (pressed: selection wash, aria-pressed)
 *   · disabled/loading/error (n/a: the section's) · success (the chart's accent moves)
 */
import { useLingui } from '@lingui/react/macro';
import { cn } from '@taalcut/ui';
import { markFill } from './spend-marks';
import type { SeriesKey } from './spend-series';

export function JobLegend({
  keys,
  emphasis,
  nameOf,
  onChoose,
}: {
  keys: readonly SeriesKey[];
  emphasis: SeriesKey | null;
  nameOf: (key: SeriesKey) => string;
  /** A press on a job; `'none'` when the pressed one is pressed again. */
  onChoose: (key: SeriesKey | 'none') => void;
}) {
  const { t } = useLingui();
  return (
    <div role="group" aria-label={t`Highlight a job`} className="flex flex-wrap gap-1.5">
      {keys.map((key) => {
        const pressed = emphasis === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChoose(pressed ? 'none' : key)}
            className={cn(
              'inline-flex cursor-pointer items-center gap-1.5 rounded-pill border px-2.5 py-1 type-label-sm transition-colors duration-(--dur-micro)',
              pressed
                ? 'border-primary-strong/40 bg-selection text-ink'
                : 'border-rule-subtle text-ink-2 hover:border-rule hover:text-ink',
            )}
          >
            <span aria-hidden className={cn('size-2.5 rounded-[2px]', markFill(pressed, emphasis))} />
            {nameOf(key)}
          </button>
        );
      })}
    </div>
  );
}
