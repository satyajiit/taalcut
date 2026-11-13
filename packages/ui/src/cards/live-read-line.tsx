// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: live read line · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 ("Errors": the cause and one fix in one line; protocol rule 1) · what a card says about the
 *   stored thing it watches when that isn't simply there: deleted ("This was deleted.", quiet ink-2) or unreadable
 *   for now (the kit's ErrorLine with Try again, which watches again; the card's last state and actions stay)
 * states: gone (a still line) · failed (error, with Try again: the Button's eight states) · otherwise nothing
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */

import { useLingui } from '@lingui/react/macro';
import type { ReactNode } from 'react';
import { useCardActions } from './card-actions';
import { ErrorLine } from './error-line';
import type { LiveRead } from './live-read';

export interface LiveReadLineProps {
  read: LiveRead<unknown>;
  onRetry: () => void;
  /** What a deleted thing says; `false` says nothing (the card shows its snapshot quietly). Default "This was deleted." */
  gone?: ReactNode | false;
  className?: string;
}

/**
 * A card's line about what it watches (UX round 1): "deleted" only when it was, and a broken watch as its cause with
 * Try again. Watching again is always safe, so Try again shows even when the cause isn't marked retryable.
 */
export function LiveReadLine({ read, onRetry, gone, className }: LiveReadLineProps) {
  const { t } = useLingui();
  const { report, developerMode } = useCardActions();
  if (read.status === 'gone') {
    if (gone === false) return null;
    return <p className={className ?? 'm-0 text-sm text-ink-2'}>{gone ?? t`This was deleted.`}</p>;
  }
  if (read.status !== 'failed') return null;
  return (
    <ErrorLine
      key={`${read.error.code}:${read.last === null ? 'empty' : 'kept'}`}
      error={{ ...read.error, retryable: true }}
      onRetry={onRetry}
      onReport={report}
      showDetail={developerMode === true}
      {...(className ? { className } : {})}
    />
  );
}
