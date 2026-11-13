// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: the starters didn't load · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.4 ("Errors": the cause and its one fix, one line, never a card) · the error line's own shape
 *   (ErrorLine needs a TaalcutError; the starters' loader only says that it failed), in first run's starter grid and
 *   in the chat's template list, where the starters would be
 * states: error (this line, role alert) · Try again: default · hover · focus-visible · active · disabled (a start in
 *   flight) · loading (the bones replace the line while it asks again) · success (the starters come back)
 */
import { Trans } from '@lingui/react/macro';
import { CircleAlert } from 'lucide-react';
import { Button } from '#components/button';
import { cn } from '#lib/cn';
import { VERB_ICONS } from '../icons/concepts';

export interface StartersFailedProps {
  onRetry: () => void;
  disabled?: boolean;
  className?: string;
}

/** The starters couldn't be read: say so where they'd be, with Try again. */
export function StartersFailed({ onRetry, disabled = false, className }: StartersFailedProps) {
  return (
    <div
      role="alert"
      data-slot="starters-failed"
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-danger/30 bg-danger-soft/75 px-3 py-2',
        className,
      )}
    >
      <p className="m-0 flex min-w-0 flex-1 items-start gap-2 text-sm text-danger-strong">
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0">
          <Trans>The starters didn’t load.</Trans>
        </span>
      </p>
      <Button size="sm" variant="secondary" icon={VERB_ICONS.retry} disabled={disabled} onClick={onRetry}>
        <Trans>Try again</Trans>
      </Button>
    </div>
  );
}
