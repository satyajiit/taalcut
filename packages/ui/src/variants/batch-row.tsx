// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: batch row (P3-V16, U-5) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.4 · one video of a batch export: a status mark and word (colour never alone), the export's
 *   name as written, its preset, the percent while it runs; a ready row has Show (Finder); a row that needs a look
 *   opens its QA report in place (fixes and Export anyway as on the export card)
 * states: queued · exporting (neutral, percent in tabular digits) · ready · needs review · failed (UX1: its cause
 *   on a line under it) · stopped · gone ("This export was deleted.") · Show and Review are the kit's Button (default, hover, focus-visible, active, disabled,
 *   loading; their error is the card's line) · review open (aria-expanded)
 * pre-emit critique: P4 H5 E4 S5 R5 V4 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { QaFix, QaReport, RenderSnapshot } from '@taalcut/core';
import {
  CircleAlert,
  CircleCheck,
  CircleMinus,
  CircleX,
  Clock,
  FolderOpen,
  LoaderCircle,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '#components/button';
import { cn } from '#lib/cn';
import { useFormatters } from '#lib/format';
import { errorMessage } from '../feedback/error-messages';
import { UserContent } from '../cards/card-frame';
import { useCardActions } from '../cards/card-actions';
import { useCardData } from '../cards/card-data';
import { QaChecklist, type QaChecklistItem } from '../make/qa-checklist';
import { presetLabel, qaCheckLabel, qaFixLabel, renderStageLabel } from '../make/render-words';
import type { BatchItem, BatchItemStatus } from './batch-fold';

const LOOK: Readonly<Record<BatchItemStatus, { icon: LucideIcon; tone: string; word: MessageDescriptor }>> = {
  queued: { icon: Clock, tone: 'text-ink-3', word: msg`Waiting to start` },
  running: { icon: LoaderCircle, tone: 'text-ink-2', word: msg`Exporting` },
  ready: { icon: CircleCheck, tone: 'text-success-strong', word: msg`Exported` },
  needsAttention: { icon: CircleAlert, tone: 'text-warning-strong', word: msg`Needs review` },
  failed: { icon: CircleX, tone: 'text-danger-strong', word: msg`Didn’t finish` },
  cancelled: { icon: CircleMinus, tone: 'text-ink-3', word: msg`Stopped` },
};

export interface BatchRowProps {
  readonly item: BatchItem;
  readonly status: BatchItemStatus;
  /** The render now: undefined while it loads (or none yet), null once it is gone. */
  readonly live: RenderSnapshot | null | undefined;
  /** "Video 2": the name until the render's own arrives. */
  readonly fallbackName: string;
  /** A command from the row (a QA fix, Export anyway); the card shows its error. */
  readonly send: (name: string, payload: unknown) => Promise<unknown>;
}

export function BatchRow({ item, status, live, fallbackName, send }: BatchRowProps) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const actions = useCardActions();
  const data = useCardData();
  const [review, setReview] = useState<QaReport | null>(null);
  const [busy, setBusy] = useState(false);
  const look = LOOK[status];
  const Icon = look.icon;
  const gone = live === null;
  const fraction = status === 'running' ? (live?.progress?.fraction ?? null) : null;
  const words =
    status === 'running' && live
      ? renderStageLabel(i18n, live.progress?.stageKey, live.status)
      : i18n._(look.word);
  const renderId = item.renderId;

  const openReview = async () => {
    if (review) return setReview(null);
    if (!renderId || !data.qaReport) return;
    setBusy(true);
    try {
      const report = await data.qaReport(renderId);
      if (report) setReview(report);
    } finally {
      setBusy(false);
    }
  };
  const fix = async (check: QaChecklistItem, action: QaFix) => {
    if (action.kind === 'command') await send(action.command, action.payload);
    else if (action.kind === 'agent') {
      const name = qaCheckLabel(i18n, check.labelKey);
      const fixWords = qaFixLabel(i18n, action.instructionKey, action.params);
      actions.ask?.(t`${name}: ${fixWords}`, []);
    }
  };

  return (
    <li data-slot="batch-row" data-status={status} className="flex flex-col gap-2 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <Icon
          aria-hidden
          className={cn(
            'size-4 shrink-0',
            look.tone,
            status === 'running' && fraction === null && 'animate-spin',
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <UserContent translate="no" className="truncate text-sm text-ink">
            {live?.name ?? fallbackName}
          </UserContent>
          <span className="truncate text-xs text-ink-2">
            {gone ? t`This export was deleted.` : `${presetLabel(i18n, item.presetId)} · ${words}`}
          </span>
        </div>
        {fraction !== null ? (
          <span className="shrink-0 text-sm text-ink tabular-nums">{format.percent(fraction)}</span>
        ) : null}
        {status === 'ready' && renderId && actions.reveal && !gone ? (
          <Button size="sm" variant="ghost" onClick={() => void actions.reveal?.(renderId)}>
            <FolderOpen aria-hidden />
            {t`Show`}
          </Button>
        ) : null}
        {status === 'needsAttention' && renderId && data.qaReport && !gone ? (
          <Button
            size="sm"
            variant="secondary"
            aria-expanded={review !== null}
            loading={busy}
            onClick={() => void openReview()}
          >
            {t`Review`}
          </Button>
        ) : null}
      </div>
      {status === 'failed' && live?.error && !gone ? (
        <p data-slot="batch-row-cause" className="m-0 ms-7 text-xs text-ink">
          {errorMessage(i18n, live.error)}
        </p>
      ) : null}
      {review && status === 'needsAttention' && renderId ? (
        <QaChecklist
          checks={review.checks}
          onFix={fix}
          onOverride={(checks) => send('render.overrideQa', { projectId: item.projectId, renderId, checks })}
          className="ms-7"
        />
      ) : null}
    </li>
  );
}
