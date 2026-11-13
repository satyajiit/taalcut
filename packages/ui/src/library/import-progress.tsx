// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: import progress (card and page strip) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 (background jobs run neutral: ink-2 spinner and bar, never violet or blue)
 * states: running (spinner, bar scaled with transform) · scanning (indeterminate bar) · paused (bar holds, "Paused")
 *   · stopped (state failed with no failed files: the scan stopped; danger icon, the cause and Try again)
 *   · ended with failures (UX1: "Clips from … are in", a warning icon; no bar or count; the failed-files line says
 *   what they are, why and what to do: See which, Try again, Leave them out) · some files failed while running (the
 *   same line under the meta) · waiting (UX1: work left, none running: an hourglass, the bar holds, "The rest waits
 *   for a model to finish downloading" with See models, or for the originals) · success ("312 clips ready")
 *   · folded (Run in background: one line, view only) · loading (the card's first frame renders from its snapshot,
 *   so there is none); buttons are Buttons and the line's links ship eight states (import-failed-files.tsx)
 *   · searchable (IX-R3, two finish lines): "5 of 12 searchable" leads the meta line; the bar shows it as a
 *   rule-strong layer under the ink-2 done layer, as a player shows buffered under played; once every clip is
 *   searchable the title says so and the line reads "Analysing details" until the import is done. A status from
 *   before the count (no `searchable`) renders as it always did
 * motion: the bar's transforms (220 ms, ease-out); new thumbnails and the failed list arrive (8 px rise, 220 ms);
 *   reduced motion: fades
 * contrast: rule-strong ≥ 3:1 on every surface (a shape), ink-2 text ≥ 7:1, warning-strong ≥ 4.5:1
 * pre-emit critique (UX1): P5 H5 E4 S5 R5 V4
 */
import { Plural, useLingui } from '@lingui/react/macro';
import type { AssetKind, ImportStatus, PublicError } from '@taalcut/core';
import { useState, type ReactNode } from 'react';
import { Arrival } from '../chat/arrival';
import { Button } from '#components/button';
import { VERB_ICONS } from '../icons/concepts';
import { cn } from '#lib/cn';
import { useFormatters } from '#lib/format';
import {
  currentStage,
  everySearchable,
  importFraction,
  importStageLabel,
  searchableFraction,
} from '../cards/import-labels';
import { FailedFiles, type ImportAction } from './import-failed-files';
import { ImportMark, ImportTitle, isRunning, StoppedCause, WaitingLine } from './import-status-words';
import { endedWithFailures, importFailures, modelWaits, waitsOnly } from './import-outcome';

export interface ImportProgressViewProps {
  status: ImportStatus;
  /** The source's name as the user wrote it; wrap it in UserContent. */
  source: ReactNode;
  /** The newest few thumbnails, as URLs (the card shows them; the strip doesn't). */
  thumbnails?: readonly (string | null)[];
  variant?: 'card' | 'strip';
  onPause?: () => unknown;
  onResume?: () => unknown;
  onRetry?: () => unknown;
  onSeeFailed?: () => unknown;
  /** What the failed files are, when the caller looked: the line says "2 videos" instead of "2 files". */
  failedKinds?: Readonly<Partial<Record<AssetKind, number>>>;
  /** See which is open (the library shows only the failed files): it reads "Show all clips" and calls this. */
  failedOpen?: boolean;
  onHideFailed?: () => unknown;
  /** Each failed file and why (ImportFailedList), shown under the line while See which is open. */
  failedList?: ReactNode;
  failedListId?: string;
  /** Leave the files that couldn't be read out of the library (to the trash, undoable). */
  onLeaveOut?: () => unknown;
  /** What the rest waits for when nothing runs: a model to download (default), or originals to come back. */
  waitingFor?: 'model' | 'originals';
  /** Where models download (Settings › Models), offered while the rest waits for one. */
  onOpenModels?: () => unknown;
  /** Why a stopped import stopped (its source's scan error), said under the title. */
  stoppedBecause?: PublicError | null;
  /** An action is in flight: its button shows it, the others wait. */
  pending?: ImportAction | null;
  /**
   * Only what the Library's import line doesn't say itself (UX4): the failed files and their actions, what the rest
   * waits for, why it stopped. The line above carries the title, the bar and the counts.
   */
  extrasOnly?: boolean;
  className?: string;
}

type State = ImportStatus['state'];

export function ImportProgressView(props: ImportProgressViewProps) {
  const {
    status,
    source,
    thumbnails = [],
    variant = 'card',
    pending = null,
    extrasOnly = false,
    className,
  } = props;
  const { t } = useLingui();
  const [folded, setFolded] = useState(false);
  const { state } = status;
  const waiting = waitsOnly(status);
  const ended = endedWithFailures(status);
  // Nothing runs while every clip waits for a model or its original: no spinner, no Pause.
  const running = isRunning(state) && !waiting;
  // The two finish lines while work goes on (or is paused); a finished or stopped import reads as it always did.
  const lines = searchableFraction(status) !== null && (isRunning(state) || state === 'paused');

  return (
    <section
      data-slot="import-progress"
      data-state={state}
      data-outcome={ended ? 'ended-with-failures' : waiting ? 'waiting' : undefined}
      data-variant={variant}
      aria-label={t`Import progress`}
      className={cn('flex flex-col gap-2', className)}
    >
      {extrasOnly ? null : (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <ImportMark state={state} waiting={waiting} ended={ended} anyIn={status.counts.done > 0} />
          <p className="m-0 min-w-0 flex-1 text-sm font-medium text-ink">
            <ImportTitle status={status} source={source} lines={lines} waiting={waiting} ended={ended} />
          </p>
          <div className="flex shrink-0 items-center gap-1">
            <ImportActions
              state={running || state === 'paused' || (state === 'failed' && !ended) ? state : null}
              pending={pending}
              onPause={props.onPause}
              onResume={props.onResume}
              onRetry={props.onRetry}
            />
            {variant === 'card' && running ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFolded((value) => !value)}
                aria-expanded={!folded}
              >
                {folded ? t`Show progress` : t`Run in background`}
              </Button>
            ) : null}
          </div>
        </div>
      )}
      {folded ? null : (
        <>
          {ended || extrasOnly ? null : <ImportBar status={status} lines={lines} />}
          {extrasOnly ? null : ended ? (
            status.counts.done > 0 ? (
              <p className="m-0 text-xs text-ink-2 tabular-nums">
                <Plural
                  value={status.counts.done}
                  one="# clip in your library"
                  other="# clips in your library"
                />
              </p>
            ) : null
          ) : (
            <ImportMeta status={status} lines={lines} running={running} />
          )}
          {waiting ? (
            <WaitingLine
              waitingFor={props.waitingFor}
              models={modelWaits(status)}
              onOpenModels={props.onOpenModels}
            />
          ) : null}
          {state === 'failed' && !ended ? <StoppedCause error={props.stoppedBecause ?? null} /> : null}
          {status.counts.failed > 0 ? (
            <FailedFiles
              failures={importFailures(status)}
              pending={pending}
              {...(props.failedKinds ? { kinds: props.failedKinds } : {})}
              {...(props.failedOpen ? { open: true } : {})}
              {...(props.failedListId ? { listId: props.failedListId } : {})}
              {...(props.onSeeFailed ? { onSeeFailed: props.onSeeFailed } : {})}
              {...(props.onHideFailed ? { onHideFailed: props.onHideFailed } : {})}
              {...(props.onRetry && (ended || state !== 'failed') ? { onRetry: props.onRetry } : {})}
              {...(props.onLeaveOut ? { onLeaveOut: props.onLeaveOut } : {})}
            />
          ) : null}
          {status.counts.failed > 0 && props.failedOpen ? props.failedList : null}
          {variant === 'card' && thumbnails.length > 0 ? <NewestThumbnails urls={thumbnails} /> : null}
        </>
      )}
    </section>
  );
}

