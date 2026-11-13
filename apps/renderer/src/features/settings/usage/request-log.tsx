// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: Usage › every request (the log) · genre: atmospheric studio app (chrome modern-minimal)
 *   · system: DESIGN.md v0.6 + UX4 (the kit's PageSection)
 * the built studio table, one row per request, newest first, filtered to the page's period, job, provider and
 *   project: job and when, provider (its logo) and model id, tokens, cost and how long it took. Numbers in the
 *   text face with tabular figures; model ids as written. Show older requests pages back until the period ends.
 *   The table is request-table.tsx; the paging use-request-pages.ts.
 * states: default · hover (row wash) · focus (the scroll region; Show older) · active (Button) · disabled
 *   (n/a) · loading (first page: the named skeleton of its rows; more: Show older spins) · error (LoadError with Try
 *   again; a failed page: ErrorLine) · success (rows) · empty (one line for the filter)
 */
import { Trans } from '@lingui/react/macro';
import { Button, ErrorLine, PageSection, Skeleton } from '@taalcut/ui';
import { BoneRows, type BoneRowShape } from '../bones';
import { LoadError } from '../fields';
import { SETTINGS_ICONS } from '../settings-icons';
import { RequestTable } from './request-table';
import type { UsageView } from './usage-search';
import { useRequestPages } from './use-request-pages';

const REQUEST_BONES: readonly BoneRowShape[] = ['12%', '16%', '10%', '14%', '12%'].map((title) => ({
  title,
  lines: ['20%'],
  control: 'button',
  icon: true,
}));

export function RequestLog({ view }: { view: UsageView }) {
  const { first, records, older, loadingMore, failed, loadMore } = useRequestPages(view);
  return (
    <PageSection
      title={<Trans>Every request</Trans>}
      icon={SETTINGS_ICONS.requests}
      description={<Trans>Newest first, for the period and filters above.</Trans>}
    >
      {first.status === 'error' && !first.data ? (
        <LoadError
          error={first.error}
          onRetry={first.reload}
          what={<Trans>The requests didn’t load.</Trans>}
        />
      ) : null}
      <Skeleton
        name="settings-usage-requests"
        loading={first.status === 'loading' && !first.data}
        fixture={<BoneRows rows={REQUEST_BONES} />}
      >
        {first.data ? (
          <div className="flex flex-col gap-3">
            <RequestTable records={records} older={older} />
            {failed ? <ErrorLine key={failed.code} error={failed} /> : null}
            {older ? (
              <Button className="self-start" loading={loadingMore} onClick={() => void loadMore()}>
                <Trans>Show older requests</Trans>
              </Button>
            ) : null}
          </div>
        ) : null}
      </Skeleton>
    </PageSection>
  );
}
