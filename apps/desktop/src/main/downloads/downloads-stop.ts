// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX2-DOWNLOADER: when the download of everything this Mac needs stops with something the person has to deal with,
 * and what its notification says. A stop is the set going from `downloading` to `failed` (components failed after
 * their retries, a disk that filled up), or a refusal to start or go on that appears while the app runs (a disk too
 * full, a manifest this build can't trust). Retries, reconnects and a component failing while the others carry on
 * are not stops: the set is still `downloading`. A state found at launch is not one either.
 */
import type { I18n } from '@lingui/core';
import { COMPONENT_JOBS, type ComponentJob, type Downloads, type PublicError } from '@taalcut/core';
import {
  DOWNLOAD_JOB_NAMES,
  DOWNLOADS_STOP_REASONS,
  DOWNLOADS_STOPPED_MESSAGES,
  type DownloadsStopReason,
} from '../i18n/downloads-messages';

/** A job left without its models: one of the jobs, or a component with none (named as written). */
export type StoppedJob = { readonly job: ComponentJob } | { readonly name: string };

export interface DownloadsStop {
  /** The download ended its run here; otherwise it refused to start or go on (the window may be the one asking). */
  readonly ran: boolean;
  /** What is left without its models, in the jobs' order; empty when the whole download couldn't go on. */
  readonly jobs: readonly StoppedJob[];
  readonly reason: DownloadsStopReason;
  /** The row a click opens: the first job named. */
  readonly job?: ComponentJob;
}

const REASONS: Readonly<Record<string, DownloadsStopReason>> = {
  'jobs.disk_space_low': 'space',
  'jobs.downloads_space_low': 'space',
  'jobs.download_failed': 'network',
  'jobs.download_rejected': 'refused',
  'jobs.checksum_mismatch': 'different',
  'jobs.size_mismatch': 'different',
  'jobs.extract_failed': 'install',
  'jobs.install_failed': 'install',
  'jobs.manifest_untrusted': 'manifest',
  'jobs.manifest_invalid': 'manifest',
  'jobs.component_unknown': 'manifest',
};

/** The kind of failure behind a component manager's code; one it doesn't sort points at Settings › Models. */
export function reasonOf(error: PublicError | undefined): DownloadsStopReason {
  return (error && REASONS[error.code]) ?? 'other';
}

/** The stop `next` is after `previous`, if it is one. */
export function stopOf(previous: Downloads | undefined, next: Downloads): DownloadsStop | undefined {
  if (!previous || next.state !== 'failed') return undefined;
  const ran = previous.state === 'downloading';
  const refused =
    next.error !== undefined && (previous.state !== 'failed' || previous.error?.code !== next.error.code);
  if (!ran && !refused) return undefined;
  if (next.error) return { ran, jobs: [], reason: reasonOf(next.error) };
  const failed = next.components.filter((component) => component.status === 'failed');
  const byJob = (job: ComponentJob) => failed.filter((component) => component.job === job);
  const jobs: StoppedJob[] = [
    ...COMPONENT_JOBS.filter((job) => byJob(job).length > 0).map((job) => ({ job })),
    ...failed
      .filter((component) => component.job === undefined)
      .map((component) => ({ name: component.name })),
  ];
  const first = jobs[0];
  const firstFailed = first && 'job' in first ? byJob(first.job)[0] : failed[0];
  return {
    ran,
    jobs,
    reason: reasonOf(firstFailed?.error),
    ...(first && 'job' in first ? { job: first.job } : {}),
  };
}

/** Lists past this many name two and "N more", so the title fits a notification's line. */
const LISTED = 3;

/** The notification's title and body for a stop, in the app's language. */
export function stopNotice(
  i18n: Pick<I18n, '_' | 'locale'>,
  stop: DownloadsStop,
): { readonly title: string; readonly body: string } {
  const body = i18n._(DOWNLOADS_STOP_REASONS[stop.reason]);
  if (stop.jobs.length === 0) return { title: i18n._(DOWNLOADS_STOPPED_MESSAGES.everything), body };
  const names = stop.jobs.map((each) => ('job' in each ? i18n._(DOWNLOAD_JOB_NAMES[each.job]) : each.name));
  const shown =
    names.length > LISTED
      ? [
          ...names.slice(0, LISTED - 1),
          i18n._({ ...DOWNLOADS_STOPPED_MESSAGES.more, values: { count: names.length - (LISTED - 1) } }),
        ]
      : names;
  const jobs = new Intl.ListFormat(i18n.locale, { type: 'conjunction', style: 'long' }).format(shown);
  return { title: i18n._({ ...DOWNLOADS_STOPPED_MESSAGES.jobs, values: { jobs } }), body };
}
