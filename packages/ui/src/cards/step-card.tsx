// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: step card · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * a step panel on the sunken bed (no frame, no stripe, no shadow), under its plan step: the step's name and status,
 *   what it decided in the model's words (user content), a job's progress as a neutral bar
 * states: loading (running with nothing to say yet: the violet mark and two still bones) · default (the summary) ·
 *   updating (your change is being used: the summary dims, "Updating with your change") · error (failed: the status
 *   says so; the run's error line follows) · disabled (Change is hidden while the step runs) · success (ready) ·
 *   Change (Button, eight states) puts the summary in the composer: you edit it as a message; the agent doesn't wait
 */
import { useLingui } from '@lingui/react/macro';
import type { CardOf } from '@taalcut/core';
import { Pencil } from 'lucide-react';
import { Button } from '#components/button';
import { cn } from '#lib/cn';
import { useFormatters } from '#lib/format';
import { SkeletonLines } from '../skeleton/skeleton';
import { MarkdownText } from '../chat/markdown-text';
import { useCardActions } from './card-actions';
import { flowStepLabel } from './flow-labels';
import { StepHeader } from './step-header';

/** A neutral bar for background work under a step (never violet: that is the agent's own work). */
export function StepProgress({ fraction, label }: { fraction: number | null; label: string }) {
  const format = useFormatters();
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
      aria-valuetext={fraction === null ? undefined : format.percent(fraction)}
      className="h-1 overflow-hidden rounded-pill bg-hover"
    >
      <span
        className={cn(
          'block h-full w-full origin-left rounded-pill bg-ink-2 transition-transform duration-(--dur-short) ease-(--ease-out)',
          fraction === null && 'tc-global-loader-bar w-1/3',
        )}
        style={fraction === null ? undefined : { transform: `scaleX(${fraction})` }}
      />
    </div>
  );
}

/** A flow step with no card of its own (the proposed brief, say): what it decided, and Change. */
export function StepCard({ card }: { card: CardOf<'step'> }) {
  const { t, i18n } = useLingui();
  const { ask } = useCardActions();
  const name = flowStepLabel(i18n, card.labelKey);
  const status = card.step.status;
  const working = status === 'running' || status === 'updating';
  const summary = card.summary?.trim();
  return (
    <article
      data-slot="smart-card"
      data-card-type="step"
      data-status={status}
      aria-label={name}
      aria-busy={working || undefined}
      className="flex max-w-[42rem] flex-col gap-3 rounded-xl bg-panel p-4"
    >
      <StepHeader title={name} step={card.step} />
      {summary ? (
        <MarkdownText
          text={summary}
          className={cn(
            'max-w-[60ch] text-md text-ink transition-opacity duration-(--dur-short) ease-(--ease-out)',
            status === 'updating' && 'opacity-60',
          )}
        />
      ) : working ? (
        <SkeletonLines lines={2} />
      ) : null}
      {card.progress ? <StepProgress fraction={card.progress.fraction} label={name} /> : null}
      {summary && ask && !working ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button size="sm" onClick={() => ask(summary, [])}>
            <Pencil aria-hidden />
            {t`Change`}
          </Button>
          <span className="text-xs text-ink-2">{t`Edit it as a message. Taalcut carries on meanwhile.`}</span>
        </div>
      ) : null}
    </article>
  );
}
