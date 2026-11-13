// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The jobs process's handlers for the templates kinds. The sandbox here is in
 * exec mode (children start in this process); the analysers are the media,
 * vision and audio functions the jobs root wires. A failed breakdown discards
 * its experiment, and so does a fetch once its failure is final; a cancelled
 * one may be a pause, so the agent's tool discards on cancel and the jobs
 * process's sweep (start and hourly) catches the rest. A fetched reel that
 * becomes a template is kept with it (REF1, tools/keep-media.ts).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import {
  CancelledError,
  err,
  ok,
  registerJob,
  type AsyncResult,
  type Clock,
  type ComponentInstallerPort,
  type ExperimentId,
  type ExperimentSandbox,
  type JobRegistration,
} from '@taalcut/core';
import type { BreakdownConfig } from '../breakdown/config';
import type { BreakdownAnalysers } from '../breakdown/ports';
import { runBreakdown } from '../breakdown/run-breakdown';
import { ExperimentGone } from '../errors';
import { createReferenceFetcher, createSourceFetcher } from '../intake/fetcher';
import { discardExperiment } from '../tools/discard';
import {
  sourceFetchJob,
  templatesBreakdownJob,
  templatesFetchReferenceJob,
  type BreakdownJobInput,
} from './kinds';

/**
 * What the fetch leaves beside the download, so the breakdown knows where it came from and finalise how it came
 * (REF1). For a person's own file, the breakdown tool writes it with the file's path.
 */
export const FETCH_FILE = 'fetch.json';

export interface TemplateJobDeps {
  readonly sandbox: ExperimentSandbox;
  readonly components: ComponentInstallerPort;
  readonly analysers: BreakdownAnalysers;
  readonly clock: Clock;
  readonly config?: BreakdownConfig;
  readonly log?: (message: string) => void;
}

async function experimentDir(sandbox: ExperimentSandbox, id: string): AsyncResult<string> {
  const experiment = await sandbox.get(id as ExperimentId);
  return experiment.ok
    ? ok(experiment.value.dir)
    : err(ExperimentGone(undefined, { detail: experiment.error.code }));
}

/** The reference's absolute path: inside the experiment for a download, the user's file as is. */
export function referencePath(dir: string, reference: BreakdownJobInput['reference']): string | null {
  if (reference.kind === 'file') return isAbsolute(reference.path) ? reference.path : null;
  const path = join(dir, reference.path);
  const inside = relative(dir, path);
  return inside && !inside.startsWith('..') && !isAbsolute(inside) ? path : null;
}

