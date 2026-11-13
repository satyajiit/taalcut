// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { COMPONENT_JOBS, type ComponentJob } from '@taalcut/core';

/**
 * UX2-DOWNLOADER: where main's "couldn't download" notification lands (core's DOWNLOADS_SHOW_ACTION). Settings ›
 * Models at `#downloads-speech` focuses that job's row; at `#downloads` it focuses the download as a whole (its
 * problem's fix when there is one).
 */
const ANCHOR = 'downloads';

export function downloadsAnchor(job: ComponentJob | undefined): string {
  return job ? `${ANCHOR}-${job}` : ANCHOR;
}

/** What an address's hash points at: a job's row, the whole download, or nothing of the download's. */
export function downloadsTarget(hash: string): { readonly job?: ComponentJob } | undefined {
  if (hash === ANCHOR) return {};
  const job = COMPONENT_JOBS.find((each) => hash === `${ANCHOR}-${each}`);
  return job ? { job } : undefined;
}

/** A job named by `ui.action`'s args (plain strings): one of the jobs, or none. */
export function jobArg(value: string | undefined): ComponentJob | undefined {
  return COMPONENT_JOBS.find((each) => each === value);
}
