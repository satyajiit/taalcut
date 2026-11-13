// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · component: the review page's stage (UX4, B8) · Operate, footage first · system: DESIGN.md v0.7
 * The video to approve, as large as the window lets it be: a band of the neutral viewer grey the width of the
 *   column, as tall as the window less the bar and the Export row, with the cut playing at its own shape in the
 *   middle (the app's preview of the timeline; the draft's poster once the approval has settled). Nothing sits on
 *   the footage: no Kaatu, no chip, no caption of the app's.
 * states: playable (the preview's own: a press, or Space, plays and pauses) · updating (dims while a swap is folded
 *   in) · settled (the poster) · no draft (the grey says so) · loading (the grey alone)
 * motion: the dim on updating eases its opacity (--dur-short); nothing else moves */
import { useLingui } from '@lingui/react/macro';
import { useEffect, useState, type CSSProperties } from 'react';
import { cn } from '#lib/cn';
import { useCardData } from './card-data';
import type { ExportApprovalCard, ExportApprovalState } from './use-export-approval';

/** The window's height less the bar, the page's top space, the Export row and the page's foot. */
const STAGE_HEIGHT = 'max(20rem, calc(100dvh - var(--spacing-toolbar) - 11rem))';

export interface ReviewStageProps {
  readonly card: ExportApprovalCard;
  readonly state: ExportApprovalState;
}

/** The video, first and large, on the viewer grey. */
export function ReviewStage({ card, state }: ReviewStageProps) {
  const { t } = useLingui();
  const data = useCardData();
  const [poster, setPoster] = useState<string | null>(null);
  const draft = card.draft;
  const live = state.live;
  const playable = Boolean(live && data.renderPreview && !state.settled);

  useEffect(() => {
    if (!draft || !data.renderMedia || playable) return;
    let alive = true;
    data.renderMedia(draft.renderId, 'poster').then(
      (url) => alive && setPoster(url),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [data, draft, playable]);

  // The cut at its own shape: 9:16 for a short, wider for a landscape preset.
  const ratio = live ? `${live.canvas.width} / ${live.canvas.height}` : '9 / 16';
  const box: CSSProperties = { aspectRatio: ratio, height: '100%', maxWidth: '100%' };
  return (
    <div
      data-slot="review-stage"
      // Which checked draft this is: the e2e tell a swap's new draft from the one before by it.
      data-draft={draft?.renderId}
      className="tc-viewer grid place-items-center overflow-hidden rounded-xl p-4"
      style={{ height: STAGE_HEIGHT }}
    >
      <div
        data-slot="review-video"
        className={cn(
          'relative min-h-0 transition-opacity duration-(--dur-short) ease-(--ease-out)',
          state.updating && 'opacity-50',
        )}
        style={box}
      >
        {playable && live && data.renderPreview ? (
          data.renderPreview({
            projectId: card.projectId,
            timelineId: card.timelineId,
            revision: card.timelineRevision,
            label: t`Preview of the video to export`,
            className: 'h-full',
          })
        ) : poster ? (
          <img src={poster} alt={t`The video to export`} className="size-full rounded-lg object-contain" />
        ) : (
          <p className="m-0 grid size-full place-items-center type-meta text-viewer-ink-2">
            {draft ? null : t`No preview yet`}
          </p>
        )}
      </div>
    </div>
  );
}
