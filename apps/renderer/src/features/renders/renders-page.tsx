// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · page: Exports (/renders, P2-M11, UX1, UX4) · system: DESIGN.md v0.6 + UX4 (Page, kit)
 * a view of Make, and only the queue and its history now (UX4 moved the style profile to its own view, Your
 *   style): the views in Page's views slot with the count and what's running beside them; then every export as a
 *   ListRow, newest first, live: what's running at the top by being newest, with its progress; finished ones with
 *   their check and their next step. An export that ends while you watch gets its moment above the list: Kaatu
 *   grins with Show in Finder and Make another, or looks bashful with the cause and Try again
 * states: loading (row bones captured from the row: `make-exports`, the count's place kept) · empty
 *   (RendersEmpty, with Kaatu) · filled · error (the cause, Try again, which reopens the stream; a stream that
 *   drops after the rows arrived keeps them and says so) · rows: queued · exporting · checking · fixing · ready ·
 *   needs review · failed · stopped · a moment (success or failure, once, until dismissed or another export ends)
 * motion: rows arrive once (Arrival); a row's bar moves by transform; the moment arrives once
 */
import { Plural, useLingui } from '@lingui/react/macro';
import type { RenderId, RenderSnapshot } from '@taalcut/core';
import { Arrival, ListRows, Skeleton } from '@taalcut/ui';
import { useEffect, useRef, useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useRpcStream } from '../../backend/use-rpc';
import { LoadError } from '../make/load-error';
import { RendersEmpty } from '../make/make-empty';
import { MakeViews, ViewCount } from '../make/make-views';
import { RowShape } from '../make/project-list';
import { Page } from '../../shell/page';
import { ExportDialog } from './export-dialog';
import { ExportMoment } from './export-moment';
import { RenderRow } from './render-row';
import { RUNNING, useRenderActions } from './render-actions';
import { ReviewDialog } from './review-dialog';

/** One export row's shape, for the bones and their capture. */
function RowShapes({ bone }: { bone: boolean }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
      {Array.from({ length: 5 }, (_, i) => (
        <RowShape key={i} bone={bone} lines={2} />
      ))}
    </ul>
  );
}

/** The newest export seen ending while the page is open: none on arrival, since nothing ended in front of you. */
function useEnding(items: readonly RenderSnapshot[] | undefined) {
  const seen = useRef<ReadonlyMap<RenderId, RenderSnapshot['status']> | null>(null);
  const [ended, setEnded] = useState<RenderId | null>(null);
  useEffect(() => {
    if (!items) return;
    const before = seen.current;
    seen.current = new Map(items.map((render) => [render.id, render.status]));
    if (!before) return;
    const now = items.find((render) => {
      const was = before.get(render.id);
      return !!was && RUNNING.has(was) && (render.status === 'ready' || render.status === 'failed');
    });
    if (now) setEnded(now.id);
  }, [items]);
  const render = ended ? items?.find((candidate) => candidate.id === ended) : undefined;
  return { render, dismiss: () => setEnded(null) };
}

function EndingMoment({ render, onDismiss }: { render: RenderSnapshot; onDismiss: () => void }) {
  const actions = useRenderActions(render);
  return (
    <Arrival animate>
      <ExportMoment
        render={render}
        onReveal={actions.reveal}
        onRetry={async () => {
          await actions.exportAs(render.presetId);
          onDismiss();
        }}
        onDismiss={onDismiss}
      />
    </Arrival>
  );
}

export function RendersPage({ now = Date.now() }: { now?: number }) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const [round, setRound] = useState(0);
  const renders = useRpcStream((signal) => backend.renders.watch({}, { signal }), [backend, round]);
  const [reviewing, setReviewing] = useState<RenderSnapshot | null>(null);
  const [exporting, setExporting] = useState<RenderSnapshot | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const reopen = () => setRound((n) => n + 1);

  const items = renders.data;
  const ending = useEnding(items);
  const running = items?.filter((render) => RUNNING.has(render.status)).length ?? 0;
  const runningNumber = i18n.number(running);
  const empty = !!items && items.length === 0;
  const views = (
    <>
      <MakeViews current="exports" />
      {empty ? null : (
        <ViewCount>
          {items ? (
            <>
              <Plural value={items.length} one="# export" other="# exports" />
              {running > 0 ? (
                <>
                  {' · '}
                  {t`${runningNumber} exporting now`}
                </>
              ) : null}
            </>
          ) : null}
        </ViewCount>
      )}
    </>
  );

  return (
    <Page title={t`Make`} detail={t`Exports`} views={views}>
      {empty ? (
        <section aria-label={t`Exports`} data-slot="renders">
          <RendersEmpty />
        </section>
      ) : (
        <section aria-label={t`Exports`} className="flex flex-col gap-4" data-slot="renders">
          {renders.error ? <LoadError error={renders.error} onRetry={reopen} /> : null}
          {ending.render ? <EndingMoment render={ending.render} onDismiss={ending.dismiss} /> : null}
          {renders.error && !items ? null : (
            <Skeleton
              name="make-exports"
              loading={!items}
              fixture={<RowShapes bone={false} />}
              fallback={<RowShapes bone />}
            >
              {items ? (
                <Arrival animate>
                  <ListRows aria-label={t`Exports`} data-slot="render-list">
                    {items.map((render) => (
                      <RenderRow
                        key={render.id}
                        render={render}
                        now={now}
                        onReview={setReviewing}
                        onMoreOptions={(picked) => {
                          setExporting(picked);
                          setDialogOpen(true);
                        }}
                      />
                    ))}
                  </ListRows>
                </Arrival>
              ) : (
                <span role="status" className="sr-only">
                  {t`Loading your exports`}
                </span>
              )}
            </Skeleton>
          )}
          <ReviewDialog render={reviewing} onOpenChange={(open) => (open ? null : setReviewing(null))} />
          {exporting ? (
            <ExportDialog
              projectId={exporting.projectId}
              timelineId={exporting.timelineId}
              presetId={exporting.presetId}
              open={dialogOpen}
              onOpenChange={setDialogOpen}
            />
          ) : null}
        </section>
      )}
    </Page>
  );
}
