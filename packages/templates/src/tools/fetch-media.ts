// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * templates.fetchMedia (REF1): a template made before its reel was kept fetches its origin link again, without an
 * account first, and keeps the reel's video and music with it. The same function serves the router's
 * `templates.fetchMedia` (the template page's "Get the reel's video and music") and the agent's tool.
 */
import { join } from 'node:path';
import {
  defineTool,
  err,
  forwardJobProgress,
  NO_TOOL_RETRY,
  NotImplementedError,
  ok,
  TEMPLATE_MEDIA_SOURCES,
  ulidSchema,
  type AsyncResult,
  type JobProgress,
  type TemplateFetchMediaInput,
  type TemplateId,
  type TemplateMedia,
  type TemplateMediaStore,
  type TemplateSummary,
} from '@taalcut/core';
import { z } from 'zod';
import { NoOriginLink } from '../errors';
import type { TemplateToolDeps } from './deps';
import { discardExperiment, withDiscard } from './discard';
import { fetchIntoExperiment } from './fetch-job';
import { durationMs } from './keep-media';

export type MediaFetchDeps = Pick<
  TemplateToolDeps,
  'service' | 'sandbox' | 'jobs' | 'ids' | 'instagramCookies'
> & {
  readonly media: TemplateMediaStore;
};

export interface FetchedMedia {
  /** The template's summary, its `media` set. */
  readonly summary: TemplateSummary;
  readonly media: TemplateMedia;
  /** Whether the platform served the very file the template was made from (its fingerprint). */
  readonly sameFile: boolean;
}

/** Fetches the template's origin link into scratch, keeps the reel as its media, and discards the scratch. */
export async function fetchTemplateMedia(
  deps: MediaFetchDeps,
  templateId: TemplateId,
  options: { readonly signal: AbortSignal; readonly onProgress?: (progress: JobProgress) => void },
): AsyncResult<FetchedMedia> {
  const got = await deps.service.get({ templateId });
  if (!got.ok) return got;
  const { origin } = got.value.template;
  if (origin.kind !== 'reference' || !origin.url) return err(NoOriginLink());
  const done = await fetchIntoExperiment(deps, origin.url, {
    ...options,
    projectId: got.value.summary.projectId,
  });
  if (!done.ok) return done;
  const { experimentId, dir, fetched } = done.value;
  const kept = await deps.media.keep(templateId, {
    path: join(dir, fetched.file),
    mode: 'move',
    durationMs: durationMs(fetched.duration),
    // A jobs process from before REF1 reports neither; its fetch went out without an account.
    hasAudio: fetched.hasAudio ?? true,
    source: fetched.source ?? 'anonymous',
  });
  const discarded = await discardExperiment(deps.sandbox, experimentId);
  if (!kept.ok) return err(withDiscard(kept.error, discarded));
  const after = await deps.service.get({ templateId });
  const summary = after.ok ? after.value.summary : got.value.summary;
  return ok({
    summary: { ...summary, media: kept.value },
    media: kept.value,
    sameFile: kept.value.sha256 === origin.fingerprint,
  });
}

/** The router's `templates.fetchMedia` (TemplatesService.fetchMedia) over the same deps. */
export function templatesFetchMedia(deps: MediaFetchDeps) {
  return async (input: TemplateFetchMediaInput): AsyncResult<TemplateSummary> => {
    const fetched = await fetchTemplateMedia(deps, input.id, { signal: new AbortController().signal });
    return fetched.ok ? ok(fetched.value.summary) : fetched;
  };
}

const MINUTE = 60_000;

export function fetchMediaTool(
  deps: Omit<MediaFetchDeps, 'media'> & { readonly media?: TemplateMediaStore },
) {
  return defineTool({
    name: 'templates.fetchMedia',
    version: '1.0.0',
    summary: "Fetches a template's reel again from its link and keeps its video and music on this Mac.",
    description:
      "For a template without its reel's video and music (made before they were kept): downloads its link " +
      'again, without an account first, and keeps them with the template on this Mac.',
    tags: ['template', 'reference', 'download', 'music', 'reel'],
    input: z.object({ projectId: ulidSchema('Project'), templateId: ulidSchema('Template') }),
    output: z.object({
      templateId: ulidSchema('Template'),
      bytes: z.int().positive(),
      durationMs: z.int().positive(),
      hasAudio: z.boolean(),
      source: z.enum(TEMPLATE_MEDIA_SOURCES),
      /** False when the platform now serves a different file than the one analysed: say the beats may drift. */
      sameFile: z.boolean(),
    }),
    costClass: 'local',
    // Like templates.fetchReference: no template version changes (nothing to undo); a file is kept beside it.
    sideEffect: 'read',
    timeoutMs: 6 * MINUTE,
    retry: NO_TOOL_RETRY,
    permission: { network: 'internet', filesystem: { write: ['scratch', 'library'] } },
    run: async (input, ctx) => {
      const { media: store } = deps;
      if (!store) return err(NotImplementedError({ feature: 'templates.fetchMedia' }));
      const fetched = await fetchTemplateMedia({ ...deps, media: store }, input.templateId as TemplateId, {
        signal: ctx.signal,
        onProgress: forwardJobProgress(ctx.reportProgress),
      });
      if (!fetched.ok) return fetched;
      const { media, sameFile } = fetched.value;
      return ok({
        templateId: input.templateId,
        bytes: media.bytes,
        durationMs: media.durationMs,
        hasAudio: media.hasAudio,
        source: media.source,
        sameFile,
      });
    },
  });
}
