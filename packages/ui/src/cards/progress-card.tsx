// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: progress-row · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.2 (A3, A12) · states: queued · running (neutral spinner, determinate or
 * indeterminate bar) · paused · succeeded · failed · cancelled · not interactive */

import { useLingui } from '@lingui/react/macro';
import type { CardOf, JobProgress } from '@taalcut/core';
import { LoaderCircle } from 'lucide-react';
import { cn } from '#lib/cn';
import { useFormatters } from '#lib/format';
import { JOB_STATE_LABELS, progressLabel, stageLabel } from './labels';

/**
 * Long work in the background, with live progress (PRD 9.4: over 2 s shows
 * progress with a time estimate). A row, not a card (DESIGN.md v0.2, A3);
 * background jobs are neutral with a spinner, never blue or violet (A12).
 * The bar moves with transform, not width.
 */
export function ProgressCard({ card }: { card: CardOf<'progress'> }) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const progress: JobProgress | null = card.progress;
  const fraction = progress?.fraction ?? null;
  const stage = progress?.stageKey ? stageLabel(i18n, progress.stageKey) : undefined;
  const eta = progress?.etaMs !== undefined ? format.duration(progress.etaMs) : undefined;
  const counted =
    progress?.completed !== undefined && progress.total !== undefined
      ? `${format.count(progress.completed)} / ${format.count(progress.total)}`
      : undefined;
  const label = progressLabel(i18n, card.labelKey);
  const percent = fraction === null ? undefined : format.percent(fraction);
  const moving = card.state === 'running' || card.state === 'queued';
  return (
    <article
      data-slot="progress"
      data-card-type="progress"
      data-state={card.state}
      aria-label={label}
      className="flex max-w-[42rem] flex-col gap-2"
    >
      <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {moving ? <LoaderCircle aria-hidden className="size-3.5 shrink-0 animate-spin text-ink-3" /> : null}
        <span className="font-medium text-ink">{label}</span>
        <span className="text-ink-3">{i18n._(JOB_STATE_LABELS[card.state])}</span>
        {percent ? <span className="ms-auto text-ink-2 tabular-nums">{percent}</span> : null}
      </p>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
        aria-valuetext={percent}
        className="h-1 overflow-hidden rounded-pill bg-sunken"
      >
        <span
          className={cn(
            'block h-full w-full origin-left rounded-pill bg-ink-2 transition-transform duration-(--dur-short) ease-(--ease-out)',
            fraction === null && moving && 'tc-global-loader-bar w-1/3',
          )}
          style={
            fraction !== null
              ? { transform: `scaleX(${fraction})` }
              : moving
                ? undefined
                : { transform: `scaleX(${card.state === 'succeeded' ? 1 : 0})` }
          }
        />
      </div>
      {stage || counted || (eta && card.state === 'running') ? (
        <p className="m-0 flex flex-wrap gap-x-3 text-xs text-ink-2 tabular-nums">
          {stage ? <span>{stage}</span> : null}
          {counted ? <span>{counted}</span> : null}
          {eta && card.state === 'running' ? <span>{t`About ${eta} left`}</span> : null}
        </p>
      ) : null}
    </article>
  );
}
