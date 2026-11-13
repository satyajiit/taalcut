// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: getting ready · genre: atmospheric studio app · system: DESIGN.md v0.6 + UX4
 * first run's download in the steps' sidebar (UX2-DOWNLOADER): one quiet line, "Getting ready · 42%", then what has
 *   arrived of what it fetches in the mono face, over a 2 px ink-3 bar (background work runs neutral). Paused says
 *   so; when it stopped with parts missing, one line says how many with See why, which opens First video, where a
 *   stopped download is the step's Kaatu moment with its reasons and Try again (UX4 onb: first run has no hardware
 *   step now). Gone when everything is here. Only first run shows it; after it, Settings › Models › Downloads does.
 * states: downloading (the line, the bytes, the bar) · offline (Waiting for the internet) · paused (Paused, the
 *   bar held) · stopped with failures (the line and its link: the link carries focus-visible and hover) · ready,
 *   not started or not read yet (nothing shown)
 * pre-emit critique: P4 H5 E4 S4 R5 V4 · slop subset: pass (1-7, 10-19, 22-27, 37-38a, 40-41, 46-49)
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { cn } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { formatBytes } from '../shared/format';
import { useOnline } from '../shared/use-online';
import { fractionOf, formatProgress } from './download-format';
import { useDownloads } from './downloads-store';
import { JobBar } from './job-bar';

export function GettingReady({ className }: { className?: string }) {
  const { t, i18n } = useLingui();
  const online = useOnline();
  const { downloads } = useDownloads();
  if (!downloads) return null;
  const failed = downloads.counts.failed;
  if (downloads.state === 'failed')
    return (
      <p
        data-slot="getting-ready-failed"
        className={cn('m-0 flex flex-col gap-1 type-meta text-ink-2', className)}
      >
        <span>
          {failed > 0 ? (
            <Plural value={failed} one="# part didn’t download." other="# parts didn’t download." />
          ) : (
            <Trans>The models didn’t download.</Trans>
          )}
        </span>
        <Link
          to="/onboarding/$step"
          params={{ step: 'first-video' }}
          className="type-label-sm text-ink underline underline-offset-4"
        >
          <Trans>See why</Trans>
        </Link>
      </p>
    );
  if (downloads.state !== 'downloading' && downloads.state !== 'paused') return null;
  const fraction = fractionOf(downloads.bytesDone, downloads.bytesTotal);
  const percent = formatProgress(i18n, fraction);
  const done = formatBytes(i18n, downloads.bytesDone);
  const total = formatBytes(i18n, downloads.bytesTotal);
  const line =
    downloads.state === 'paused'
      ? t`Downloads paused · ${percent}`
      : online
        ? t({ id: 'onboarding.sidebar.gettingReady', message: `Getting ready · ${percent}` })
        : t({ id: 'onboarding.hardware.waitingInternet', message: 'Waiting for the internet' });
  return (
    <div
      data-slot="getting-ready"
      data-state={downloads.state}
      className={cn('flex w-full flex-col gap-1.5', className)}
    >
      <p className="m-0 flex flex-col type-meta text-ink-2 tabular-nums">
        <span>{line}</span>
        <span className="tc-mono text-ink-3">
          <Trans>
            {done} of {total}
          </Trans>
        </span>
      </p>
      <JobBar label={t`Downloading models`} fraction={fraction} thin />
    </div>
  );
}
