// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: load error · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.4
 * a read in the Make area that failed: the kit's ErrorLine (the cause in one sentence), and exactly one Try again,
 *   which reads again: the ErrorLine's own when the error says retrying may help, else a button beside it, since
 *   reading again is always safe
 * states: the ErrorLine's and the Button's (default, hover, focus-visible, active, disabled n/a, loading n/a: the
 *   read itself shows its bones again) · pre-emit critique: P4 H5 E4 S5 R5 V4
 */
import { useLingui } from '@lingui/react/macro';
import type { TaalcutError } from '@taalcut/core';
import { Button, cn, ErrorLine, VERB_ICONS } from '@taalcut/ui';

export function LoadError({
  error,
  onRetry,
  className,
}: {
  readonly error: TaalcutError;
  readonly onRetry: () => void;
  readonly className?: string;
}) {
  const { t } = useLingui();
  return (
    <div data-slot="load-error" className={cn('flex flex-col items-start gap-3', className)}>
      <ErrorLine key={error.code} error={error} onRetry={onRetry} className="w-full max-w-2xl" />
      {error.retryable ? null : (
        <Button size="sm" icon={VERB_ICONS.retry} onClick={onRetry}>
          {t`Try again`}
        </Button>
      )}
    </div>
  );
}
