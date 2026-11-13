// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Reference intake and breakdown tools (P2-T3, P2-T4). A link is checked and
 * fetched into a new experiment by the jobs process, without an account first
 * (REF1: no warning card, no acknowledgement). A dropped file is read in
 * place, never moved or deleted; finalise copies it into the template's media.
 * A failed or cancelled fetch or breakdown discards its experiment.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  defineTool,
  err,
  forwardJobProgress,
  NO_TOOL_RETRY,
  ok,
  ulidSchema,
  type ExperimentId,
  type JobId,
  type ProjectId,
  type TemplateId,
  type ToolContextBase,
} from '@taalcut/core';
import { z } from 'zod';
import { fileSha256 } from '../breakdown/fingerprint';
import { readGraphics } from '../breakdown/graphic-brief';
import { BREAKDOWN_FILE } from '../breakdown/draft';
import { describeStrips } from '../breakdown/looks';
import { judging } from '../breakdown/slot-context-disputes';
import { checkSceneText } from '../breakdown/text-check';
import { readProgress } from '../breakdown/slot-context-progress';
import { ExperimentGone } from '../errors';
import { analystSoundLine } from '../skills/analyst';
import { FETCH_FILE, readFetchRecord } from '../jobs/handlers';
import { templatesBreakdownJob, type BreakdownJobInput } from '../jobs/kinds';
import { sha256Hex } from '../store/change-key';
import type { DraftCache, TemplateToolDeps } from './deps';
import { discardExperiment, withDiscard } from './discard';
import { fetchIntoExperiment } from './fetch-job';
import { DOWNLOAD_FILE } from './keep-media';
import {
  breakdownIdInputSchema,
  breakdownInputSchema,
  breakdownOutputSchema,
  fetchReferenceInputSchema,
  fetchReferenceOutputSchema,
} from './schemas';

const MINUTE = 60_000;
/**
 * BRK1 looks and DSG1-READ graphics: the breakdown job's share of the tool's progress when the strips are described
 * and the graphics read after it; the strips take the next part, the graphics the last.
 */
const JOB_SHARE = 0.85;
const STRIPS_SHARE = 0.93;
const jobOptions = (ctx: ToolContextBase, projectId: string) => ({
  signal: ctx.signal,
  onProgress: forwardJobProgress(ctx.reportProgress),
  projectId: projectId as ProjectId,
});

export function fetchReferenceTool(deps: TemplateToolDeps) {
  return defineTool({
    name: 'templates.fetchReference',
    // 1.1.0 (REF1): no acknowledgement; without an account first; the reel is kept with its template.
    version: '1.1.0',
    summary: 'Downloads a pasted Shorts, Reels or TikTok link into a scratch experiment for breakdown.',
    // Short (LRN1-CTX): every turn of a step offered this tool carries its description.
    description:
      'Downloads a pasted Shorts, Reels or TikTok link (up to 720p, 3 minutes) for templates.breakdown. The ' +
      "template it becomes keeps the reel's video and music on this Mac.",
    tags: ['reference', 'download', 'link', 'reel', 'shorts', 'tiktok'],
    input: fetchReferenceInputSchema,
    output: fetchReferenceOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 6 * MINUTE,
    retry: NO_TOOL_RETRY,
    permission: { network: 'internet', filesystem: { write: ['scratch'] } },
    idempotencyKey: (input) => `${input.projectId}:${input.url}`,
    run: async (input, ctx) => {
      const done = await fetchIntoExperiment(deps, input.url, {
        signal: ctx.signal,
        onProgress: forwardJobProgress(ctx.reportProgress),
        projectId: input.projectId as ProjectId,
      });
      if (!done.ok) return done;
      const { experimentId, fetched } = done.value;
      return ok({
        experimentId,
        platform: fetched.platform,
        duration: fetched.duration,
        sound: fetched.sound,
      });
    },
  });
}

/** Which file of an experiment is the download (reference.<ext>). */
async function downloaded(deps: TemplateToolDeps, id: ExperimentId) {
  const files = await deps.sandbox.list(id);
  if (!files.ok) return err(ExperimentGone(undefined, { detail: files.error.code }));
  const file = files.value.find((item) => item.kind === 'file' && DOWNLOAD_FILE.test(item.path));
  return file ? ok(file.path) : err(ExperimentGone(undefined, { detail: 'no download in the experiment' }));
}

