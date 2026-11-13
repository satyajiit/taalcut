// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: render batch card (P3-V16, U-5) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · a step panel for a background job, so it runs neutral: "3 videos in one queue", the
 *   folded progress in words (ready, needs a look, didn't finish, running, waiting) with one neutral bar and the
 *   time left, a row per video (BatchRow), Notify me for every video and Cancel the rest; each render is watched,
 *   so the card moves without a new one
 * states: waiting for your OK (an exportApproval in its batch form sits above: nothing queued yet) · queued ·
 *   running · done (every video final: no Cancel, no bar) · with needs-a-look and failed rows · stopped · error (a
 *   command's cause in one alert line) · Cancel the rest is the kit's Button, Notify me the kit's Switch (eight
 *   states each) · reduced motion: the bar's transition is the base layer's
 * pre-emit critique: P4 H5 E4 S5 R5 V4 */
import { plural } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { CardOf, TaalcutError } from '@taalcut/core';
import { useState } from 'react';
import { Button } from '#components/button';
import { useFormatters } from '#lib/format';
import { errorMessage } from '../feedback/error-messages';
import { LabelledSwitch } from '../make/switch';
import { doneFraction, foldItems, itemStatus } from '../variants/batch-fold';
import { BatchRow } from '../variants/batch-row';
import { useLiveRenders } from '../variants/use-live-renders';
import { useCardActions } from './card-actions';
import { StepHeader } from './step-header';

export function RenderBatchCard({ card }: { card: CardOf<'renderBatch'> }) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const actions = useCardActions();
  const live = useLiveRenders(card.items.map((item) => item.renderId));
  const [error, setError] = useState<TaalcutError | null>(null);
  const [busy, setBusy] = useState<'cancel' | 'notify' | null>(null);
  const [notifyWanted, setNotifyWanted] = useState<boolean | null>(null);
  const progress = foldItems(card, live);
  const snapshots = card.items.map((item) => (item.renderId ? live.get(item.renderId) : undefined));
  const going = progress.queued + progress.running > 0;
  const fraction = doneFraction(progress, snapshots);
  const waiting = card.approvalId !== undefined && card.items.every((item) => item.renderId === null);
  const watched = snapshots.filter((snapshot) => snapshot);
  const notifying = notifyWanted ?? (watched.length > 0 && watched.every((snapshot) => snapshot?.notify));

  const send = async (name: string, payload: unknown) => {
    setError(null);
    const result = await actions.dispatch?.(name, payload);
    if (result && !result.ok) setError(result.error);
    return result;
  };
  const cancelRest = async () => {
    setBusy('cancel');
    try {
      await send('render.cancelBatch', { batchId: progress.batchId });
    } finally {
      setBusy(null);
    }
  };
  // Notify me is each render's own switch (render.setNotify): set it on every video still going.
  const notify = async (next: boolean) => {
    setNotifyWanted(next);
    setBusy('notify');
    try {
      for (const [index, item] of card.items.entries()) {
        const status = itemStatus(item, snapshots[index]);
        if (!item.renderId || (status !== 'queued' && status !== 'running')) continue;
        const result = await send('render.setNotify', {
          projectId: item.projectId,
          renderId: item.renderId,
          notify: next,
        });
        if (result && !result.ok) return setNotifyWanted(!next);
      }
    } finally {
      setBusy(null);
    }
  };

  // One count per state, each said with its own plural (UX round 1: "1 needs review", not "1 need review").
  const parts = [
    progress.ready > 0 ? t`${plural(progress.ready, { one: '# ready', other: '# ready' })}` : null,
    progress.needsAttention > 0
      ? t`${plural(progress.needsAttention, { one: '# needs review', other: '# need review' })}`
      : null,
    progress.failed > 0
      ? t`${plural(progress.failed, { one: '# didn’t finish', other: '# didn’t finish' })}`
      : null,
    progress.cancelled > 0
      ? t`${plural(progress.cancelled, { one: '# stopped', other: '# stopped' })}`
      : null,
    progress.running > 0
      ? t`${plural(progress.running, { one: '# exporting', other: '# exporting' })}`
      : null,
    progress.queued > 0 ? t`${plural(progress.queued, { one: '# waiting', other: '# waiting' })}` : null,
  ].filter((part): part is string => part !== null);
  const left =
    going && progress.etaMs !== null && progress.etaMs > 0 ? format.duration(progress.etaMs) : null;
  const title = <Plural value={progress.total} one="# video in one queue" other="# videos in one queue" />;

  return (
    <article
      data-slot="smart-card"
      data-card-type="renderBatch"
      data-status={going ? 'running' : 'done'}
      aria-label={t`Export all`}
      className="flex max-w-[42rem] flex-col gap-3"
    >
      <StepHeader title={title} />
      {waiting ? (
        <p className="m-0 text-sm text-ink-2">{t`Waiting for your OK on the export above.`}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p data-slot="batch-summary" className="m-0 text-sm text-ink tabular-nums">
            {parts.join(' · ')}
          </p>
          {going ? (
            <div
              role="progressbar"
              aria-label={t`Batch progress`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(fraction * 100)}
              aria-valuetext={parts.join(', ')}
              className="h-1 overflow-hidden rounded-pill bg-hover"
            >
              <span
                className="block h-full w-full origin-left rounded-pill bg-ink-2 transition-transform duration-(--dur-short) ease-(--ease-out)"
                style={{ transform: `scaleX(${fraction})` }}
              />
            </div>
          ) : null}
          {going && (left || actions.dispatch) ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {left ? (
                <span className="text-xs text-ink-2 tabular-nums">
                  <Trans>
                    About{' '}
                    <time dateTime={`PT${Math.round((progress.etaMs ?? 0) / 1000)}S`} className="font-sans">
                      {left}
                    </time>{' '}
                    left
                  </Trans>
                </span>
              ) : null}
              {actions.dispatch ? (
                <>
                  <LabelledSwitch
                    checked={notifying}
                    loading={busy === 'notify'}
                    onChange={(next) => void notify(next)}
                    className="text-xs"
                  >
                    {t`Notify me when they’re done`}
                  </LabelledSwitch>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ms-auto"
                    loading={busy === 'cancel'}
                    onClick={() => void cancelRest()}
                  >
                    {t`Cancel the rest`}
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      {/* Waiting rows keep their full ink: the line above says why nothing has started, and dimmed words would fall
          under the reading floor (4.1:1 in light). */}
      <ul className="m-0 flex list-none flex-col divide-y divide-rule-subtle p-0">
        {card.items.map((item, index) => {
          const number = i18n.number(index + 1);
          return (
            <BatchRow
              key={`${item.timelineId}-${item.presetId}`}
              item={item}
              status={itemStatus(item, snapshots[index])}
              live={snapshots[index]}
              fallbackName={t`Video ${number}`}
              send={send}
            />
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className="m-0 text-sm text-danger-strong">
          {errorMessage(i18n, error)}
        </p>
      ) : null}
    </article>
  );
}
