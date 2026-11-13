// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `templates.fetchMedia` as the renderer's fake serves it (REF1): a template made before REF1 fetches its origin
 * link again and keeps the reel as its media. Like the service it runs a `templates.fetchReference` job, so the
 * window sees `job.stateChanged` and `job.progress` (the downloader's stage, a fraction and an estimate) and then
 * `library.changed` for the template, and the answer is the summary with `media` set. `scenario` makes it fail:
 * 'failsOnce' (the download fails, then Try again works) or 'unavailable' (no downloader for this Mac).
 */
import {
  newId,
  NotFoundError,
  toRpcError,
  type EventBus,
  type Id,
  type JobState,
  type TaalcutError,
  type TemplateSummary,
} from '@taalcut/core';
import type { FakeTemplates } from './fake-templates';
import { keptMedia, originLink } from './template-lineage';

export const TEMPLATE_MEDIA_SCENARIOS = ['failsOnce', 'unavailable'] as const;
export type FakeTemplateMediaScenario = (typeof TEMPLATE_MEDIA_SCENARIOS)[number];

export interface FakeTemplateMediaOptions {
  readonly scenario?: FakeTemplateMediaScenario;
  /** Between the job's steps; 0 runs them at once (unit tests). */
  readonly tickMs?: number;
}

/** The job the service runs for a fetch, and its stage key (packages/templates' FETCH_STAGE_KEYS.fetching). */
const KIND = 'templates.fetchReference';
const FETCHING = 'jobs.stage.fetchingReference';

const failure = (code: string, retryable: boolean): TaalcutError => ({
  code,
  messageKey: `errors.${code}`,
  retryable,
});

export function readTemplateMediaScenario(value: unknown): FakeTemplateMediaScenario | undefined {
  return TEMPLATE_MEDIA_SCENARIOS.find((scenario) => scenario === value);
}

export function createFakeTemplateMedia(
  events: EventBus,
  templates: FakeTemplates,
  options: FakeTemplateMediaOptions = {},
) {
  const tick = options.tickMs ?? 450;
  let failed = false;
  const wait = () => (tick > 0 ? new Promise((resolve) => setTimeout(resolve, tick)) : Promise.resolve());

  return {
    async fetchMedia(id: Id<'Template'>): Promise<TemplateSummary> {
      const template = templates.template(id);
      if (!template) throw toRpcError(NotFoundError({ entity: 'template', id }));
      if (!originLink(template)) throw toRpcError(failure('templates.no_origin_link', false));

      const jobId = newId<'Job'>();
      let state: JobState | null = null;
      const move = (to: JobState, error?: TaalcutError) => {
        events.emit('job.stateChanged', {
          jobId,
          kind: KIND,
          projectId: null,
          from: state,
          to,
          attempt: 1,
          ...(error
            ? { error: { code: error.code, messageKey: error.messageKey, retryable: error.retryable } }
            : {}),
        });
        state = to;
      };
      const progress = (fraction: number, etaMs: number) =>
        events.emit('job.progress', {
          jobId,
          kind: KIND,
          projectId: null,
          progress: { fraction, stageKey: FETCHING, etaMs },
        });

      move('queued');
      await wait();
      move('running');
      progress(0, 6000);
      await wait();
      const error =
        options.scenario === 'unavailable'
          ? failure('templates.fetch_unavailable', false)
          : options.scenario === 'failsOnce' && !failed
            ? failure('templates.fetch_failed', true)
            : null;
      if (error) {
        failed = true;
        move('failed', error);
        throw toRpcError(error);
      }
      progress(0.45, 3000);
      await wait();
      progress(1, 0);
      const kept = templates.keepMedia(id, keptMedia(template, Date.now()));
      move('succeeded');
      if (!kept) throw toRpcError(NotFoundError({ entity: 'template', id }));
      return kept;
    },
  };
}
