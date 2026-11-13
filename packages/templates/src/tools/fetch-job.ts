// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A reel fetched into a new experiment by the jobs process, for templates.fetchReference and templates.fetchMedia.
 * The jobs process has no Instagram session, so for an Instagram link the agent leaves the session's cookie file in
 * the experiment while the job runs; the fetcher reads it only when the anonymous try needs a login
 * (intake/fetch-login.ts), and it goes when the job ends, whatever happened.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  err,
  ok,
  type AsyncResult,
  type ExperimentId,
  type JobProgress,
  type ProjectId,
} from '@taalcut/core';
import { INSTAGRAM_COOKIES_FILE, removeCookieFile } from '../intake/fetch-login';
import { parseReferenceLink } from '../intake/reference-link';
import { templatesFetchReferenceJob, type FetchReferenceJobOutput } from '../jobs/kinds';
import type { TemplateToolDeps } from './deps';
import { discardExperiment, withDiscard } from './discard';

export interface FetchJobOptions {
  readonly signal: AbortSignal;
  readonly onProgress?: (progress: JobProgress) => void;
  readonly projectId: ProjectId | null;
}

/**
 * Opens an experiment and fetches the link into it. On failure the experiment is discarded; on success it is the
 * caller's (its download is `join(dir, output.file)`).
 */
export async function fetchIntoExperiment(
  deps: Pick<TemplateToolDeps, 'sandbox' | 'jobs' | 'ids' | 'instagramCookies'>,
  url: string,
  options: FetchJobOptions,
): AsyncResult<{
  readonly experimentId: ExperimentId;
  readonly dir: string;
  readonly fetched: FetchReferenceJobOutput;
}> {
  const link = parseReferenceLink(url);
  if (!link.ok) return link;
  const id = deps.ids.experiment();
  const opened = await deps.sandbox.open({ id, projectId: options.projectId, purpose: 'breakdown' });
  if (!opened.ok) return opened;
  let cookiesPath: string | null = null;
  if (link.value.platform === 'reels' && deps.instagramCookies) {
    const cookies = await deps.instagramCookies();
    if (cookies.ok && cookies.value) {
      cookiesPath = join(opened.value.dir, INSTAGRAM_COOKIES_FILE);
      await writeFile(cookiesPath, cookies.value, { encoding: 'utf8', mode: 0o600 });
    }
  }
  let fetched;
  try {
    fetched = await deps.jobs.run(
      templatesFetchReferenceJob,
      { experimentId: id, url: link.value.url },
      {
        signal: options.signal,
        ...(options.onProgress ? { onProgress: options.onProgress } : {}),
        projectId: options.projectId,
      },
    );
  } finally {
    if (cookiesPath) await removeCookieFile(cookiesPath);
  }
  if (!fetched.ok) return err(withDiscard(fetched.error, await discardExperiment(deps.sandbox, id)));
  return ok({ experimentId: id, dir: opened.value.dir, fetched: fetched.value });
}
