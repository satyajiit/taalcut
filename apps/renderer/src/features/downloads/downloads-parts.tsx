// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the download's rows, bones and problems · genre: atmospheric studio app
 * system: DESIGN.md v0.5 (UX2) · shared by Settings › Models, first run and the window bar's downloads (UX2-DOWNLOADER):
 *   the job rows (job-row.tsx) as one hairline list, linking their parts' licences on Settings › Models only; their bones in the same shape (a summary line, its bar, rows);
 *   and what stopped the whole download, each an ErrorLine with its one fix: a disk too full (Open Storage
 *   Settings), a command that failed, the state that couldn't be read (Try again; it keeps trying by itself).
 * states: loading (bones) · rows (their own states) · problem (ErrorLine: Button's eight states on its fix)
 * pre-emit critique: P4 H4 E4 S4 R5 V4 · slop subset: pass (1-7, 10-19, 22-27, 37-38a, 40-41 via axe, 46-49)
 */
import { useLingui } from '@lingui/react/macro';
import type { Component, Downloads, TaalcutError } from '@taalcut/core';
import { cn, useHostPlatform } from '@taalcut/ui';
import { formatBytes } from '../shared/format';
import { DownloadErrorLine } from './download-error-line';
import { jobGroups } from './job-groups';
import { JobRow } from './job-row';
import type { DownloadActions } from './use-download-actions';

export function JobList({
  components,
  online,
  actions,
  label,
  rowRetry = true,
  target,
  licences = false,
  className,
}: {
  components: readonly Component[];
  online: boolean;
  actions: DownloadActions;
  label: string;
  /**
   * A failed row offers Try again (its parts first). Off where the download stopped and its controls offer Try
   * again for the whole: one fix, not one per row.
   */
  rowRetry?: boolean;
  /** The job whose row main's "couldn't download" notification opened Settings › Models on. */
  target?: string | undefined;
  /** Each row links the licence notices of its parts that are here (Settings › Models only, round 3). */
  licences?: boolean;
  className?: string;
}) {
  return (
    <ul
      aria-label={label}
      data-slot="download-jobs"
      className={cn('m-0 flex list-none flex-col p-0', className)}
    >
      {jobGroups(components).map((group) => (
        <JobRow
          key={group.key}
          group={group}
          online={online}
          onRetry={rowRetry ? actions.start : undefined}
          onFix={actions.fix}
          targeted={group.key === target}
          licences={licences}
        />
      ))}
    </ul>
  );
}

/** The summary and rows' shape while the download's state is on its way. */
export function DownloadsBones({ rows = 6, className }: { rows?: number; className?: string }) {
  const { t } = useLingui();
  const mac = useHostPlatform() === 'mac';
  const widths = ['22%', '30%', '26%', '18%', '34%', '24%', '28%', '20%'].slice(0, rows);
  return (
    <div aria-busy="true" data-slot="downloads-bones" className={cn('flex flex-col gap-3', className)}>
      <span className="sr-only" role="status">
        {mac ? t`Finding what this Mac needs…` : t`Finding what this computer needs…`}
      </span>
      <span aria-hidden className="flex flex-col gap-2">
        <span className="tc-bone block h-4 w-56 max-w-full rounded-sm bg-hover" />
        <span className="tc-bone block h-1 w-full rounded-pill bg-hover" />
      </span>
      <span aria-hidden className="flex flex-col">
        {widths.map((width) => (
          <span
            key={width}
            className="flex items-center justify-between gap-4 border-t border-rule-subtle py-3 first:border-t-0"
          >
            <span className="tc-bone block h-4 rounded-sm bg-hover" style={{ width }} />
            <span className="tc-bone block h-4 w-16 rounded-sm bg-hover" />
          </span>
        ))}
      </span>
    </div>
  );
}

/** Under a disk-space error: how much the models need against what the disk has, in Finder's units. */
function SpaceNeeded({ error }: { error: TaalcutError }) {
  const { t, i18n } = useLingui();
  const mac = useHostPlatform() === 'mac';
  const required = error.params?.['requiredBytes'];
  const available = error.params?.['availableBytes'];
  if (
    error.code !== 'jobs.downloads_space_low' ||
    typeof required !== 'number' ||
    typeof available !== 'number'
  )
    return null;
  const need = formatBytes(i18n, required);
  const have = formatBytes(i18n, available);
  return (
    <p className="m-0 ps-6 text-sm text-ink-2">
      {mac
        ? t`They need ${need} free. This Mac has ${have}.`
        : t`They need ${need} free. This computer has ${have}.`}
    </p>
  );
}

/**
 * What stopped the whole download, once each: its own reason (a disk too full, a list this build can't trust), a
 * command that failed for another reason, and a read that failed (the shown state is from before).
 */
export function DownloadsProblems({
  downloads,
  readError,
  actions,
  onReadAgain,
}: {
  downloads: Downloads | null;
  readError: TaalcutError | null;
  actions: DownloadActions;
  onReadAgain: () => void;
}) {
  const own = downloads?.error ?? null;
  const command = actions.error && actions.error.code !== own?.code ? actions.error : null;
  if (!own && !command && !readError) return null;
  return (
    <div data-slot="downloads-problems" className="flex flex-col gap-2">
      {own ? (
        <DownloadErrorLine key={own.code} error={own} onFix={actions.fix} onRetry={actions.resume} />
      ) : null}
      {own ? <SpaceNeeded error={own} /> : null}
      {command ? <DownloadErrorLine key={command.code} error={command} onRetry={actions.resume} /> : null}
      {readError ? <DownloadErrorLine key={readError.code} error={readError} onRetry={onReadAgain} /> : null}
    </div>
  );
}
