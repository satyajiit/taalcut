// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: render progress · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * an export is a background job, so it runs neutral (DESIGN.md "Running"): ink-2 words, a neutral bar scaled with
 *   transform, the percent in JetBrains Mono so only its digits change; the latest frame sits on the viewer grey
 * states: queued (spinner, "Waiting to start") · running (stage words, bar, percent, time left; Cancel; Notify me) ·
 *   checking/fixing (Cancel disabled with its reason) · ready ("Exported", or the caller's word for what isn't an
 *   export; file, size, length, Show in Finder; "Would you post this?" once) · needs a look (the QA line and
 *   Review) · failed (the cause and Try again) · cancelled ("Stopped") · every control is a Button or the kit's
 *   Switch (eight states)
 * motion: the bar's transform only (--dur-short, ease-out); reduced motion: the base layer shortens it
 * pre-emit critique: P5 H5 E4 S5 R5 V4 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { RenderSnapshot } from '@taalcut/core';
import { CircleCheck, CircleMinus, CircleX, FolderOpen, LoaderCircle, RotateCcw } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '#components/button';
import { cn } from '#lib/cn';
import { useFormatters } from '#lib/format';
import { UserContent } from '../cards/card-frame';
import { VERB_ICONS } from '../icons/concepts';
import { errorMessage } from '../feedback/error-messages';
import { QaSummaryLine } from './qa-checklist';
import { presetLabel, renderStageLabel } from './render-words';
import { ShotThumb } from './shot-thumb';
import { LabelledSwitch } from './switch';
import { useTimecode } from './timecode';

/** What the view reads of a render: a live RenderSnapshot, or what a card already knows. */
export type RenderView = Pick<
  RenderSnapshot,
  | 'status'
  | 'progress'
  | 'presetId'
  | 'name'
  | 'durationFrames'
  | 'rate'
  | 'bytes'
  | 'notify'
  | 'qa'
  | 'error'
>;

export interface RenderProgressViewProps {
  render: RenderView;
  /** The latest frame or the poster; null keeps the viewer grey. */
  posterUrl?: string | null;
  onCancel?: () => void | Promise<unknown>;
  onNotify?: (notify: boolean) => void | Promise<unknown>;
  onReveal?: () => void | Promise<unknown>;
  onRetry?: () => void | Promise<unknown>;
  /** Needs a look: open the QA details. */
  onReview?: () => void;
  /** Buttons off (the run ended, the render is gone): their reason is the caller's line. */
  disabled?: boolean;
  /**
   * The word for a finished render, "Exported" unless the caller says otherwise: a QA draft or a preview isn't an
   * export, and never says it is (the owner's call, UX4).
   */
  finishedLabel?: ReactNode;
  variant?: 'card' | 'dialog';
  className?: string;
}

const RUNNING = new Set(['queued', 'rendering', 'checking', 'fixing']);

