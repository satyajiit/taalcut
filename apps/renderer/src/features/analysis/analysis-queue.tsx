// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: what the analysis popover holds (LIB1-PROG) · mode: Operate · system: DESIGN.md v0.7
 * its heading ("Analysing 3 clips"), the time left when the library knows it over one neutral bar (background work
 *   runs neutral: ink-3 on the hover track), the part with most left in a sentence, then the clips being analysed
 *   as the kit's ListRows: each a link to its page, its name in ink and what it is good for already in ink-2 meta;
 *   "And 4 more clips" under them; and the clips held for a model or their drive, with the way to the models
 * states: loading (the rows' place held by the heading and bar; no bones for six short rows) · ready · empty (no
 *   rows: the heading says it) · error (the read's cause, in the kit's ErrorLine) · paused (the heading says so)
 * contrast: names ink, meta ink-2 (≥ 7:1 on popover, both themes); the bar's fill carries no meaning alone
 * motion: the bar's fill by transform; nothing else moves
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg, plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { CONCEPT_ICONS, ErrorLine, ListRow, ListRows, UserContent } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { JobBar } from '../downloads/job-bar';
import { formatTimeLeft } from '../downloads/time-left';
import type { AnalysisGroupKey } from '../library/clip/progress/analysis-groups';
import { roundedLeftMs } from '../library/clip/progress/analysis-estimate';
import type { AnalysisSummary } from './analysis-summary';
import type { AnalysisQueue } from './use-analysis-queue';

const MOST_LEFT: Readonly<Record<AnalysisGroupKey, MessageDescriptor>> = {
  play: msg`Most of what’s left is getting clips ready to play.`,
  shots: msg`Most of what’s left is finding shots.`,
  picture: msg`Most of what’s left is looking at what’s in the pictures.`,
  sound: msg`Most of what’s left is listening.`,
  search: msg`Most of what’s left is getting clips ready for search.`,
  describe: msg`Most of what’s left is describing.`,
};

export function AnalysisQueueView({
  titleId,
  title,
  summary,
  queue,
}: {
  titleId: string;
  title: string;
  summary: AnalysisSummary;
  queue: AnalysisQueue;
}) {
  const { t, i18n } = useLingui();
  const rounded = summary.etaMs === null ? null : roundedLeftMs(summary.etaMs);
  const left = rounded === null ? null : formatTimeLeft(i18n, rounded);
  // The rest of the count in the heading (clips waiting their turn included), not of the read's own total.
  const more = queue.loaded ? Math.max(0, summary.count - queue.items.length) : 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id={titleId} className="m-0 type-card-title text-ink">
            {title}
          </h2>
          {left ? (
            <span data-slot="analysis-time-left" className="shrink-0 type-meta text-ink-2 tabular-nums">
              {t`About ${left} left`}
            </span>
          ) : null}
        </div>
        <JobBar labelledBy={titleId} fraction={summary.fraction} />
        {summary.slowest ? (
          <p data-slot="analysis-most-left" className="m-0 type-meta text-ink-2">
            {i18n._(MOST_LEFT[summary.slowest])}
          </p>
        ) : null}
      </div>
      {queue.error ? <ErrorLine error={queue.error} /> : null}
      {queue.items.length > 0 ? (
        <ListRows aria-label={t`Clips being analysed`} data-slot="analysis-queue">
          {queue.items.map((asset) => (
            <ListRow
              key={asset.id}
              size="dense"
              data-asset={asset.id}
              leading={CONCEPT_ICONS.clip}
              title={<UserContent translate="no">{asset.name}</UserContent>}
              meta={
                (asset.index.searchableAt ?? null) !== null ? t`You can search it now` : t`Not searchable yet`
              }
              action={<Link to="/library/$assetId" params={{ assetId: asset.id }} />}
            />
          ))}
        </ListRows>
      ) : null}
      {more > 0 ? (
        <p data-slot="analysis-queue-more" className="m-0 type-meta text-ink-2">
          {t`And ${plural(more, { one: '# more clip', other: '# more clips' })}`}
        </p>
      ) : null}
      {summary.held > 0 ? (
        <div data-slot="analysis-held" className="flex flex-col items-start gap-1">
          <p className="m-0 type-body text-ink-2">
            {t`${plural(summary.held, {
              one: '# clip waits for a model or its drive.',
              other: '# clips wait for a model or their drive.',
            })}`}
          </p>
          <Link
            to="/settings/models/downloads"
            className="type-body font-medium text-ink underline underline-offset-4"
          >
            {t`Open Settings › Models`}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
