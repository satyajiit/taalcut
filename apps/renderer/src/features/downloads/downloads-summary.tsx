// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the download's summary · genre: atmospheric studio app · system: DESIGN.md v0.5 (UX2)
 * the whole download in one line over one bar (UX2-DOWNLOADER): what has arrived of what it fetches, the speed and
 *   the time left, the figures that change in place in the mono face, the percent at the right; the bar is the
 *   neutral ink-3 background-work bar (DESIGN.md, Running), never an accent. Each state says itself in words; the
 *   changes of state (not the bytes) are announced once to screen readers.
 * states: missing (what it fetches and the free space) · downloading (bytes, speed, time left, the bar) · offline
 *   (Waiting for the internet) · paused (Paused, the bar held) · failed (how many parts didn't download, the bar
 *   where it stopped) · ready (everything here, the success mark) · n/a hover/focus (not a control)
 * motion: the bar's transform (--dur-short, --ease-out); reduced motion: base.css stops it moving
 * contrast: ink on canvas or raised ≥ 7:1, ink-2 figures ≥ 7:1
 * pre-emit critique: P5 H5 E4 S5 R5 V4 · slop subset: pass (1-7, 10-19, 22-27, 37-38a, 40-41 via axe, 46-49)
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { Downloads } from '@taalcut/core';
import { cn, useHostPlatform } from '@taalcut/ui';
import { CircleCheck } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { formatBytes } from '../shared/format';
import { fractionOf, formatProgress, formatSpeed } from './download-format';
import { JobBar } from './job-bar';
import { formatTimeLeft } from './time-left';

/** What a state change says to a screen reader, once (the bytes moving are the bar's, not announced). */
function StateWords({ downloads }: { downloads: Downloads }) {
  const { t } = useLingui();
  const mac = useHostPlatform() === 'mac';
  const words: Record<Downloads['state'], string> = {
    ready: mac
      ? t`Everything this Mac needs is downloaded.`
      : t`Everything this computer needs is downloaded.`,
    downloading: mac ? t`Downloading what this Mac needs.` : t`Downloading what this computer needs.`,
    paused: t`Downloads paused.`,
    failed: t`Some parts didn’t download.`,
    missing: t`Not downloaded yet.`,
  };
  return (
    <span role="status" className="sr-only">
      {words[downloads.state]}
    </span>
  );
}

/** The parts of a line, a quiet dot between each. */
function Dotted({ parts }: { parts: readonly ReactNode[] }) {
  return parts.map((part, index) => (
    <Fragment key={index}>
      {index > 0 ? (
        <span aria-hidden className="text-ink-3">
          ·
        </span>
      ) : null}
      {part}
    </Fragment>
  ));
}

function Pace({ downloads, online }: { downloads: Downloads; online: boolean }) {
  const { t, i18n } = useLingui();
  const done = formatBytes(i18n, downloads.bytesDone);
  const total = formatBytes(i18n, downloads.bytesTotal);
  // Before the first byte, just the size (as a row says it): never "0 byte of 4.5 GB".
  const bytes = (
    <span className="font-mono text-xs text-ink-2">
      {downloads.bytesDone > 0 ? (
        <Trans>
          {done} of {total}
        </Trans>
      ) : (
        total
      )}
    </span>
  );
  const failed = downloads.counts.failed;
  if (downloads.state === 'paused')
    return <Dotted parts={[<span className="font-medium text-ink">{t`Paused`}</span>, bytes]} />;
  if (downloads.state === 'failed')
    return (
      <Dotted
        parts={[
          <span className="font-medium text-ink">
            <Plural value={failed} one="# part didn’t download" other="# parts didn’t download" />
          </span>,
          bytes,
        ]}
      />
    );
  if (!online)
    return (
      <Dotted
        parts={[
          <span className="font-medium text-ink">
            {t({ id: 'onboarding.hardware.waitingInternet', message: 'Waiting for the internet' })}
          </span>,
          bytes,
        ]}
      />
    );
  const speed = downloads.bytesPerSecond > 0 ? formatSpeed(i18n, downloads.bytesPerSecond) : null;
  const left = downloads.etaMs === undefined ? null : formatTimeLeft(i18n, downloads.etaMs);
  return (
    <Dotted
      parts={[
        bytes,
        ...(speed ? [<span className="font-mono text-xs text-ink-2">{speed}</span>] : []),
        ...(left
          ? [
              <span className="text-ink-2">
                <Trans>About {left} left</Trans>
              </span>,
            ]
          : []),
      ]}
    />
  );
}

