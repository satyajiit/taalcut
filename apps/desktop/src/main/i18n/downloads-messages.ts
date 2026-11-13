// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The download notifications' texts (UX2-DOWNLOADER, components.downloads): "Taalcut is ready" when everything is
 * here, and one when the download stops with something the person has to deal with. Plain descriptors, as
 * render-messages.ts: main has no Lingui macros.
 */
import type { MessageDescriptor } from '@lingui/core';
import type { ComponentJob } from '@taalcut/core';

export const DOWNLOADS_NOTIFY_MESSAGES = {
  ready: {
    title: /*i18n*/ { id: 'notify.downloads.ready.title', message: 'Taalcut is ready' },
    body: /*i18n*/ {
      id: 'notify.downloads.ready.body',
      message: 'Everything this Mac needs has downloaded. Its models work offline from now on.',
    },
  },
} as const satisfies Record<string, { title: MessageDescriptor; body: MessageDescriptor }>;

/** Each job as the window's rows name it (the renderer's features/downloads/job-labels.ts says the same). */
export const DOWNLOAD_JOB_NAMES = {
  speech: /*i18n*/ { id: 'notify.downloads.job.speech', message: 'Speech' },
  search: /*i18n*/ { id: 'notify.downloads.job.search', message: 'Search' },
  text: /*i18n*/ { id: 'notify.downloads.job.text', message: 'Text in frames' },
  shots: /*i18n*/ { id: 'notify.downloads.job.shots', message: 'Shots' },
  beats: /*i18n*/ { id: 'notify.downloads.job.beats', message: 'Beats' },
  writing: /*i18n*/ { id: 'notify.downloads.job.writing', message: 'Writing' },
  titles: /*i18n*/ { id: 'notify.downloads.job.titles', message: 'Titles' },
  sounds: /*i18n*/ { id: 'notify.downloads.job.sounds', message: 'Sound effects' },
} as const satisfies Record<ComponentJob, MessageDescriptor>;

/**
 * The download stopped with something the person has to deal with. The title names the jobs left without their
 * models (`jobs` is a list in the app's language, "Speech and Search"; past three, two and "4 more"), or all of
 * them when the whole download couldn't go on; the body says why and what to do.
 */
export const DOWNLOADS_STOPPED_MESSAGES = {
  jobs: /*i18n*/ { id: 'notify.downloads.stopped.jobs', message: 'Couldn’t download the models for {jobs}' },
  everything: /*i18n*/ {
    id: 'notify.downloads.stopped.everything',
    message: 'Couldn’t download the models this Mac needs',
  },
  more: /*i18n*/ {
    id: 'notify.downloads.stopped.more',
    message: '{count, plural, one {# more} other {# more}}',
  },
} as const satisfies Record<string, MessageDescriptor>;

/** Why it stopped, by the kind of failure (downloads-stop.ts sorts the component manager's codes into these). */
export const DOWNLOADS_STOP_REASONS = {
  space: /*i18n*/ {
    id: 'notify.downloads.reason.space',
    message: 'This Mac doesn’t have enough free space for them. Free up some space, then try again.',
  },
  network: /*i18n*/ {
    id: 'notify.downloads.reason.network',
    message: 'The connection kept dropping. Check your internet connection, then try again.',
  },
  refused: /*i18n*/ {
    id: 'notify.downloads.reason.refused',
    message: 'The download server refused them. Try again later.',
  },
  different: /*i18n*/ {
    id: 'notify.downloads.reason.different',
    message: 'The server sent different files than the ones Taalcut expects. Try again later.',
  },
  install: /*i18n*/ {
    id: 'notify.downloads.reason.install',
    message: 'They downloaded but couldn’t be installed. Try again.',
  },
  manifest: /*i18n*/ {
    id: 'notify.downloads.reason.manifest',
    message: 'Taalcut couldn’t verify its list of models. Update Taalcut, then try again.',
  },
  other: /*i18n*/ {
    id: 'notify.downloads.reason.other',
    message: 'Settings › Models says why, with Try again.',
  },
} as const satisfies Record<string, MessageDescriptor>;
export type DownloadsStopReason = keyof typeof DOWNLOADS_STOP_REASONS;
