// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · component: the check's draft (UX4, research A1) · Operate · system: DESIGN.md v0.7
 * The draft the reviewer checks before the one approval is a draft, not an export: one step line with its status
 *   mark, its words and how far it is. No file, no Show in Finder, no "Exported": nothing is exported until the
 *   person says so on the review page.
 * states: making (running mark, the share done) · checking and fixing (running) · ready ("Draft ready for the
 *   check", what the check found when it has) · needs a look (the check's line) · failed · stopped · not interactive
 * motion: the status mark settles from running to done (the vendored StatusMark's morph; a fade under reduced
 *   motion); the line's words crossfade with it */
import { useLingui } from '@lingui/react/macro';
import type { CardOf } from '@taalcut/core';
import { CrossfadeText } from '../components/crossfade-text';
import { StatusMark, type StepStatus } from '../chat/status-mark';
import { QaSummaryLine } from '../make/qa-checklist';
import type { RenderView } from '../make/render-progress-view';
import { StepHeader } from './step-header';

const MARK: Readonly<Record<RenderView['status'], StepStatus>> = {
  queued: 'pending',
  rendering: 'running',
  checking: 'running',
  fixing: 'running',
  ready: 'done',
  needsAttention: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
};

/**
 * A render progress card with no "Would you post this?" is the reviewer's draft (render.draft's card; render.export's
 * asks it). Until the card says so itself (specs/agt-requests.md), this is how the transcript tells them apart.
 */
export const isCheckDraft = (card: CardOf<'renderProgress'>): boolean => card.survey !== true;

export function DraftProgress({ render }: { render: RenderView }) {
  const { t, i18n } = useLingui();
  const fraction = render.progress?.fraction ?? undefined;
  const percent = fraction === undefined ? null : i18n.number(fraction, { style: 'percent' });
  const words =
    render.status === 'queued'
      ? t`Waiting to make a draft`
      : render.status === 'rendering'
        ? percent
          ? t`Making a draft to check · ${percent}`
          : t`Making a draft to check`
        : render.status === 'checking' || render.status === 'fixing'
          ? t`Checking the draft`
          : render.status === 'failed'
            ? t`The draft didn’t finish`
            : render.status === 'cancelled'
              ? t`Stopped`
              : t`Draft ready for the check`;
  return (
    <div className="flex flex-col gap-2">
      <StepHeader title={t`Draft for checking`} />
      <p data-slot="draft-line" className="m-0 flex items-center gap-3 type-body text-ink">
        <StatusMark
          status={MARK[render.status]}
          {...(fraction === undefined ? {} : { progress: fraction })}
        />
        <CrossfadeText value={render.status}>
          <span>{words}</span>
        </CrossfadeText>
      </p>
      {render.qa && (render.status === 'ready' || render.status === 'needsAttention') ? (
        <QaSummaryLine summary={render.qa} className="ps-7" />
      ) : null}
    </div>
  );
}
