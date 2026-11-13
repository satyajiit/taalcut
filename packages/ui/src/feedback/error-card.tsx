// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · component: error card · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.2 "Decision cards" + v0.4 (UX1) · a decision card's frame: `raised`, a `rule` hairline all
 * round, `xl` radius, no shadow, no wash, no stripe; the cause's first sentence is the title at 700, the rest is
 * the body; one fix. Inside a dialog it drops its frame (never a card inside a card) and keeps its words.
 * states: error (the card) · fixing (the fix button loading) · fixed (folds into one quiet line: success is
 * silent) · fix failed (a follow-up card with that cause and its own fix) · busy (fix or retry running elsewhere);
 * its buttons carry the eight states */

import { useLingui } from '@lingui/react/macro';
import type { FixAction, Result, TaalcutError } from '@taalcut/core';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '#components/button';
import { cn } from '#lib/cn';
import { VERB_ICONS } from '../icons/concepts';
import { fixOn } from '../platform/platform-features';
import { useHostPlatform } from '../platform/host-platform';
import { errorMessage, fixLabel } from './error-messages';

/**
 * What running a fix came to: the command bus's result. `void` when the
 * caller handles the outcome itself.
 */
export type FixOutcome = Result<unknown> | void;

export interface ErrorCardProps {
  error: TaalcutError;
  /**
   * The card's title. Default: the cause's first sentence ("That folder is no longer here."), with the rest of
   * the message under it.
   */
  title?: ReactNode;
  /**
   * Runs the error's fix: dispatch `fix.command` with `fix.payload` on the
   * command bus. Return the dispatch's Result and the card follows it: when it
   * worked the card folds into one quiet line (success is silent: no toast),
   * when it didn't a follow-up error card appears under this one. Without it,
   * or without a fix, a retryable error offers `onRetry`.
   */
  onFix?: ((fix: FixAction) => FixOutcome | Promise<FixOutcome>) | undefined;
  onRetry?: (() => void) | undefined;
  /** Dismisses a transient chat/send error banner. */
  onDismiss?: (() => void) | undefined;
  /** Opens feedback reporting for this error. */
  onReport?: ((error: TaalcutError) => void) | undefined;
  /** The fix or retry is running elsewhere: the button shows a spinner. */
  busy?: boolean;
  /** Developer mode: show `error.code` and `error.detail`. Never on for users. */
  showDetail?: boolean;
  className?: string;
}

/** A sentence's end: Latin and Devanagari stops, then a space before the next one. */
const FIRST_SENTENCE = /^(.+?[.!?।])\s+(\S[\s\S]*)$/u;

/** The first sentence as a title and the rest as the body; one sentence is all title. */
export function splitCause(message: string): { title: string; body: string | null } {
  const text = message.trim();
  const match = FIRST_SENTENCE.exec(text);
  const title = match?.[1];
  const body = match?.[2];
  return title && body ? { title, body } : { title: text, body: null };
}

/** In a dialog, the card's frame goes and its words stay: a dialog is already the card. */
const FRAMELESS_IN_DIALOG =
  'in-data-[slot=dialog-content]:rounded-none in-data-[slot=dialog-content]:border-0 in-data-[slot=dialog-content]:bg-transparent in-data-[slot=dialog-content]:p-0';

/**
 * Names the cause and offers one fix (PRD 9.4, DESIGN.md "Errors"). The words
 * come from the catalogue by `error.messageKey`; the button from `fix.labelKey`.
 */
export function ErrorCard({
  error,
  title,
  onFix,
  onRetry,
  onDismiss,
  onReport,
  busy,
  showDetail,
  className,
}: ErrorCardProps) {
  const { t, i18n } = useLingui();
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<TaalcutError | null>(null);
  const [fixed, setFixed] = useState<string | null>(null);
  const platform = useHostPlatform();
  // A fix that opens a part of the system this platform lacks isn't offered (platform-features.ts).
  const fix = onFix ? fixOn(error.fix, platform) : undefined;

  const runFix = async (action: FixAction) => {
    if (!onFix) return;
    setRunning(true);
    setFailure(null);
    try {
      const outcome = await onFix(action);
      if (!outcome) return;
      if (outcome.ok) {
        setFixed(fixLabel(i18n, action));
      } else {
        setFailure(outcome.error);
      }
    } finally {
      setRunning(false);
    }
  };

  if (fixed) {
    return (
      <p
        role="status"
        data-slot="error-card"
        data-state="fixed"
        className={cn('m-0 flex items-center gap-2 type-meta text-ink-2', className)}
      >
        <CircleCheck aria-hidden className="size-4 shrink-0 text-success-strong" />
        {t`${fixed}: done`}
      </p>
    );
  }

  const message = errorMessage(i18n, error);
  const words = title ? { title, body: message } : splitCause(message);
  const retry = !fix && error.retryable && onRetry ? onRetry : undefined;
  const hasActions = Boolean(fix || retry || onReport || onDismiss);

  return (
    <>
      <div
        role="alert"
        data-slot="error-card"
        data-error-code={error.code}
        className={cn(
          'flex flex-col gap-3 rounded-xl border border-rule bg-raised p-4 text-ink',
          FRAMELESS_IN_DIALOG,
          className,
        )}
      >
        <div className="flex items-start gap-3">
          <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-danger-strong" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="m-0 type-section font-bold">{words.title}</p>
            {words.body ? <p className="m-0 type-body text-ink-2">{words.body}</p> : null}
          </div>
        </div>
        {hasActions ? (
          <div className="flex flex-wrap items-center gap-2 ps-8">
            {fix ? (
              <Button size="sm" loading={busy || running} onClick={() => void runFix(fix)}>
                {fixLabel(i18n, fix)}
              </Button>
            ) : retry ? (
              <Button size="sm" loading={busy} icon={VERB_ICONS.retry} onClick={retry}>
                {t`Try again`}
              </Button>
            ) : null}
            {onReport ? (
              <Button size="sm" variant="ghost" onClick={() => onReport(error)}>
                {t`Report this`}
              </Button>
            ) : null}
            {onDismiss ? (
              <Button size="sm" variant="ghost" onClick={onDismiss}>
                {t`Dismiss`}
              </Button>
            ) : null}
          </div>
        ) : null}
        {showDetail ? (
          <pre
            className="m-0 ms-8 overflow-x-auto rounded-md bg-well p-2 font-mono text-xs text-ink-2"
            data-scroll-x
          >
            {error.code}
            {error.detail ? `\n${error.detail}` : ''}
          </pre>
        ) : null}
      </div>
      {failure ? (
        // The fix didn't work: say why, with that error's own fix if it has one.
        <ErrorCard error={failure} onFix={onFix} showDetail={showDetail} className={cn('mt-2', className)} />
      ) : null}
    </>
  );
}
