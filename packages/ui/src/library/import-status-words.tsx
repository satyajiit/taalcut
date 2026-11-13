// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: import status words (the import progress view's title, mark and the lines that say why
 *   it waits or stopped) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * states: see import-progress.tsx; See models is a text button (default · hover: the underline darkens
 *   · focus-visible: the base ring · active: ink-2 · it never loads, fails or is disabled: it navigates)
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { ImportStatus, PublicError } from '@taalcut/core';
import { CircleAlert, CircleCheck, Hourglass, LoaderCircle, Pause } from 'lucide-react';
import type { ReactNode } from 'react';
import { everySearchable } from '../cards/import-labels';
import { errorMessage } from '../feedback/error-messages';
import { listOf } from '#lib/format';
import type { ModelWaitKind } from './import-outcome';

type State = ImportStatus['state'];
export const isRunning = (state: State) =>
  state === 'indexing' || state === 'receiving' || state === 'scanning';

/** A text button in the import's lines. */
/** A quiet action in a status line: underlined words that never wrap; focus-visible is the base ring. */
export const LINK =
  'inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-sm text-ink underline ' +
  'decoration-rule-strong underline-offset-2 hover:decoration-ink active:text-ink-2 ' +
  'disabled:cursor-not-allowed disabled:text-ink-3 disabled:no-underline aria-busy:cursor-progress';

interface TitleProps {
  status: ImportStatus;
  source: ReactNode;
  lines: boolean;
  waiting: boolean;
  ended: boolean;
}

export function ImportTitle({ status, source, lines, waiting, ended }: TitleProps) {
  if (ended)
    return status.counts.done > 0 ? (
      <Trans>Clips from {source} are in</Trans>
    ) : (
      <Trans>None of the clips from {source} could be brought in</Trans>
    );
  if (waiting) return <Trans>Clips from {source} are in</Trans>;
  switch (status.state) {
    case 'scanning':
      return <Trans>Looking for clips in {source}</Trans>;
    case 'receiving':
      return <Trans>Receiving clips from {source}</Trans>;
    case 'paused':
      return <Trans>Paused: clips from {source}</Trans>;
    case 'failed':
      return <Trans>The import from {source} stopped</Trans>;
    case 'done':
      return <Plural value={status.counts.done} one="# clip ready" other="# clips ready" />;
    default:
      return lines && everySearchable(status) ? (
        <Trans>You can search every clip from {source}</Trans>
      ) : (
        <Trans>Bringing in clips from {source}</Trans>
      );
  }
}

/** Why a stopped import stopped, and what to do: the scan's error in words, else the likely cause. */
export function StoppedCause({ error }: { error: PublicError | null }) {
  const { t, i18n } = useLingui();
  return (
    <p data-slot="import-stopped" className="m-0 max-w-[65ch] text-xs text-ink-2">
      {error
        ? errorMessage(i18n, error)
        : t`Taalcut couldn’t finish looking through it. Check that it is still connected, then try again.`}
    </p>
  );
}

/** Each model the rest can wait for, as the clip page names them ("Waiting for the speech model"). */
const MODEL_NAMES: Readonly<Record<ModelWaitKind, MessageDescriptor>> = {
  text: msg`the on-screen text model`,
  speech: msg`the speech model`,
  search: msg`the search model`,
  describe: msg`the model that describes clips`,
  beats: msg`the beat model`,
};

/**
 * What the rest of an import waits for when nothing runs, and where to go about it: the models by name when the
 * status says which (UX3-IDX: "The rest waits for the on-screen text model to finish downloading."), else a model.
 */
export function WaitingLine({
  waitingFor = 'model',
  models = [],
  onOpenModels,
}: {
  waitingFor?: 'model' | 'originals' | undefined;
  models?: readonly ModelWaitKind[] | undefined;
  onOpenModels?: (() => unknown) | undefined;
}) {
  const { t, i18n } = useLingui();
  const named = listOf(
    i18n,
    models.map((kind) => i18n._(MODEL_NAMES[kind])),
  );
  return (
    <p
      data-slot="import-waiting"
      className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2"
    >
      <span>
        {waitingFor === 'originals'
          ? t`The rest waits for the originals: reconnect the drive or download them from iCloud.`
          : models.length > 0
            ? t`The rest waits for ${named} to finish downloading.`
            : t`The rest waits for a model to finish downloading.`}
      </span>
      {waitingFor === 'model' && onOpenModels ? (
        <button type="button" onClick={() => void onOpenModels()} className={LINK}>
          {t`See models`}
        </button>
      ) : null}
    </p>
  );
}

interface MarkProps {
  state: State;
  waiting: boolean;
  ended: boolean;
  /** Some of the import's clips came in. */
  anyIn: boolean;
}

export function ImportMark({ state, waiting, ended, anyIn }: MarkProps) {
  // Ended with failures: the clips that came in are done (the failed line carries the warning); none came in: a warning.
  if (ended)
    return anyIn ? (
      <CircleCheck aria-hidden className="size-4 shrink-0 text-success-strong" />
    ) : (
      <CircleAlert aria-hidden className="size-4 shrink-0 text-warning-strong" />
    );
  if (waiting) return <Hourglass aria-hidden className="size-4 shrink-0 text-ink-2" />;
  if (isRunning(state))
    return <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin text-ink-2" />;
  if (state === 'paused') return <Pause aria-hidden className="size-4 shrink-0 text-ink-2" />;
  if (state === 'failed') return <CircleAlert aria-hidden className="size-4 shrink-0 text-danger-strong" />;
  return <CircleCheck aria-hidden className="size-4 shrink-0 text-success-strong" />;
}
