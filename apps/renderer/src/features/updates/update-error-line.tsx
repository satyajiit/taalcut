// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: update error line · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the kit's error line look (danger-strong text with its icon, never colour alone) with
 *   the update errors' own words; the fix is the caller's button beside it.
 * states: n/a (an announced line; role=alert)
 */
import { useLingui } from '@lingui/react/macro';
import type { TaalcutError } from '@taalcut/core';
import { cn } from '@taalcut/ui';
import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { describeUpdateError } from './update-words';

export function UpdateErrorLine({
  error,
  action,
  className,
}: {
  error: Pick<TaalcutError, 'code' | 'messageKey' | 'params'>;
  action?: ReactNode;
  className?: string;
}) {
  const { i18n } = useLingui();
  return (
    <div
      role="alert"
      data-slot="error-line"
      data-error-code={error.code}
      className={cn('flex flex-wrap items-center gap-x-3 gap-y-2', className)}
    >
      <p className="m-0 flex min-w-0 items-start gap-2 text-sm text-danger-strong">
        <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0">{describeUpdateError(i18n, error)}</span>
      </p>
      {action}
    </div>
  );
}
