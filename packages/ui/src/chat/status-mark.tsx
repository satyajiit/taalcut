// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: status-mark · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.2 · states: pending · running (+progress) · done · failed · cancelled
 * (not interactive: no hover or focus) */

import { useLingui } from '@lingui/react/macro';
import Upstream, { type StatusMarkStatus } from '@taalcut-vendor/react-bits/status-mark';
import type { PlanStepStatus } from '@taalcut/core';
import { useFormatters } from '#lib/format';

export type StepStatus = PlanStepStatus | 'cancelled';

const STATUS: Record<StepStatus, StatusMarkStatus> = {
  pending: 'pending',
  running: 'running',
  done: 'done',
  failed: 'failed',
  skipped: 'cancelled',
  cancelled: 'cancelled',
};

export interface StatusMarkProps {
  status: StepStatus;
  /** 0 to 1 while running, when the work knows how far it is. */
  progress?: number;
  /** Pixels. 16 in lists. */
  size?: number;
  className?: string;
}

/**
 * React Bits' StatusMark (third_party/react-bits) in Taalcut's meaning colours:
 * agent work running is violet (DESIGN.md v0.2, A12), done is green, failed is
 * vermilion, waiting and skipped are ink-3. It says its status in words to
 * screen readers, so colour is never the only signal.
 */
export function StatusMark({ status, progress, size = 16, className }: StatusMarkProps) {
  const { t } = useLingui();
  const format = useFormatters();
  return (
    <Upstream
      status={STATUS[status]}
      {...(progress === undefined ? {} : { progress })}
      size={size}
      strokeWidth={2.25}
      color={status === 'running' ? 'var(--color-ai-strong)' : 'var(--color-ink-3)'}
      labels={{
        pending: t`Not started`,
        running: t`In progress`,
        done: t`Done`,
        failed: t`Failed`,
        cancelled: status === 'skipped' ? t`Skipped` : t`Stopped`,
      }}
      formatProgress={format.percent}
      className={className}
    />
  );
}
