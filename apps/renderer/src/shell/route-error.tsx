// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · page: route error · plain text (shell/plain-message): a heading, the cause in one sentence, its fix
 * (Try again) and Report this, as link-styled buttons. No stack trace; the error goes to the console. */
import { Trans, useLingui } from '@lingui/react/macro';
import { isTaalcutError } from '@taalcut/core';
import { cn, errorMessage } from '@taalcut/ui';
import { useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { useEffect } from 'react';
import { openFeedback } from '../features/feedback/feedback-state';
import { MESSAGE_LINK, PlainMessage } from './plain-message';

/**
 * A page that failed to load: its cause and one fix (PRD 9.4, DESIGN.md
 * "Errors"). A Taalcut error names its own cause from the catalogue, and
 * Report this sends it with the feedback; anything else is a fault in
 * Taalcut itself, and says so. Nothing is lost either way.
 */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const { t, i18n } = useLingui();
  const router = useRouter();
  useEffect(() => console.error(error), [error]);
  const known = isTaalcutError(error) ? error : null;
  const cause = known ? errorMessage(i18n, known) : null;
  return (
    <PlainMessage
      name={t`Something went wrong`}
      title={<Trans>This page didn't load</Trans>}
      sentence={
        cause ? (
          <Trans>{cause} Your work is saved.</Trans>
        ) : (
          <Trans>A fault in Taalcut stopped it from opening. Your work is saved.</Trans>
        )
      }
      link={
        <>
          <button
            type="button"
            className={MESSAGE_LINK}
            onClick={() => {
              reset();
              void router.invalidate();
            }}
          >
            <Trans>Try again</Trans>
          </button>
          <button
            type="button"
            className={cn(MESSAGE_LINK, 'text-ink-2')}
            onClick={() => openFeedback(known)}
          >
            <Trans>Report this</Trans>
          </button>
        </>
      }
    />
  );
}
