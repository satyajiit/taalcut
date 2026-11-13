// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { cn } from '@taalcut/ui';
import { formatDateTime, formatDuration } from './format';

/**
 * A date and time from Intl, in a <time> element: machine-readable, and
 * recognised by the pseudo-locale check as Intl output rather than a missed
 * catalogue string. Set in the text face, as base.css sets every <time>.
 */
export function DateTime({ at, className }: { at: number; className?: string }) {
  const { i18n } = useLingui();
  return (
    <time dateTime={new Date(at).toISOString()} className={cn('font-sans', className)}>
      {formatDateTime(i18n, at)}
    </time>
  );
}

/**
 * A duration (41 ms, 3.4 sec) as <time>. In the text face with tabular figures,
 * unless `live`: JetBrains Mono is only for numbers that change in place
 * (DESIGN.md v0.2, Typography), and a finished duration doesn't.
 */
export function Duration({
  ms,
  live = false,
  className,
}: {
  ms: number;
  live?: boolean;
  className?: string;
}) {
  const { i18n } = useLingui();
  return (
    <time
      dateTime={`PT${(Math.max(0, ms) / 1000).toFixed(3)}S`}
      className={cn(live ? 'tc-mono' : 'font-sans tabular-nums', className)}
    >
      {formatDuration(i18n, ms)}
    </time>
  );
}