export function RenderProgressView({
  render,
  posterUrl,
  onCancel,
  onNotify,
  onReveal,
  onRetry,
  onReview,
  disabled = false,
  variant = 'card',
  finishedLabel,
  className,
}: RenderProgressViewProps) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const time = useTimecode();
  const [busy, setBusy] = useState<string | null>(null);
  const [notify, setNotify] = useState<boolean | null>(null);
  const running = RUNNING.has(render.status);
  const fraction = render.progress?.fraction ?? null;
  const stage = renderStageLabel(i18n, render.progress?.stageKey, render.status);
  const finishing =
    render.status === 'checking' ||
    render.status === 'fixing' ||
    render.progress?.stageKey?.endsWith('finishing');
  const preset = presetLabel(i18n, render.presetId);
  // A snapshot from a card may not know the length yet.
  const length = render.durationFrames > 0 ? time.length(render.durationFrames, render.rate) : null;
  const notifying = notify ?? render.notify;

  const press = async (key: string, run?: () => void | Promise<unknown>) => {
    if (!run) return;
    setBusy(key);
    try {
      await run();
    } finally {
      setBusy(null);
    }
  };

  const percent = fraction === null ? null : format.percent(fraction);
  const eta = render.progress?.etaMs;
  const left = eta !== undefined && eta > 0 ? format.duration(eta) : null;
  const size =
    render.bytes === null
      ? null
      : new Intl.NumberFormat(i18n.locale === 'en-XA' ? 'en' : i18n.locale, {
          style: 'unit',
          unit: 'megabyte',
          unitDisplay: 'short',
          maximumFractionDigits: 1,
        }).format(render.bytes / 1_000_000);

  return (
    <div
      data-slot="render-progress"
      data-status={render.status}
      className={cn('flex gap-4', variant === 'dialog' ? 'items-start' : 'items-center', className)}
    >
      <ShotThumb url={posterUrl} size={variant === 'dialog' ? 'lg' : 'md'} dimmed={running && !posterUrl} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="m-0 flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm text-ink-2">
          {render.status === 'ready' ? (
            <UserContent translate="no" className="truncate text-base font-semibold text-ink">
              {render.name}
            </UserContent>
          ) : (
            <span className="text-base font-semibold text-ink">{preset}</span>
          )}
          {render.status === 'ready' ? (
            <span>{preset}</span>
          ) : length ? (
            <span className="tabular-nums">{length}</span>
          ) : null}
        </p>

        {running ? (
          <>
            <div className="flex items-center gap-2 text-sm">
              {render.status === 'queued' || fraction === null ? (
                <LoaderCircle aria-hidden className="size-3.5 shrink-0 animate-spin text-ink-2" />
              ) : null}
              <span className="text-ink">{stage}</span>
              {percent ? (
                <span className="ms-auto font-mono text-sm text-ink tabular-nums">{percent}</span>
              ) : null}
            </div>
            <div
              role="progressbar"
              aria-label={t`Export progress`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
              aria-valuetext={percent ? `${stage}, ${percent}` : stage}
              className="h-1 overflow-hidden rounded-pill bg-hover"
            >
              <span
                className={cn(
                  'block h-full w-full origin-left rounded-pill bg-ink-2 transition-transform duration-(--dur-short) ease-(--ease-out)',
                  fraction === null && 'tc-global-loader-bar w-1/3',
                )}
                style={fraction === null ? undefined : { transform: `scaleX(${fraction})` }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {left ? (
                <span className="text-xs text-ink-2 tabular-nums">
                  {/* Intl's words in a <time>: the pseudo-locale has no Intl data, and machines read it. */}
                  <Trans>
                    About{' '}
                    <time dateTime={`PT${Math.round((eta ?? 0) / 1000)}S`} className="font-sans">
                      {left}
                    </time>{' '}
                    left
                  </Trans>
                </span>
              ) : null}
              {onNotify ? (
                <LabelledSwitch
                  checked={notifying}
                  disabled={disabled}
                  loading={busy === 'notify'}
                  onChange={(next) => {
                    setNotify(next);
                    void press('notify', async () => {
                      const result = await onNotify(next);
                      // A failed write puts the switch back where it was.
                      if (result && typeof result === 'object' && 'ok' in result && result.ok === false)
                        setNotify(!next);
                    });
                  }}
                  className="text-xs"
                >
                  {t`Notify me when it’s done`}
                </LabelledSwitch>
              ) : null}
              {onCancel ? (
                <span className="ms-auto flex items-center gap-2">
                  {finishing ? (
                    <span className="text-xs text-ink-3">{t`Almost done: it can’t be stopped now.`}</span>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled || finishing}
                    loading={busy === 'cancel'}
                    onClick={() => void press('cancel', onCancel)}
                  >
                    {t`Cancel`}
                  </Button>
                </span>
              ) : null}
            </div>
          </>
        ) : render.status === 'ready' ? (
          <>
            <p role="status" className="m-0 flex flex-wrap items-center gap-x-2 text-sm text-ink">
              <CircleCheck aria-hidden className="size-4 shrink-0 text-success-strong" />
              <span>{finishedLabel ?? t`Exported`}</span>
              <span className="text-ink-2 tabular-nums">{[length, size].filter(Boolean).join(' · ')}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {onReveal ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={disabled}
                  loading={busy === 'reveal'}
                  onClick={() => void press('reveal', onReveal)}
                >
                  <FolderOpen aria-hidden />
                  {t`Show in Finder`}
                </Button>
              ) : null}
            </div>
          </>
        ) : render.status === 'needsAttention' ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {render.qa ? <QaSummaryLine summary={render.qa} /> : null}
            {onReview ? (
              <Button size="sm" variant="secondary" disabled={disabled} onClick={onReview}>
                {t`Review`}
              </Button>
            ) : null}
          </div>
        ) : render.status === 'failed' ? (
          <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="m-0 flex min-w-0 items-start gap-2 text-sm text-danger-strong">
              <CircleX aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0">
                {render.error ? errorMessage(i18n, render.error) : t`The export didn’t finish.`}
              </span>
            </p>
            {onRetry ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={disabled}
                loading={busy === 'retry'}
                onClick={() => void press('retry', onRetry)}
              >
                <RotateCcw aria-hidden />
                {t`Try again`}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="m-0 flex items-center gap-2 text-sm text-ink-2">
              <CircleMinus aria-hidden className="size-4 shrink-0 text-ink-3" />
              {t`Stopped`}
            </p>
            {onRetry ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                loading={busy === 'retry'}
                icon={VERB_ICONS.export}
                onClick={() => void press('retry', onRetry)}
              >
                {t`Export again`}
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