type ActionProps = Pick<ImportProgressViewProps, 'onPause' | 'onResume' | 'onRetry'> & {
  /** The state whose header action shows, or null for none (waiting, ended with failures, done). */
  state: State | null;
  pending: ImportProgressViewProps['pending'];
};

function ImportActions({ state, pending, onPause, onResume, onRetry }: ActionProps) {
  const { t } = useLingui();
  if (state !== null && isRunning(state) && onPause)
    return (
      <Button
        variant="ghost"
        size="sm"
        icon={VERB_ICONS.pause}
        loading={pending === 'pause'}
        disabled={pending !== null && pending !== 'pause'}
        onClick={() => void onPause()}
      >
        {t`Pause`}
      </Button>
    );
  if (state === 'paused' && onResume)
    return (
      <Button
        variant="secondary"
        size="sm"
        icon={VERB_ICONS.play}
        loading={pending === 'resume'}
        onClick={() => void onResume()}
      >
        {t`Resume`}
      </Button>
    );
  if (state === 'failed' && onRetry)
    return (
      <Button
        variant="secondary"
        size="sm"
        icon={VERB_ICONS.retry}
        loading={pending === 'retry'}
        onClick={() => void onRetry()}
      >
        {t`Try again`}
      </Button>
    );
  return null;
}

