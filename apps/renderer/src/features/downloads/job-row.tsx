// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: a job's download row · genre: atmospheric studio app · system: DESIGN.md v0.5 (UX2)
 * one hairline row per job (UX2-DOWNLOADER): the job in ink 500 ("Speech"), its parts after it as written, small in
 *   ink-3 (translate="no"), wrapping under it when the row is narrow; the state at the right in ink-2 with figures
 *   that change in place in the mono face; background work runs neutral (DESIGN.md, Running): an ink-3 hairline bar
 *   under a row whose bytes are on their way or paused part way. A failure is the row's ErrorLine under it, in the
 *   component manager's words, with Try again (its parts go first). Round 3: once a part is here, its licence
 *   link ends the parts line on Settings › Models ("Licence", or "Licences" and a menu of them; licence-link.tsx carries its states),
 *   and a notice that didn't open says why in a second ErrorLine.
 * states: missing (the size) · queued ("Waiting", the size) · downloading (bytes of bytes, the bar) · resuming ·
 *   reconnecting ("Reconnecting in 8 s", a countdown) · verifying ("Checking") · installing · offline ("Waiting for
 *   the internet") · paused (bytes of bytes, the bar held) · failed (danger icon and words, the ErrorLine, Try again:
 *   Button's eight states) · ready (the success mark, "Ready") · needs (its parts here, a shared part another row
 *   lists not yet: "Needs ONNX Runtime") · n/a hover on the row (not a control); focus only when main's
 *   notification opens Settings › Models on it (the base focus ring until focus moves on)
 * motion: the bar's transform (--dur-short, --ease-out); reduced motion: base.css stops it moving
 * contrast: ink and ink-2 on canvas or raised ≥ 7:1; ink-3 parts ≥ 4.5:1; the bar is decoration beside its words
 * pre-emit critique: P5 H4 E4 S5 R5 V4 · slop subset: pass (1-7, 10-19, 22-27, 37-38a, 40-41 via axe, 46-49)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { FixAction, Result } from '@taalcut/core';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { formatBytes } from '../shared/format';
import { DownloadErrorLine } from './download-error-line';
import { fractionOf } from './download-format';
import type { JobGroup } from './job-groups';
import { JOB_LABELS } from './job-labels';
import { JobBar } from './job-bar';
import { LicenceLink, NoticeError, useNoticeOpener } from './licence-link';

/** Whole seconds until `at`, ticking each second while it counts down. */
function useSecondsUntil(at: number | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (at === undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [at]);
  return at === undefined ? null : Math.max(0, Math.ceil((at - now) / 1000));
}

/** What has arrived of the row's parts; before the first byte, just their size. */
function BytesOf({ group }: { group: JobGroup }) {
  const { i18n } = useLingui();
  const done = formatBytes(i18n, group.bytesDone);
  const total = formatBytes(i18n, group.bytesTotal);
  if (group.bytesDone <= 0) return <span className="font-mono text-xs">{total}</span>;
  return (
    <span className="font-mono text-xs">
      <Trans>
        {done} of {total}
      </Trans>
    </span>
  );
}