export function breakdownTool(deps: TemplateToolDeps, drafts: DraftCache) {
  return defineTool({
    name: 'templates.breakdown',
    // 3.0.0 (LRN1-CTX): the count of disputed cuts and the first to judge; templates.judgeCut hands out the rest.
    // 3.0.1: a shorter description (every turn a step is offered the tool carries it).
    // 3.1.0 (EAR1-C2): the summary ends with the reel's sound line when the breakdown heard it.
    version: '3.1.0',
    summary: 'Breaks a reference reel down: cuts by two methods, beats, text, speech, audio, contact sheet.',
    description:
      'Breaks a reference reel down on this Mac: cuts (two methods), beats, on-screen text, speech, loudness ' +
      'and a contact sheet. Returns how many cuts are disputed and the first to judge (next, with its frames ' +
      'before and after) for templates.judgeCut.',
    tags: ['breakdown', 'reference', 'cuts', 'beats', 'ocr', 'contact-sheet'],
    input: breakdownInputSchema,
    output: breakdownOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 15 * MINUTE,
    retry: NO_TOOL_RETRY,
    permission: { network: 'none', filesystem: { read: ['scratch', 'user-selected'], write: ['scratch'] } },
    idempotencyKey: (input) => `${input.projectId}:${input.experimentId ?? input.path}`,
    summarize: (output) => output.summary,
    run: async (input, ctx) => {
      let id: ExperimentId;
      let job: Omit<BreakdownJobInput, 'fingerprint'>;
      let path: string;
      if (input.path !== undefined) {
        id = deps.ids.experiment();
        const opened = await deps.sandbox.open({
          id,
          projectId: input.projectId as ProjectId,
          purpose: 'breakdown',
        });
        if (!opened.ok) return opened;
        path = input.path;
        // REF1: where the person's file is, so finalise copies it into the template's media.
        await writeFile(
          join(opened.value.dir, FETCH_FILE),
          JSON.stringify({ url: null, platform: null, sound: null, source: 'file', path }),
        );
        job = {
          experimentId: id,
          reference: { kind: 'file', path },
          input: input.screenRecording ? 'screenRecording' : 'file',
          platform: null,
          url: null,
          sound: null,
        };
      } else {
        id = input.experimentId as ExperimentId;
        const experiment = await deps.sandbox.get(id);
        if (!experiment.ok) return err(ExperimentGone(undefined, { detail: experiment.error.code }));
        const file = await downloaded(deps, id);
        if (!file.ok) return file;
        path = join(experiment.value.dir, file.value);
        const record = await readFetchRecord(experiment.value.dir);
        job = {
          experimentId: id,
          reference: { kind: 'scratch', path: file.value },
          input: 'link',
          ...record,
        };
      }
      const fingerprint = await fileSha256(path, ctx.signal);
      if (!fingerprint.ok)
        return err(withDiscard(fingerprint.error, await discardExperiment(deps.sandbox, id)));
      const options = {
        ...jobOptions(ctx, input.projectId),
        // BRK1 looks: the strips are described after the job, in the last part of the bar.
        ...(deps.describeStrip || deps.graphicModel
          ? { onProgress: forwardJobProgress(ctx.reportProgress, { to: JOB_SHARE }) }
          : {}),
        // The breakdown card shows the job (core's JobRunOptions.onEnqueued).
        onEnqueued: (jobId: JobId) => deps.breakdownJobs?.record(id, jobId),
      };
      let draft = await deps.jobs.run(
        templatesBreakdownJob,
        { ...job, fingerprint: fingerprint.value },
        options,
      );
      // The same reel again: an earlier draft comes back. Use it while its experiment exists, else analyse anew.
      if (draft.ok && draft.value.breakdownId !== id) {
        const earlier = await deps.sandbox.get(draft.value.breakdownId as ExperimentId);
        if (earlier.ok) {
          // This call's own copy of the reel goes; a copy left behind fails the call (call again to retry).
          const discarded = await discardExperiment(deps.sandbox, id);
          if (!discarded.ok) return discarded;
        } else
          draft = await deps.jobs.run(
            templatesBreakdownJob,
            { ...job, fingerprint: fingerprint.value },
            { ...options, idempotencyKey: sha256Hex(`${fingerprint.value}\n${id}`) },
          );
      }
      if (!draft.ok) return err(withDiscard(draft.error, await discardExperiment(deps.sandbox, id)));
      let value = draft.value;
      drafts.remember(value);
      const loaded = await drafts.load(value.breakdownId);
      if (!loaded.ok) return loaded;
      // BRK1 looks: every strip described here, so each slot's picture reaches the Analyst in its context.
      if (deps.describeStrip)
        await describeStrips(value, loaded.value.dir, deps.describeStrip, {
          signal: ctx.signal,
          onProgress: (fraction) =>
            ctx.reportProgress(JOB_SHARE + (STRIPS_SHARE - JOB_SHARE) * fraction, 'describing shots'),
        });
      // FIX-SIGN: text the evidence left unsure goes to the same on-device model, one question each.
      if (deps.describeStrip) {
        const checked = await checkSceneText(value, loaded.value.dir, deps.describeStrip, {
          signal: ctx.signal,
        });
        if (checked.draft !== value) {
          value = checked.draft;
          drafts.remember(value);
          await writeFile(join(loaded.value.dir, BREAKDOWN_FILE), JSON.stringify(value)).catch(
            () => undefined,
          );
        }
      }
      // DSG1-READ: each kept overlay read as design by a vision model; templates.finalise writes the briefs, with
      // the model that read them (graphics.json). The summary leaves the reading out: an on-device Analyst told of it
      // read the whole draft and ran out of context.
      if (deps.graphicModel) {
        await readGraphics(value, loaded.value.dir, deps.graphicModel, {
          signal: ctx.signal,
          onProgress: (fraction) =>
            ctx.reportProgress(STRIPS_SHARE + (1 - STRIPS_SHARE) * fraction, 'reading graphics'),
        });
      }
      const progress = await readProgress(loaded.value.dir);
      if (!progress.ok) return progress;
      const artifact = await ctx.artifacts.put({
        mediaType: 'application/json',
        data: JSON.stringify(value),
        // AGT1: the 9B on MLX read all 60 KB of it in pages and outgrew 32,768 tokens before writing a slot.
        summary:
          `The full breakdown draft of ${value.breakdownId}, only for checking a detail: don't read it all, ` +
          'templates.resolveCuts gives the slots a page at a time.',
      });
      // EAR1-C2: what the reel's sound does, when the breakdown heard it.
      const sound = analystSoundLine(value.audio.listening);
      const summary =
        `${value.cuts.length} cuts confirmed by both methods, ${value.disputes.length} disputed; ` +
        `${value.beatMap?.bpm ? `${value.beatMap.bpm} BPM` : 'no beat'}; ${value.text.length} text overlays; ` +
        `audio ${value.audio.kind}; ${value.duration.value} frames at ${value.canvas.rate.num}/${value.canvas.rate.den}.` +
        (sound ? ` ${sound}` : '');
      return ok({
        breakdownId: value.breakdownId,
        summary,
        cuts: value.cuts.length,
        disputes: value.disputes.length,
        // The same reel again keeps the verdicts already stored for it.
        ...judging(value, progress.value.verdicts, loaded.value.dir),
        warnings: value.warnings,
        ...(artifact.ok ? { draft: artifact.value } : {}),
      });
    },
  });
}

