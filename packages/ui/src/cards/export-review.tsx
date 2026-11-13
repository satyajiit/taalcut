// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · component: the export review (UX4, B8: the one approval as a page) · Operate, footage first
 * system: DESIGN.md v0.7 (Page, the icon registry, Collapse, the motion grammar)
 * The run's one approval, on a page of its own: the video first, as large as the window allows, on the viewer grey;
 *   under it one row with what the check found on the left and Options, Not now and Export (the page's one marigold)
 *   on the right; everything else the approval decides behind Options. The keys are said once, quietly, under the
 *   row. A QA draft is called a draft here and everywhere: nothing says "Exported" until it is.
 * states: pending (everything changeable) · updating (the video dims, "Updating with your swap…", Export waits with
 *   its reason) · exporting (Export busy, the rest off) · exported (a drawn tick and "Exported", Show in Finder,
 *   Back to the chat) · declined ("Not exported…") · expired ("This run ended.") · a choice or the answer failed
 *   (its cause in one line, with Try again) · every button carries the eight states (the kit's Button)
 * keyboard: Space plays and pauses, ⌘↩ exports, Escape goes back to the chat (useReviewKeys)
 * motion: Options opens with Collapse; the exported tick draws in; the video dims while a swap lands; under reduced
 *   motion the tick fades and the region opens at once */
import { useLingui } from '@lingui/react/macro';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Button } from '#components/button';
import { Collapse } from '#components/collapse';
import { Tick } from '#components/tick';
import { cn } from '#lib/cn';
import { DUR } from '#lib/motion';
import { StatusMark } from '../chat/status-mark';
import { errorMessage } from '../feedback/error-messages';
import { VERB_ICONS } from '../icons/concepts';
import { QaSummaryLine } from '../make/qa-checklist';
import { ShortcutKeys } from '../palette/command-palette';
import { useShortcutFormat } from '../palette/key-words';
import { useCardActions } from './card-actions';
import { ExportOptions } from './export-options';
import { LiveReadLine } from './live-read-line';
import { ReviewStage } from './review-stage';
import { AnswerFailureLine } from './use-answer';
import { useExportApproval, type ExportApprovalCard } from './use-export-approval';
import { useReviewKeys } from './use-review-keys';

export interface ExportReviewProps {
  readonly card: ExportApprovalCard;
  /** Back to the chat: Escape, the settled page's button, and after Export or Not now went through. */
  readonly onBack: () => void;
}

/** The Collapse's --dur-short and a frame: the options have their full height by then. */
const OPENED_MS = DUR.short * 1000 + 20;

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** The one approval as a page: watch the video, export it; the rest behind Options. */
export function ExportReview({ card, onBack }: ExportReviewProps) {
  const { t, i18n } = useLingui();
  const keys = useShortcutFormat();
  const state = useExportApproval(card);
  const [options, setOptions] = useState(false);
  const optionsId = useId();
  const page = useRef<HTMLElement>(null);
  const bar = useRef<HTMLDivElement>(null);

  const exportNow = async () => {
    if (await state.exportNow()) onBack();
  };
  const notNow = async () => {
    if (await state.notNow()) onBack();
  };
  const toggleOptions = () => {
    const next = !options;
    setOptions(next);
    // What you asked for comes into view: once the region has its height, the row moves up and the options show
    // under it.
    if (next) {
      const reduce = reducedMotion();
      window.setTimeout(
        () => bar.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' }),
        reduce ? 0 : OPENED_MS,
      );
    }
  };
  useReviewKeys({
    togglePlay: () =>
      page.current?.querySelector<HTMLButtonElement>('[data-slot=review-video] button[aria-label]')?.click(),
    exportNow: () => void exportNow(),
    back: onBack,
  });

  const { status } = state;
  const waiting = status === 'pending' || status === 'updating';
  return (
    <section
      ref={page}
      data-slot="review-page"
      data-status={status}
      aria-label={t`Review the video`}
      className="flex flex-col gap-4"
    >
      <ReviewStage card={card} state={state} />
      <div
        ref={bar}
        data-slot="review-bar"
        className="flex scroll-mt-4 flex-wrap items-center gap-x-4 gap-y-3"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {card.draft ? (
            <QaSummaryLine summary={card.draft.qa} />
          ) : (
            <p className="m-0 type-body text-ink-2">{t`No preview yet`}</p>
          )}
        </div>
        {waiting || status === 'exporting' ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              data-slot="review-options-toggle"
              icon={SlidersHorizontal}
              aria-expanded={options}
              aria-controls={optionsId}
              onClick={toggleOptions}
            >
              {t`Options`}
              <ChevronDown
                aria-hidden
                className={cn(
                  'transition-transform duration-(--dur-short) ease-(--ease-out)',
                  options && 'rotate-180',
                )}
              />
            </Button>
            <Button
              variant="secondary"
              loading={state.busy === 'decline'}
              disabled={state.off || !state.canAnswer}
              onClick={() => void notNow()}
            >
              {t`Not now`}
            </Button>
            <Button
              variant="primary"
              data-slot="review-export"
              icon={VERB_ICONS.export}
              aria-keyshortcuts={keys.aria('mod+enter')}
              loading={state.busy === 'export' || status === 'exporting'}
              disabled={!state.canExport}
              onClick={() => void exportNow()}
            >
              {t`Export`}
            </Button>
          </div>
        ) : (
          <Settled card={card} onBack={onBack} />
        )}
      </div>
      {state.updating ? (
        <p role="status" className="m-0 flex items-center gap-2 type-body text-ink">
          <StatusMark status="running" />
          {t`Updating with your swap…`}
          <span className="type-meta text-ink-2">{t`Export waits for the new preview.`}</span>
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="m-0 type-body text-danger-strong">
          {errorMessage(i18n, state.error)}
        </p>
      ) : null}
      <AnswerFailureLine failure={state.answer.failure} />
      <LiveReadLine read={state.watched.read} onRetry={state.watched.retry} gone={false} />
      {waiting ? <KeyHints /> : null}
      <Collapse id={optionsId} open={options && (waiting || status === 'exporting')}>
        <ExportOptions card={card} state={state} />
      </Collapse>
    </section>
  );
}