/** The counts as the meta line and the bar's value text say them. */
function useCounts(status: ImportStatus) {
  const format = useFormatters();
  const { counts } = status;
  return {
    doneCount: format.count(counts.done),
    allCount: format.count(counts.assets),
    searchableCount: format.count(Math.max(counts.searchable ?? 0, counts.done)),
  };
}

const BAR = 'origin-left rounded-pill transition-transform duration-(--dur-short) ease-(--ease-out)';

/**
 * The import's bar: the clips fully analysed in ink-2 over the ones search can find in rule-strong, as a player
 * shows played over buffered. `className` sizes it (the Library's line gives it a fixed width).
 */
export function ImportBar({
  status,
  lines,
  className,
}: {
  status: ImportStatus;
  lines: boolean;
  className?: string;
}) {
  const { t } = useLingui();
  const { doneCount, allCount, searchableCount } = useCounts(status);
  const { state, counts } = status;
  const scanning = state === 'scanning';
  const reach = searchableFraction(status);
  return (
    <div
      role="progressbar"
      aria-label={t`Clips brought in`}
      aria-valuemin={0}
      aria-valuemax={counts.assets}
      aria-valuenow={counts.done}
      aria-valuetext={
        lines ? t`${doneCount} of ${allCount}, ${searchableCount} searchable` : t`${doneCount} of ${allCount}`
      }
      className={cn('relative h-1 overflow-hidden rounded-pill bg-hover', className)}
    >
      {lines && reach !== null && !scanning ? (
        <span
          data-slot="import-searchable-bar"
          className={cn('absolute inset-0 bg-rule-strong', BAR)}
          style={{ transform: `scaleX(${reach})` }}
        />
      ) : null}
      <span
        className={cn('relative block h-full w-full bg-ink-2', BAR, scanning && 'tc-global-loader-bar w-1/3')}
        style={
          scanning ? undefined : { transform: `scaleX(${state === 'done' ? 1 : importFraction(status)})` }
        }
      />
    </div>
  );
}

function ImportMeta({ status, lines, running }: { status: ImportStatus; lines: boolean; running: boolean }) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const { doneCount, allCount, searchableCount } = useCounts(status);
  const stage = currentStage(status);
  const left = running && status.etaMs !== null ? format.duration(status.etaMs) : null;
  return (
    <p className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2 tabular-nums">
      {!lines ? (
        <span>{t`${doneCount} of ${allCount}`}</span>
      ) : everySearchable(status) ? (
        <span data-slot="import-milestone">{t`Analysing details`}</span>
      ) : (
        <>
          <span data-slot="import-milestone">{t`${searchableCount} of ${allCount} searchable`}</span>
          <span>{t`${doneCount} fully analysed`}</span>
        </>
      )}
      {stage && running ? <span>{importStageLabel(i18n, stage)}</span> : null}
      {left !== null ? <span>{t`About ${left} left`}</span> : null}
    </p>
  );
}

function NewestThumbnails({ urls }: { urls: readonly (string | null)[] }) {
  const { t } = useLingui();
  return (
    <ul aria-label={t`Newest clips`} className="m-0 flex list-none gap-1.5 p-0">
      {urls.slice(-8).map((url, index) => (
        <li key={url ?? index}>
          <Arrival animate className="aspect-[9/16] w-8 overflow-hidden rounded-sm bg-viewer">
            {url ? <img src={url} alt="" className="size-full object-cover" /> : null}
          </Arrival>
        </li>
      ))}
    </ul>
  );
}
