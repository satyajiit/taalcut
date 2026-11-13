// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: render progress card (P2-M11) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · a step panel for a background job, so it runs neutral: RenderProgressView with the
 *   render's live state (renders.watch), the latest frame once capture has passed a fifth, Cancel and Notify me;
 *   once ready: the file, Show in Finder, and "Would you post this?" once; needs a look: Review opens the checks
 * states: as RenderProgressView (queued · running · checking · ready · needs a look · failed · stopped) · review
 *   open (the QA checklist with fixes and Export anyway) · disabled (the export is gone: "This export was deleted.") ·
 *   error (a command's cause in one line) · watch lost (UX round 1: the export as last seen, with Cancel, Try
 *   again and Reveal still there, and the cause with Try again under it; never "This was deleted.")
 * pre-emit critique: P5 H5 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { CardOf, QaFix, QaReport, TaalcutError } from '@taalcut/core';
import { useEffect, useState } from 'react';
import { errorMessage } from '../feedback/error-messages';
import { QaChecklist, type QaChecklistItem } from '../make/qa-checklist';
import { RenderProgressView, type RenderView } from '../make/render-progress-view';
import { presetLabel, qaCheckLabel, qaFixLabel } from '../make/render-words';
import { DraftProgress, isCheckDraft } from './draft-progress';
import { ExportSurvey } from './export-survey';
import { StepHeader } from './step-header';
import { useCardActions } from './card-actions';
import { useCardData, useRenderRead } from './card-data';
import { liveValue } from './live-read';
import { LiveReadLine } from './live-read-line';

/** What the card itself knows, until the live render arrives. */
function fromCard(card: CardOf<'renderProgress'>, name: string): RenderView {
  return {
    presetId: card.presetId,
    status: card.status,
    progress: card.progress,
    name,
    rate: { num: 30, den: 1 },
    durationFrames: 0,
    bytes: null,
    qa: card.qa,
    notify: card.notify,
    error: null,
  };
}

export function RenderProgressCard({ card }: { card: CardOf<'renderProgress'> }) {
  const { t, i18n } = useLingui();
  const actions = useCardActions();
  const data = useCardData();
  const watched = useRenderRead(card.renderId);
  // The newest the card has seen, or the last before a failure: its actions stay usable while the watch is down.
  const live = liveValue(watched.read);
  const render = live ?? fromCard(card, presetLabel(i18n, card.presetId));
  const gone = watched.read.status === 'gone';
  const [poster, setPoster] = useState<string | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);
  const [review, setReview] = useState<QaReport | null>(null);
  const pastFifth = (render.progress?.fraction ?? 0) >= 0.2;

  // The poster exists once capture passes 20% (render SPEC 9); ask again when that, or the status, changes.
  useEffect(() => {
    if (!data.renderMedia) return;
    let live = true;
    data.renderMedia(card.renderId, 'poster').then(
      (url) => live && setPoster(url),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [data, card.renderId, render.status, pastFifth]);

  const send = async (name: string, payload: unknown) => {
    setError(null);
    const result = await actions.dispatch?.(name, payload);
    if (result && !result.ok) setError(result.error);
    return result;
  };
  const target = { projectId: card.projectId, renderId: card.renderId };
  const again = live
    ? () =>
        send('render.export', {
          projectId: live.projectId,
          timelineId: live.timelineId,
          presetId: live.presetId,
          captions: live.captions,
          notify: live.notify,
        })
    : undefined;
  const openReview = async () => {
    if (review) return setReview(null);
    const report = await data.qaReport?.(card.renderId);
    if (report) setReview(report);
  };
  const fix = async (check: QaChecklistItem, action: QaFix) => {
    if (action.kind === 'command') await send(action.command, action.payload);
    else if (action.kind === 'agent') {
      const name = qaCheckLabel(i18n, check.labelKey);
      const words = qaFixLabel(i18n, action.instructionKey, action.params);
      actions.ask?.(t`${name}: ${words}`, []);
    }
  };

  // The reviewer's draft is never called an export (UX4, research A1): one step line, no file to reveal.
  if (isCheckDraft(card))
    return (
      <article
        data-slot="smart-card"
        data-card-type="renderProgress"
        data-status={render.status}
        data-draft=""
        aria-label={t`Draft for checking`}
        className="flex max-w-[42rem] flex-col gap-3"
      >
        <DraftProgress render={render} />
        <LiveReadLine read={watched.read} onRetry={watched.retry} gone={t`This draft was deleted.`} />
      </article>
    );
  const title = t`Export`;
  return (
    <article
      data-slot="smart-card"
      data-card-type="renderProgress"
      data-status={render.status}
      aria-label={title}
      className="flex max-w-[42rem] flex-col gap-3"
    >
      <StepHeader title={title} />
      {gone ? null : (
        <RenderProgressView
          render={render}
          posterUrl={poster}
          {...(actions.dispatch
            ? {
                onCancel: () => send('render.cancel', target),
                onNotify: (notify: boolean) => send('render.setNotify', { ...target, notify }),
                ...(again ? { onRetry: again } : {}),
              }
            : {})}
          {...(actions.reveal ? { onReveal: () => actions.reveal?.(card.renderId) } : {})}
          {...(data.qaReport ? { onReview: () => void openReview() } : {})}
        />
      )}
      <LiveReadLine read={watched.read} onRetry={watched.retry} gone={t`This export was deleted.`} />
      {/* P2-X7's question at the card's foot, once the export is ready (asked once, telemetry on). */}
      {card.survey === true && render.status === 'ready' && !gone ? (
        <ExportSurvey renderId={card.renderId} />
      ) : null}
      {review && render.status === 'needsAttention' ? (
        <QaChecklist
          checks={review.checks}
          onFix={fix}
          {...(actions.dispatch
            ? { onOverride: (checks: readonly string[]) => send('render.overrideQa', { ...target, checks }) }
            : {})}
        />
      ) : null}
      {error ? (
        <p role="alert" className="m-0 text-sm text-danger-strong">
          {errorMessage(i18n, error)}
        </p>
      ) : null}
    </article>
  );
}
