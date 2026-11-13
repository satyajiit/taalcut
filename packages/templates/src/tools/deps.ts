// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the templates tools need in the agent process, and the breakdown
 * drafts they share: kept in memory once a breakdown returns, and read back
 * from the experiment's breakdown.json after a restart. A draft whose
 * experiment is gone can't be finalised (its frames and sheet went with it).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  err,
  ok,
  type AcknowledgementStore,
  type AsyncResult,
  type Clock,
  type ExperimentId,
  type ExperimentSandbox,
  type JobId,
  type JobRunner,
  type TemplateId,
  type TemplateMediaStore,
  type TemplateSearch,
  type TemplateStore,
} from '@taalcut/core';
import { BREAKDOWN_FILE, breakdownDraftSchema, type BreakdownDraft } from '../breakdown/draft';
import type { DescribeStrip } from '../breakdown/looks';
import type { GraphicModel } from '../breakdown/graphic-brief';
import { BreakdownNotFound, ExperimentGone } from '../errors';
import type { TemplateIds } from '../formats/plan-format';
import type { StyleProfiles } from '../profiles/style-profiles';
import type { TemplateService } from '../store/template-service';

export interface TemplateToolDeps {
  /** Job mode in the agent process: runs go to the jobs process; folders are read here. */
  readonly sandbox: ExperimentSandbox;
  readonly store: TemplateStore;
  readonly service: TemplateService;
  readonly jobs: JobRunner;
  /** Read by nothing since REF1 (the download warning went); kept so roots that pass it still compile. */
  readonly acknowledgements?: Pick<AcknowledgementStore, 'has'>;
  /**
   * REF1: where finalise keeps the reel's video and music, and templates.fetchMedia an older template's. Absent,
   * a template keeps none, and templates.fetchMedia answers core.not_implemented.
   */
  readonly media?: TemplateMediaStore;
  readonly clock: Clock;
  readonly ids: TemplateIds & { experiment(): ExperimentId };
  /** Where the breakdown's job id goes once it is enqueued, for the breakdown card (share it with the skill). */
  readonly breakdownJobs?: BreakdownJobLog;
  /** The library's template search (LRN1-TPL); without it there is no `templates.search` tool. */
  readonly search?: TemplateSearch;
  /** Style profiles (LRN1-STY); without them there are no `templates.styleProfile` and `useStyleProfile` tools. */
  readonly styleProfiles?: StyleProfiles;
  /** Optional Netscape cookies for authenticated Instagram Reels fetches; wiped immediately after fetch. */
  readonly instagramCookies?: () => AsyncResult<string | null>;
  /**
   * The context window (tokens) of the model the Analyst's prompts go to now: the smallest in the agent module's
   * chain, as the memory budget reads it (agent SPEC 33). It sizes templates.resolveCuts' pages
   * (`breakdown/slot-context-pages.ts`); absent or unknown, the smallest local window.
   */
  readonly contextWindow?: () => number | undefined;
  /**
   * BRK1: describes a slot's strip on this Mac (`breakdown/looks.ts` stripDescriber over vision's on-device models);
   * templates.breakdown describes every strip with it and templates.resolveCuts hands each slot its description.
   * Absent, or failing for a strip: the Analyst looks at that strip itself.
   */
  readonly describeStrip?: DescribeStrip;
  /**
   * DSG1-READ: one vision call over the app's model client (the chat's model when it sees images, on-device under
   * Local only). templates.breakdown reads each kept overlay's sheet with it (`breakdown/graphic-brief/`), and
   * templates.finalise writes the briefs on the template. Absent, or failing: briefs from the measured facts alone.
   */
  readonly graphicModel?: GraphicModel;
}

/**
 * The breakdown job of each experiment, as the job runner reported it
 * (JobRunOptions.onEnqueued): the tool records it, the Analyst's breakdown
 * card shows it. In memory only; after a restart the card has no job id.
 */
export interface BreakdownJobLog {
  record(breakdownId: string, jobId: JobId): void;
  get(breakdownId: string): JobId | undefined;
}

/** At most this many experiments are remembered; the oldest goes first. */
const JOB_LOG_SIZE = 100;

export function createBreakdownJobLog(): BreakdownJobLog {
  const jobs = new Map<string, JobId>();
  return {
    record(breakdownId, jobId) {
      jobs.delete(breakdownId);
      jobs.set(breakdownId, jobId);
      if (jobs.size > JOB_LOG_SIZE) jobs.delete(jobs.keys().next().value!);
    },
    get: (breakdownId) => jobs.get(breakdownId),
  };
}

export interface DraftCache {
  remember(draft: BreakdownDraft): void;
  load(breakdownId: string): AsyncResult<{ draft: BreakdownDraft; dir: string }>;
  forget(breakdownId: string): void;
  /** REF1: the template a finalised breakdown became, for templates.referenceStatus; in memory only. */
  finalised?(breakdownId: string, templateId?: TemplateId): TemplateId | undefined;
}

/** At most this many finalised breakdowns are remembered; the oldest goes first. */
const FINALISED_SIZE = 100;

export function createDraftCache(sandbox: ExperimentSandbox): DraftCache {
  const drafts = new Map<string, BreakdownDraft>();
  const templates = new Map<string, TemplateId>();
  return {
    remember: (draft) => void drafts.set(draft.breakdownId, draft),
    forget: (breakdownId) => void drafts.delete(breakdownId),
    finalised(breakdownId, templateId) {
      if (templateId) {
        templates.delete(breakdownId);
        templates.set(breakdownId, templateId);
        if (templates.size > FINALISED_SIZE) templates.delete(templates.keys().next().value!);
      }
      return templates.get(breakdownId);
    },
    async load(breakdownId) {
      const experiment = await sandbox.get(breakdownId as ExperimentId);
      if (!experiment.ok) {
        drafts.delete(breakdownId);
        return err(ExperimentGone(undefined, { detail: experiment.error.code }));
      }
      const cached = drafts.get(breakdownId);
      if (cached) return ok({ draft: cached, dir: experiment.value.dir });
      try {
        const text = await readFile(join(experiment.value.dir, BREAKDOWN_FILE), 'utf8');
        const draft = breakdownDraftSchema.parse(JSON.parse(text));
        drafts.set(breakdownId, draft);
        return ok({ draft, dir: experiment.value.dir });
      } catch (cause) {
        return err(BreakdownNotFound(undefined, { detail: String(cause).slice(0, 300) }));
      }
    },
  };
}
