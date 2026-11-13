// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · component: export approval card, the chat's summary (UX4, B8; P2-M13's one approval) · Operate
 * system: DESIGN.md v0.7 (decision cards: raised, hairline all round, xl radius; the transcript's one marigold)
 * The approval itself is a page now (ExportReview): the chat keeps a short summary that leads there. A frame of the
 *   checked draft, what the check found in one line, and "Review and export", the transcript's one primary while
 *   the approval waits. Once it has settled, the line says how, with the tick drawn in for an export.
 * states: pending · updating ("Updating with your swap…") · exporting · exported (the tick, "Exported") · declined
 *   ("Not exported. Say when you’re ready.") · expired ("This run ended.") · no way to review here (the button
 *   goes; /dev/kit) · the button carries the eight states (the kit's Button)
 * motion: arrives with the transcript's one entrance; the exported tick draws in (fades under reduced motion) */
import { useLingui } from '@lingui/react/macro';
import { useEffect, useState } from 'react';
import { Button } from '#components/button';
import { Tick } from '#components/tick';
import { StatusMark } from '../chat/status-mark';
import { VERB_ICONS } from '../icons/concepts';
import { QaSummaryLine } from '../make/qa-checklist';
import { ShotThumb } from '../make/shot-thumb';
import { clipShot, videoClips } from '../make/timeline-math';
import { useShotFrames } from '../make/use-shot-frames';
import { useCardActions } from './card-actions';
import { CardFrame } from './card-frame';
import { useCardData, useTimelineRead } from './card-data';
import { liveValue } from './live-read';
import { usePrimaryVariant } from './primary-holder';
import type { ExportApprovalCard as Card } from './use-export-approval';

/** The draft's poster, else the cut's first frame: the summary's picture. */
function usePicture(card: Card): string | null {
  const data = useCardData();
  const [poster, setPoster] = useState<string | null>(null);
  const live = liveValue(useTimelineRead(card.timelineId).read);
  const first = live ? videoClips(live)[0] : undefined;
  const frames = useShotFrames(first ? [clipShot(first)] : []);
  const draft = card.draft;
  useEffect(() => {
    if (!draft || !data.renderMedia) return;
    let alive = true;
    data.renderMedia(draft.renderId, 'poster').then(
      (url) => alive && setPoster(url),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [data, draft]);
  return poster ?? (first ? (frames(clipShot(first))?.url ?? null) : null);
}

export function ExportApprovalCard({ card }: { card: Card }) {
  const { t, i18n } = useLingui();
  const actions = useCardActions();
  const primary = usePrimaryVariant(card.id);
  const picture = usePicture(card);
  const status = card.status;
  const waiting = status === 'pending' || status === 'updating';
  const variantAt = card.variant ? i18n.number(card.variant.index) : null;
  const variantOf = card.variant ? i18n.number(card.variant.count) : null;
  // The page where the approval is made; in a chat that can't open it (the editor's docked chat), the editor's own
  // export dialog, which shows the same video and choices.
  const review = actions.review
    ? () => actions.review?.(card)
    : actions.navigate
      ? () =>
          actions.navigate?.({
            to: 'timeline',
            projectId: card.projectId,
            timelineId: card.timelineId,
            exportDialog: true,
          })
      : null;

  return (
    <CardFrame
      cardType="exportApproval"
      data-status={status}
      title={t`Ready to export`}
      aside={
        variantAt ? (
          <span className="type-meta text-ink-2 tabular-nums">{t`Video ${variantAt} of ${variantOf}`}</span>
        ) : null
      }
    >
      <div className="flex items-start gap-4">
        <ShotThumb url={picture} size="md" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {card.draft ? (
            <QaSummaryLine summary={card.draft.qa} />
          ) : (
            <p className="m-0 type-body text-ink-2">{t`No preview yet`}</p>
          )}
          <Outcome status={status} />
          {waiting && review ? (
            <div>
              <Button variant={primary} data-slot="review-link" icon={VERB_ICONS.play} onClick={review}>
                {t`Review and export`}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </CardFrame>
  );
}

/** How the approval stands, in one line; nothing while it simply waits. */
function Outcome({ status }: { status: Card['status'] }) {
  const { t } = useLingui();
  switch (status) {
    case 'pending':
      return null;
    case 'updating':
      return (
        <p role="status" className="m-0 flex items-center gap-2 type-body text-ink">
          <StatusMark status="running" />
          {t`Updating with your swap…`}
        </p>
      );
    case 'exporting':
      return (
        <p role="status" className="m-0 flex items-center gap-2 type-body text-ink">
          <StatusMark status="running" />
          {t`Exporting…`}
        </p>
      );
    case 'exported':
      return (
        <p role="status" className="m-0 flex items-center gap-2 type-body text-ink">
          <Tick className="size-4 text-success-strong" />
          {t`Exported`}
        </p>
      );
    case 'declined':
      return <p className="m-0 type-body text-ink-2">{t`Not exported. Say when you’re ready.`}</p>;
    case 'expired':
      return <p className="m-0 type-body text-ink-2">{t`This run ended.`}</p>;
  }
}