/**
 * The whole download without a bar, for a view that lists only some of its parts (a clip's models): one row there
 * moves at its share of the speed, and this says what the download as a whole is doing. Its name on one line, the
 * figures under it: a narrow column (the clip's inspector) wraps them without leaving a dot at a line's end.
 */
export function DownloadsLine({
  downloads,
  online,
  className,
}: {
  downloads: Downloads;
  online: boolean;
  className?: string;
}) {
  const { t } = useLingui();
  const mac = useHostPlatform() === 'mac';
  return (
    <div
      data-slot="downloads-line"
      data-state={downloads.state}
      className={cn('flex min-w-0 flex-col gap-0.5 text-sm', className)}
    >
      <p className="m-0 text-ink-2">
        {mac ? t`Everything this Mac needs` : t`Everything this computer needs`}
      </p>
      <p className="m-0 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <Pace downloads={downloads} online={online} />
      </p>
    </div>
  );
}

/** The download in one line over one bar; `online` is the window's own (useOnline). */
export function DownloadsSummary({
  downloads,
  online,
  className,
}: {
  downloads: Downloads;
  online: boolean;
  className?: string;
}) {
  const { t, i18n } = useLingui();
  const mac = useHostPlatform() === 'mac';
  // Nothing to list: what this Mac needs couldn't be told (the problem line says why).
  if (downloads.components.length === 0) return null;
  const all = downloads.components.reduce((sum, part) => sum + part.sizeBytes, 0);
  const fraction = fractionOf(downloads.bytesDone, downloads.bytesTotal);
  if (downloads.state === 'ready') {
    const size = formatBytes(i18n, all);
    return (
      <p
        data-slot="downloads-summary"
        data-state="ready"
        className={cn('m-0 flex items-center gap-2 text-sm text-ink', className)}
      >
        <CircleCheck aria-hidden className="size-4 shrink-0 text-success-strong" />
        <span>
          {mac ? (
            <Trans>Everything this Mac needs is here · {size}</Trans>
          ) : (
            <Trans>Everything this computer needs is here · {size}</Trans>
          )}
        </span>
        <StateWords downloads={downloads} />
      </p>
    );
  }
  // Nothing on its way yet: never started, cancelled, or refused before a byte arrived (a disk too full).
  const unstarted =
    downloads.state === 'missing' ||
    (downloads.state === 'failed' && downloads.counts.failed === 0 && downloads.bytesDone === 0);
  if (unstarted) {
    const left = formatBytes(i18n, Math.max(0, downloads.bytesTotal - downloads.bytesDone));
    const free = downloads.freeBytes === undefined ? null : formatBytes(i18n, downloads.freeBytes);
    return (
      <p
        data-slot="downloads-summary"
        data-state={downloads.state}
        className={cn('m-0 text-sm text-ink', className)}
      >
        {free
          ? mac
            ? t`${left} to download. This Mac has ${free} free.`
            : t`${left} to download. This computer has ${free} free.`
          : t`${left} to download.`}
        <StateWords downloads={downloads} />
      </p>
    );
  }
  return (
    <div
      data-slot="downloads-summary"
      data-state={downloads.state}
      className={cn('flex flex-col gap-2', className)}
    >
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <p className="m-0 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Pace downloads={downloads} online={online} />
        </p>
        <span aria-hidden className="shrink-0 font-mono text-xs text-ink-2">
          {formatProgress(i18n, fraction)}
        </span>
      </div>
      <JobBar
        label={mac ? t`Everything this Mac needs` : t`Everything this computer needs`}
        fraction={fraction}
      />
      <StateWords downloads={downloads} />
    </div>
  );
}