/** What the approval came to, and the way back. */
function Settled({ card, onBack }: { card: ExportApprovalCard; onBack: () => void }) {
  const { t } = useLingui();
  const actions = useCardActions();
  const renderId = card.renderId;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <p role="status" data-slot="review-outcome" className="m-0 flex items-center gap-2 type-body text-ink">
        {card.status === 'exported' ? (
          <>
            <Tick className="size-4 text-success-strong" />
            {t`Exported`}
          </>
        ) : card.status === 'exporting' ? (
          <>
            <StatusMark status="running" />
            {t`Exporting…`}
          </>
        ) : card.status === 'declined' ? (
          t`Not exported. Say when you’re ready.`
        ) : (
          t`This run ended.`
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {card.status === 'exported' && renderId && actions.reveal ? (
          <Button
            variant="secondary"
            icon={VERB_ICONS.reveal}
            onClick={() => void actions.reveal?.(renderId)}
          >
            {t`Show in Finder`}
          </Button>
        ) : null}
        <Button variant="secondary" icon={VERB_ICONS.back} onClick={onBack}>
          {t`Back to the chat`}
        </Button>
      </div>
    </div>
  );
}

/** The page's keys, once, quietly: what a person can press instead of reaching for the pointer. */
function KeyHints() {
  const { t } = useLingui();
  return (
    <p
      aria-hidden
      data-slot="review-keys"
      className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1 type-meta text-ink-2"
    >
      <span className="flex items-center gap-1.5">
        <kbd className="inline-flex h-5 items-center rounded-sm border border-rule bg-chip px-1.5 type-caption text-ink-2">
          {t({ message: 'Space', comment: 'The space bar, as printed on keyboards' })}
        </kbd>
        {t`plays and pauses`}
      </span>
      <span className="flex items-center gap-1.5">
        <ShortcutKeys accelerator="mod+enter" />
        {t`exports`}
      </span>
      <span className="flex items-center gap-1.5">
        <ShortcutKeys accelerator="escape" />
        {t`back to the chat`}
      </span>
    </p>
  );
}