/** The row's state at its right: Ready, a failure, the step it is in, or its size. */
function JobState({ group, online }: { group: JobGroup; online: boolean }) {
  const { t, i18n } = useLingui();
  const seconds = useSecondsUntil(group.retryAt);
  // What is left to fetch: a job whose other parts are here says only the size of the ones that aren't.
  const size = formatBytes(i18n, Math.max(0, group.bytesTotal - group.bytesDone));
  // Its own parts are here; a shared one it runs on (another row's) isn't yet: the row names that part.
  if (group.needs && group.state !== 'failed') {
    const needs = group.needs;
    return (
      <span>
        <Trans>
          Needs <span translate="no">{needs}</span>
        </Trans>
      </span>
    );
  }
  switch (group.state) {
    case 'ready':
      return (
        <>
          <CircleCheck aria-hidden className="size-4 text-success-strong" />
          <Trans>Ready</Trans>
        </>
      );
    case 'failed':
      return (
        <span className="flex items-center gap-1.5 text-danger-strong">
          <CircleAlert aria-hidden className="size-4" />
          <Trans>Didn’t download</Trans>
        </span>
      );
    case 'queued':
      return group.bytesDone > 0 ? (
        <>
          <span>
            <Trans>Waiting</Trans>
          </span>
          <span aria-hidden>·</span>
          <BytesOf group={group} />
        </>
      ) : (
        <span>
          <Trans>Waiting · {size}</Trans>
        </span>
      );
    case 'paused':
      return <BytesOf group={group} />;
    case 'missing':
      return <span>{size}</span>;
    case 'downloading':
      break;
  }
  if (!online)
    return (
      <span>{t({ id: 'onboarding.hardware.waitingInternet', message: 'Waiting for the internet' })}</span>
    );
  switch (group.step) {
    case 'reconnecting':
      return <span>{seconds && seconds > 0 ? t`Reconnecting in ${seconds} s` : t`Reconnecting…`}</span>;
    case 'resuming':
      return <span>{t`Picking up where it stopped…`}</span>;
    case 'verifying':
      return <span>{t`Checking…`}</span>;
    case 'installing':
      return <span>{t`Installing…`}</span>;
    case 'downloading':
    case undefined:
      return <BytesOf group={group} />;
  }
}

export interface JobRowProps {
  group: JobGroup;
  online: boolean;
  /** Try again on a failed row: starts the download with these parts first. None where the whole offers it. */
  onRetry?: ((first: readonly string[]) => void) | undefined;
  /** An error's fix (a disk too full opens System Settings › Storage). */
  onFix: (fix: FixAction) => Promise<Result<unknown>>;
  /** The row main's "couldn't download" notification opened Settings › Models on: it takes focus. */
  targeted?: boolean;
  /** Links the licence notices of its parts that are here (Settings › Models; not first run or the popover). */
  licences?: boolean;
}

export function JobRow({ group, online, onRetry, onFix, targeted = false, licences = false }: JobRowProps) {
  const { i18n } = useLingui();
  const nameId = useId();
  const notice = useNoticeOpener();
  const name = group.job ? i18n._(JOB_LABELS[group.job]) : (group.parts[0]?.name ?? group.key);
  const parts = new Intl.ListFormat(i18n.locale, { type: 'unit', style: 'short' }).format(
    group.parts.map((part) => part.name),
  );
  const bar = group.state === 'downloading' || (group.state === 'paused' && group.bytesDone > 0);
  const error = group.error;
  return (
    <li
      data-job={group.key}
      data-state={group.state}
      // The row main's notification opened Settings › Models on: focused from script with the focus ring, never by
      // Tab; the ring goes when focus moves on.
      tabIndex={targeted ? -1 : undefined}
      className="flex flex-col gap-1.5 border-t border-rule-subtle py-2.5 first:border-t-0 focus:outline-2 focus:outline-offset-2 focus:outline-focus"
    >
      <div className="flex items-start justify-between gap-x-4 text-sm">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span id={nameId} className="shrink-0 font-medium text-ink">
            {name}
          </span>
          {group.job ? (
            <span translate="no" className="min-w-0 text-xs text-ink-3">
              {parts}
            </span>
          ) : null}
          {licences ? <LicenceLink parts={group.parts} label={name} opener={notice} /> : null}
        </span>
        {/* Centred on the name's line: Ready's mark would otherwise set the baseline and lift the word. */}
        <span
          data-slot="job-state"
          className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-ink-2 tabular-nums"
        >
          <JobState group={group} online={online} />
        </span>
      </div>
      {bar ? (
        <JobBar thin labelledBy={nameId} fraction={fractionOf(group.bytesDone, group.bytesTotal)} />
      ) : null}
      {error ? (
        <DownloadErrorLine
          key={error.code}
          error={error}
          onRetry={onRetry ? () => onRetry(group.failedIds) : undefined}
          onFix={onFix}
        />
      ) : null}
      <NoticeError opener={notice} />
    </li>
  );
}
