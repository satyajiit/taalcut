// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: import failed files (the line under an import) · genre: atmospheric studio app
 *   (chrome modern-minimal) · system: DESIGN.md v0.3 (a status is an icon and a plain sentence that says what to do)
 * states: files that couldn't be read (warning icon, what they are by kind, why, what to do: See which, Try again,
 *   Leave them out) · clips whose analysis didn't finish (the same, without Leave them out: they play as usual)
 *   · both · open (See which reads "Show all clips") · each action: default · hover (the underline darkens)
 *   · focus-visible (the base ring) · active (ink-2) · disabled (ink-3, while another action runs) · loading (a
 *   spinner before the words, aria-busy) · error (the caller's ErrorLine under the import) · success (silent: the
 *   line goes once nothing has failed)
 * contrast: warning-strong and ink-2 text ≥ 4.5:1 on sunken and raised; rule-strong underline ≥ 3:1 (a shape)
 */
import { Plural, useLingui } from '@lingui/react/macro';
import type { AssetKind } from '@taalcut/core';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '#lib/cn';
import { onlyKind, type ImportFailures } from './import-outcome';
import { LINK } from './import-status-words';

export type ImportAction = 'pause' | 'resume' | 'retry' | 'leave';

export interface FailedFilesProps {
  readonly failures: ImportFailures;
  /** What the failed files are, when the caller looked: the line names them by kind. */
  readonly kinds?: Readonly<Partial<Record<AssetKind, number>>>;
  readonly pending: ImportAction | null;
  /** The list of failed files is open (the library shows only them): See which reads "Show all clips". */
  readonly open?: boolean;
  /** The id of the list See which opens, when the caller shows one. */
  readonly listId?: string;
  readonly onSeeFailed?: () => unknown;
  readonly onHideFailed?: () => unknown;
  readonly onRetry?: () => unknown;
  readonly onLeaveOut?: () => unknown;
}

export function FailedFiles(props: FailedFilesProps) {
  const { t } = useLingui();
  const { failures, kinds, pending, open = false } = props;
  const { unreadable, unanalysed } = failures;
  const toggle = open ? props.onHideFailed : props.onSeeFailed;
  return (
    <div data-slot="import-failed" className="flex flex-col gap-1 text-xs text-ink-2">
      {unreadable > 0 ? (
        <Warning>
          <strong className="font-medium text-warning-strong">
            <UnreadableCount count={unreadable} kind={onlyKind(kinds)} />
          </strong>{' '}
          {t`They may be damaged or in a format Taalcut doesn’t read yet. The originals are untouched.`}
        </Warning>
      ) : null}
      {unanalysed > 0 ? (
        <Warning>
          <strong className="font-medium text-warning-strong">
            <Plural
              value={unanalysed}
              one="Taalcut couldn’t finish analysing # clip."
              other="Taalcut couldn’t finish analysing # clips."
            />
          </strong>{' '}
          {t`They play as usual, but search may miss them.`}
        </Warning>
      ) : null}
      <p className={cn('m-0 flex flex-wrap items-center gap-x-3 gap-y-1', HANG)}>
        {toggle ? (
          <ImportLink
            onClick={toggle}
            disabled={pending !== null}
            aria-expanded={props.listId ? open : undefined}
            aria-controls={props.listId && open ? props.listId : undefined}
          >
            {open ? t`Show all clips` : t`See which`}
          </ImportLink>
        ) : null}
        {props.onRetry ? (
          <ImportLink onClick={props.onRetry} loading={pending === 'retry'} disabled={pending !== null}>
            {t`Try again`}
          </ImportLink>
        ) : null}
        {props.onLeaveOut && unreadable > 0 ? (
          <ImportLink onClick={props.onLeaveOut} loading={pending === 'leave'} disabled={pending !== null}>
            {t`Leave them out`}
          </ImportLink>
        ) : null}
      </p>
    </div>
  );
}

/** The space the warning icon and its gap take: what follows the line hangs under its words. */
export const HANG = 'pl-4.5';

/** A warning sentence with its icon, the words wrapping under themselves (a hanging indent). */
function Warning({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 flex items-start gap-1 text-xs text-ink-2">
      <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0 text-warning-strong" />
      <span className="min-w-0 max-w-[72ch]">{children}</span>
    </p>
  );
}

/** "2 videos couldn't be read": by kind when every failed file is one kind, else files. */
function UnreadableCount({ count, kind }: { count: number; kind: AssetKind | null }) {
  switch (kind) {
    case 'video':
      return <Plural value={count} one="# video couldn’t be read." other="# videos couldn’t be read." />;
    case 'image':
    case 'live_photo':
      return <Plural value={count} one="# photo couldn’t be read." other="# photos couldn’t be read." />;
    case 'audio':
      return (
        <Plural value={count} one="# sound file couldn’t be read." other="# sound files couldn’t be read." />
      );
    default:
      return <Plural value={count} one="# file couldn’t be read." other="# files couldn’t be read." />;
  }
}

function ImportLink({
  children,
  onClick,
  loading = false,
  disabled = false,
  ...aria
}: {
  children: ReactNode;
  onClick: () => unknown;
  loading?: boolean;
  disabled?: boolean;
  'aria-expanded'?: boolean | undefined;
  'aria-controls'?: string | undefined;
}) {
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={LINK}
      {...aria}
    >
      {loading ? <LoaderCircle aria-hidden className="size-3 shrink-0 animate-spin text-ink-2" /> : null}
      {children}
    </button>
  );
}
