// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: earlier from your phones · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * what came in before, from the library's own record: one row per import (library.sources, kinds wifi_import and
 *   usb_import: one per Wi-Fi session, one per cable phone), newest first; the way it came (Wi-Fi or cable glyph and
 *   word), the phone's name as written, how many clips and the day; Show in library opens the grid filtered to it
 * states: loading (boneyard bones in the rows' shape) · rows · none yet (one plain line) · error (the cause, Try
 *   again) · Show in library is a ghost Button link (eight states)
 */
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { SourceView } from '@taalcut/core';
import { Button, ErrorLine, Skeleton, UserContent } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { Cable, Wifi } from 'lucide-react';
import { useId } from 'react';
import { useBackend } from '../../../../backend/backend';
import { useRpcQuery } from '../../../../backend/use-rpc';
import { formatDay } from '../../../shared/format';
import { FIXTURE_HISTORY } from '../session/fixtures';

const FROM_PHONE: ReadonlySet<SourceView['kind']> = new Set(['wifi_import', 'usb_import']);

function HistoryRow({ source }: { source: SourceView }) {
  const { t, i18n } = useLingui();
  const wifi = source.kind === 'wifi_import';
  const Glyph = wifi ? Wifi : Cable;
  return (
    <li data-slot="phone-import" className="flex items-center gap-3 py-2.5">
      <Glyph aria-hidden className="size-4 shrink-0 text-ink-3" />
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <UserContent translate="no" className="type-label text-ink">
          {source.name}
        </UserContent>
        <span className="type-meta text-ink-3 tabular-nums">
          {wifi ? t`Over Wi-Fi` : t`With a cable`} ·{' '}
          {plural(source.assets, { one: '# clip', other: '# clips' })} ·{' '}
          <time dateTime={new Date(source.createdAt).toISOString()}>{formatDay(i18n, source.createdAt)}</time>
        </span>
      </div>
      <Button asChild size="sm" variant="ghost">
        <Link to="/library" search={{ source: source.id }}>
          {t`Show in library`}
        </Link>
      </Button>
    </li>
  );
}

function HistoryList({ sources }: { sources: readonly SourceView[] }) {
  return (
    <ul className="m-0 list-none divide-y divide-rule-subtle p-0">
      {sources.map((source) => (
        <HistoryRow key={source.id} source={source} />
      ))}
    </ul>
  );
}

export function PhoneHistory() {
  const { t } = useLingui();
  const backend = useBackend();
  const titleId = useId();
  const sources = useRpcQuery((signal) => backend.library.sources(undefined, { signal }), [backend]);
  const phones = (sources.data ?? [])
    .filter((source) => FROM_PHONE.has(source.kind))
    .toSorted((a, b) => b.createdAt - a.createdAt);
  const loading = sources.status === 'loading';
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <h2 id={titleId} className="m-0 type-section text-ink">
        {t`Earlier from your phones`}
      </h2>
      {sources.status === 'error' ? (
        <ErrorLine error={sources.error} onRetry={sources.reload} />
      ) : (
        <Skeleton name="phone-history" loading={loading} fixture={<HistoryList sources={FIXTURE_HISTORY} />}>
          {loading ? (
            // The rows' real layout, hidden under the bones so they scale to it.
            <div inert>
              <HistoryList sources={FIXTURE_HISTORY} />
            </div>
          ) : phones.length > 0 ? (
            <HistoryList sources={phones} />
          ) : (
            <p className="m-0 max-w-prose py-2 type-body text-ink-2">
              {t`Nothing from a phone yet. Each time you bring clips in, it shows here with the phone and the day.`}
            </p>
          )}
        </Skeleton>
      )}
    </section>
  );
}