export function abandonBreakdownTool(deps: TemplateToolDeps, drafts: DraftCache) {
  return defineTool({
    name: 'templates.abandonBreakdown',
    // 1.0.1 (LRN1-CTX): a shorter description.
    version: '1.0.1',
    description: "Discards a breakdown that won't become a template, with its download and scratch files.",
    tags: ['breakdown', 'discard', 'scratch'],
    input: breakdownIdInputSchema,
    output: z.object({ freedBytes: z.int().nonnegative() }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: MINUTE,
    retry: NO_TOOL_RETRY,
    permission: { filesystem: { write: ['scratch'] } },
    run: async (input) => {
      // An unknown or already discarded breakdown frees 0 bytes; a discard the disk refused is the error.
      const discarded = await discardExperiment(deps.sandbox, input.breakdownId as ExperimentId);
      if (!discarded.ok) return discarded;
      drafts.forget(input.breakdownId);
      return ok({ freedBytes: discarded.value.freedBytes });
    },
  });
}

const referenceStatusInputSchema = z.object({
  breakdownId: ulidSchema('Experiment'),
  templateId: ulidSchema('Template').optional().describe('The template finalise made from it, if any'),
});

export function referenceStatusTool(deps: TemplateToolDeps, drafts: DraftCache) {
  return defineTool({
    name: 'templates.referenceStatus',
    // 2.0.0 (REF1): 'kept' once a template keeps the reel; a template id may be given.
    version: '2.0.0',
    summary: "Whether a breakdown's reel is in scratch, kept with its template, or gone.",
    description:
      "Where a breakdown's reel is: in scratch ('present'), kept with its template on this Mac ('kept', after " +
      "templates.finalise), or gone ('discarded', after templates.abandonBreakdown).",
    tags: ['reference', 'discard', 'check'],
    input: referenceStatusInputSchema,
    output: z.object({ status: z.enum(['present', 'kept', 'discarded']) }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: MINUTE,
    retry: NO_TOOL_RETRY,
    permission: { filesystem: { read: ['scratch', 'library'] } },
    run: async (input) => {
      const experiment = await deps.sandbox.get(input.breakdownId as ExperimentId);
      if (experiment.ok) return ok({ status: 'present' as const });
      const templateId =
        (input.templateId as TemplateId | undefined) ?? drafts.finalised?.(input.breakdownId);
      const kept = templateId && deps.media ? await deps.media.get(templateId) : null;
      return ok({ status: kept?.ok && kept.value ? ('kept' as const) : ('discarded' as const) });
    },
  });
}