export function createTemplateJobs(deps: TemplateJobDeps): JobRegistration[] {
  /** A refused discard is logged; the experiment keeps its manifest, so the hourly sweep retries it once expired. */
  const discardAfterFailure = async (experimentId: string, what: string) => {
    const discarded = await discardExperiment(deps.sandbox, experimentId as ExperimentId);
    if (!discarded.ok)
      (deps.log ?? console.warn)(`[templates] discard after ${what} failure: ${discarded.error.code}`);
  };

  const fetcher = createReferenceFetcher({
    sandbox: deps.sandbox,
    components: deps.components,
    probe: (path, options) => deps.analysers.media.probe(path, options),
    ...(deps.config ? { maxSeconds: deps.config.reference.maxSeconds } : {}),
  });

  const fetchReference = registerJob(templatesFetchReferenceJob, async (input, context) => {
    const fetched = await fetcher.fetch(
      { experimentId: input.experimentId as ExperimentId, url: input.url },
      { signal: context.signal, progress: (progress) => context.progress(progress) },
    );
    if (!fetched.ok) {
      // Once no attempt is left, whatever the fetch wrote goes, even if the tool that asked has died. A
      // retryable failure keeps it for the engine's next attempt; a cancel may be a pause.
      const final =
        !fetched.error.retryable || context.attempt >= templatesFetchReferenceJob.retry.maxAttempts;
      if (final && !CancelledError.is(fetched.error)) await discardAfterFailure(input.experimentId, 'fetch');
      return fetched;
    }
    const dir = await experimentDir(deps.sandbox, input.experimentId);
    if (!dir.ok) return dir;
    const { url, platform, sound, source, hasAudio } = fetched.value;
    await writeFile(join(dir.value, FETCH_FILE), JSON.stringify({ url, platform, sound, source, hasAudio }));
    return ok(fetched.value);
  });

  const breakdown = registerJob(templatesBreakdownJob, async (input, context) => {
    const dir = await experimentDir(deps.sandbox, input.experimentId);
    if (!dir.ok) return dir;
    const path = referencePath(dir.value, input.reference);
    if (!path) return err(ExperimentGone(undefined, { detail: 'the reference is not where it should be' }));
    const result = await runBreakdown(
      {
        breakdownId: input.experimentId,
        referencePath: path,
        input: input.input,
        platform: input.platform,
        url: input.url,
        sound: input.sound,
        fingerprint: input.fingerprint,
      },
      {
        ...deps.analysers,
        experimentDir: dir.value,
        clock: deps.clock,
        ...(deps.config ? { config: deps.config } : {}),
        ...(deps.log ? { log: deps.log } : {}),
      },
      { signal: context.signal, progress: (progress) => context.progress(progress) },
    );
    // Nothing of a failed breakdown stays. A user's own file is never touched.
    if (!result.ok && !CancelledError.is(result.error))
      await discardAfterFailure(input.experimentId, 'breakdown');
    return result;
  });

  const sourceFetcher = createSourceFetcher({
    sandbox: deps.sandbox,
    components: deps.components,
    probe: (path, options) => deps.analysers.media.probe(path, options),
  });
  const fetchSource = registerJob(sourceFetchJob, async (input, context) => {
    const result = await sourceFetcher.fetch(
      { experimentId: input.experimentId as ExperimentId, url: input.url },
      { signal: context.signal, progress: (progress) => context.progress(progress) },
    );
    if (!result.ok) {
      if (
        (!result.error.retryable || context.attempt >= sourceFetchJob.retry.maxAttempts) &&
        !CancelledError.is(result.error)
      )
        await discardAfterFailure(input.experimentId, 'source fetch');
      return result;
    }
    const dir = await experimentDir(deps.sandbox, input.experimentId);
    if (!dir.ok) return dir;
    await writeFile(join(dir.value, FETCH_FILE), JSON.stringify(result.value));
    return result;
  });

  return [fetchReference, breakdown, fetchSource];
}

/** The fetch's record of where the download came from, or nulls for a dropped file. */
export async function readFetchRecord(dir: string): Promise<{
  url: string | null;
  platform: BreakdownJobInput['platform'];
  sound: BreakdownJobInput['sound'];
}> {
  try {
    const record = JSON.parse(await readFile(join(dir, FETCH_FILE), 'utf8')) as {
      url?: string;
      platform?: BreakdownJobInput['platform'];
      sound?: BreakdownJobInput['sound'];
    };
    return { url: record.url ?? null, platform: record.platform ?? null, sound: record.sound ?? null };
  } catch {
    return { url: null, platform: null, sound: null };
  }
}

/** How the experiment's reel came (REF1): what finalise keeps it as. Nulls when the record is older or absent. */
export async function readKeepRecord(dir: string): Promise<{
  source: 'anonymous' | 'session' | 'file' | null;
  hasAudio: boolean | null;
  /** The person's own file, for a dropped file or a screen recording. */
  path: string | null;
}> {
  try {
    const record = JSON.parse(await readFile(join(dir, FETCH_FILE), 'utf8')) as Record<string, unknown>;
    const source = record.source;
    return {
      source: source === 'anonymous' || source === 'session' || source === 'file' ? source : null,
      hasAudio: typeof record.hasAudio === 'boolean' ? record.hasAudio : null,
      path: typeof record.path === 'string' && isAbsolute(record.path) ? record.path : null,
    };
  } catch {
    return { source: null, hasAudio: null, path: null };
  }
}
