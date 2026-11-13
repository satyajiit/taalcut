// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · pre-emit critique: P5 H4 E5 S5 R5 V4
 * Hallmark · component: error-line · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.2 (A3) + v0.4 (UX1: no wash) · one line on whatever it sits on: the danger icon, the
 * cause in ink, its one fix as a small button. No box, no wash, no edge (a wash is for chips and selected rows).
 * states: error · fixing (the button loading) · fixed (one quiet line with a check, success is silent) · fix
 * failed (the new cause replaces the line); the button carries the eight states */

import { useLingui } from '@lingui/react/macro';
import type { FixAction, TaalcutError } from '@taalcut/core';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { Button } from '#components/button';
import { cn } from '#lib/cn';
import type { FixOutcome } from '../feedback/error-card';
import { errorMessage, fixLabel } from '../feedback/error-messages';
import { useHostPlatform } from '../platform/host-platform';
import { fixOn } from '../platform/platform-features';
import { VERB_ICONS } from '../icons/concepts';

export interface ErrorLineProps {
  error: TaalcutError;
  onFix?: (fix: FixAction) => FixOutcome | Promise<FixOutcome>;
  /** Optional retry callback when a retryable error has no command fix. */
  onRetry?: (() => void) | undefined;
  /** Developer mode: show `error.code` after the sentence. Never on for users. */
  showDetail?: boolean;
  /** "Report this": opens Send feedback with this error named (P2-X7). */
  onReport?: ((error: TaalcutError) => void) | undefined;
  className?: string;
}

/**
 * An error as one line: the cause, and its one fix as a small button (DESIGN.md, "Errors"; inside a run,
 * "an error inside a run is one line with its one fix, never a card"). A fix that works says so quietly in
 * place; one that fails shows its own cause.
 */
export function ErrorLine({
  error,
  onFix,
  onRetry,
  showDetail = false,
  onReport,
  className,
}: ErrorLineProps) {
  const { t, i18n } = useLingui();
  // Starts from `error`; key the line by the error's version to start over when it changes.
  const [current, setCurrent] = useState(error);
  const [running, setRunning] = useState(false);
  const [fixed, setFixed] = useState<string | null>(null);
  const platform = useHostPlatform();
  // A fix that opens a part of the system this platform lacks isn't offered (platform-features.ts).
  const fix = onFix ? fixOn(current.fix, platform) : undefined;

  const run = async (action: FixAction) => {
    if (!onFix) return;
    setRunning(true);
    try {
      const outcome = await onFix(action);
      if (!outcome) return;
      if (outcome.ok) setFixed(fixLabel(i18n, action));
      else setCurrent(outcome.error);
    } finally {
      setRunning(false);
    }
  };

  if (fixed) {
    return (
      <p
        role="status"
        data-slot="error-line"
        data-fixed
        className={cn('m-0 flex min-w-0 items-start gap-2 text-sm text-ink-2', className)}
      >
        <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success-strong" />
        <span className="min-w-0">{t`${fixed}: done`}</span>
      </p>
    );
  }
  const retry = !fix && current.retryable && onRetry ? onRetry : undefined;
  return (
    <div
      role="alert"
      data-slot="error-line"
      data-error-code={current.code}
      className={cn('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5', className)}
    >
      <p className="m-0 flex min-w-0 flex-1 basis-72 items-start gap-2 text-sm text-ink">
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger-strong" />
        <span className="min-w-0">
          {errorMessage(i18n, current)}
          {showDetail ? <code className="ms-2 text-xs text-ink-3">{current.code}</code> : null}
        </span>
      </p>
      {fix || retry || onReport ? (
        <span className="flex shrink-0 flex-wrap items-center gap-1.5">
          {fix ? (
            <Button size="sm" variant="secondary" loading={running} onClick={() => void run(fix)}>
              {fixLabel(i18n, fix)}
            </Button>
          ) : retry ? (
            <Button size="sm" variant="secondary" icon={VERB_ICONS.retry} onClick={retry}>
              {t`Try again`}
            </Button>
          ) : null}
          {onReport ? (
            <Button size="sm" variant="ghost" onClick={() => onReport(current)}>
              {t`Report this`}
            </Button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
