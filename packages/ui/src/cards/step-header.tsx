// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: step header · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * the shared head of a step panel: its name, "Step 2 of 4", the status as a mark and a word (violet while the agent
 * works, the AI's colour; done green; failed vermilion; waiting ink-3), and teal "You changed this" when you did
 * states: not interactive (no hover or focus); status: waiting · running · ready · updating · failed · skipped
 * UX round 1: the title at the card size (text-lg), as every card in the transcript */

import { useLingui } from '@lingui/react/macro';
import type { FlowStepRef, FlowStepStatus } from '@taalcut/core';
import type { ReactNode } from 'react';
import { Chip } from '#components/badge';
import { StatusMark, type StepStatus } from '../chat/status-mark';
import { cn } from '#lib/cn';
import { FLOW_STATUS_LABELS } from './flow-labels';

const MARK: Readonly<Record<FlowStepStatus, StepStatus>> = {
  waiting: 'pending',
  running: 'running',
  ready: 'done',
  updating: 'running',
  failed: 'failed',
  skipped: 'skipped',
};

export interface StepHeaderProps {
  title: ReactNode;
  step?: FlowStepRef | undefined;
  /** At the right: a step's own small action or chip. */
  aside?: ReactNode;
  className?: string;
}

/**
 * The head every step panel shares (packages/ui SPEC, StepPanel): what the
 * step is, where it sits in the flow and how it stands. The status is a mark
 * and a word, so colour never carries it alone.
 */
export function StepHeader({ title, step, aside, className }: StepHeaderProps) {
  const { t, i18n } = useLingui();
  const at = step ? i18n.number(step.index) : null;
  const of = step ? i18n.number(step.count) : null;
  return (
    <header className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="m-0 text-lg font-semibold text-ink">{title}</h3>
        {step ? <span className="text-xs text-ink-3 tabular-nums">{t`Step ${at} of ${of}`}</span> : null}
      </div>
      {step?.editedByYou ? <Chip tone="you">{t`You changed this`}</Chip> : null}
      {step ? (
        <span
          data-slot="step-status"
          data-status={step.status}
          className={cn(
            'flex items-center gap-1.5 text-xs',
            step.status === 'running' || step.status === 'updating' ? 'text-ai-strong' : 'text-ink-2',
            step.status === 'failed' && 'text-danger-strong',
          )}
        >
          {/* The word says it; the mark is its picture. */}
          <span aria-hidden className="inline-flex">
            <StatusMark status={MARK[step.status]} size={14} />
          </span>
          <span>{i18n._(FLOW_STATUS_LABELS[step.status])}</span>
        </span>
      ) : null}
      {aside}
    </header>
  );
}
