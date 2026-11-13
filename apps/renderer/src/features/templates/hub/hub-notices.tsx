// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: hub notices (/templates/hub) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * what holds the hub back, said on the list in one line each, above the filters (UX1: offline and rate-limited
 *   are visible on the list): offline with a cached index (info, how old the list is, what waits, Try again), and
 *   the hub's rate limit (warning, what waits and until when, what still works). Unboxed lines with an icon and a
 *   sentence: a status is never colour alone
 * states: offline (Try again: the ghost Button's eight states; loading while hub.status is read again) ·
 *   rate-limited (words only, gone when the limit ends) · neither (nothing)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { Button, indexAge, retryIn, VERB_ICONS } from '@taalcut/ui';
import { Clock, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useHubLimit } from './hub-limits';

function Notice({ icon, children, action }: { icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
      <p className="m-0 flex min-w-0 flex-1 items-start gap-2">
        {icon}
        <span className="min-w-0">{children}</span>
      </p>
      {action}
    </div>
  );
}

export function HubNotices({
  fetchedAt,
  checking,
  onRetry,
}: {
  /** When the cached index was fetched; a notice when that is over an hour ago (offline). */
  readonly fetchedAt: number | null;
  readonly checking: boolean;
  readonly onRetry: () => void;
}) {
  const { t, i18n } = useLingui();
  const limit = useHubLimit();
  const ageWords = fetchedAt === null ? null : indexAge(i18n, fetchedAt, Date.now());
  // Intl's words for the time ("3 hours ago"), marked as a time: locale data, not the catalogue's.
  const age =
    fetchedAt !== null && ageWords ? (
      <time dateTime={new Date(fetchedAt).toISOString()}>{ageWords}</time>
    ) : null;
  if (!age && limit === null) return null;
  const until = limit === null ? null : retryIn(i18n, (limit - Date.now()) / 1000);
  return (
    <div className="flex flex-col gap-2" data-slot="hub-notices">
      {age ? (
        <Notice
          icon={<WifiOff aria-hidden className="mt-0.5 size-4 shrink-0 text-info-strong" />}
          action={
            <Button size="sm" variant="ghost" icon={VERB_ICONS.retry} loading={checking} onClick={onRetry}>
              {t`Try again`}
            </Button>
          }
        >
          <span data-slot="hub-index-age">
            <Trans>
              Taalcut can’t reach the hub, so this is the list as of {age}. Templates open and copy again once
              it’s back.
            </Trans>
          </span>
        </Notice>
      ) : null}
      {until ? (
        <Notice icon={<Clock aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-strong" />}>
          <span data-slot="hub-rate-limited">
            <Trans>
              The hub asked Taalcut to slow down. Rating, reporting and sharing work again {until}; browsing
              and copying still work.
            </Trans>
          </span>
        </Notice>
      ) : null}
    </div>
  );
}
