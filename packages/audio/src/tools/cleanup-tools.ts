// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `audio.analyzeCleanup` (SPEC P3.7, P3.9): makes sure each clip's asset on the timeline's video track has a
 * current speech cleanup analysis, running `audio.analyzeSpeech` in the jobs process where one is missing (a
 * current one is reused there). It returns counts only: the analyses stay in the media cache, where the timeline
 * lane's `timeline.planCleanup` reads them through SpeechCleanupSource. An asset with no transcript yet is listed
 * under `missing` (transcribe it first), not a failure.
 */
import {
  defineTool,
  forwardJobProgress,
  ulidSchema,
  ok,
  type AnyTool,
  type AssetId,
  type JobRunner,
  type TimelineStore,
} from '@taalcut/core';
import { z } from 'zod';
import { audioAnalyzeSpeechJob } from '../cleanup/analyze-job';
import { readTimeline } from '../commands/timeline-writes';
import { videoItems } from '../timeline/span';
import { inputKey } from './tool-keys';

export interface CleanupToolDeps {
  readonly jobs: JobRunner;
  readonly timelines: TimelineStore;
}

const counts = z.object({
  assetId: z.string(),
  fillers: z.int().nonnegative(),
  pauses: z.int().nonnegative(),
  retakes: z.int().nonnegative(),
  emphasis: z.int().nonnegative(),
  ambiguous: z
    .int()
    .nonnegative()
    .describe('Words like "like" or "so": reported, never removed automatically'),
});

const output = z.object({
  assets: z.array(counts),
  missing: z.array(z.string()).describe('Assets with no transcript yet: transcribe them, then analyse again'),
});

/** The distinct assets of the timeline's video clips, in order, optionally only these clips'. */
function clipAssets(
  timeline: Parameters<typeof videoItems>[0],
  clipIds: readonly string[] | undefined,
): AssetId[] {
  const only = clipIds ? new Set(clipIds) : null;
  const assets: AssetId[] = [];
  for (const item of videoItems(timeline)) {
    if (item.type !== 'clip' || (only && !only.has(item.id))) continue;
    if (!assets.includes(item.media.assetId)) assets.push(item.media.assetId);
  }
  return assets;
}

function analyzeCleanupTool(deps: CleanupToolDeps) {
  return defineTool({
    name: 'audio.analyzeCleanup',
    version: '1.0.0',
    description:
      "Finds fillers, pauses, retakes and emphasis in the speech of a timeline's clips (Silero voice activity on " +
      'this Mac and the stored transcripts), for timeline.planCleanup to cut. Returns counts per asset; assets ' +
      'with no transcript yet are listed as missing.',
    summary: "Finds fillers, pauses, retakes and emphasis in the speech of a timeline's clips.",
    tags: ['cleanup', 'talking-head', 'fillers', 'pauses', 'retakes', 'vad'],
    input: z.object({
      projectId: ulidSchema('Project'),
      timelineId: ulidSchema('Timeline'),
      clipIds: z.array(ulidSchema('TimelineItem')).min(1).max(200).optional(),
    }),
    output,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 600_000,
    retry: { maxAttempts: 2, initialDelayMs: 1000 },
    permission: { network: 'none', filesystem: { read: ['library'] } },
    idempotencyKey: (input) => inputKey('audio.analyzeCleanup', input),
    run: async (input, ctx) => {
      const timeline = await readTimeline(deps.timelines, input);
      if (!timeline.ok) return timeline;
      const assetIds = clipAssets(timeline.value, input.clipIds);
      const assets: z.input<typeof counts>[] = [];
      const missing: string[] = [];
      const share = 1 / Math.max(1, assetIds.length);
      for (const [i, assetId] of assetIds.entries()) {
        const done = await deps.jobs.run(
          audioAnalyzeSpeechJob,
          { assetId },
          {
            signal: ctx.signal,
            onProgress: forwardJobProgress(ctx.reportProgress, { from: i * share, to: (i + 1) * share }),
          },
        );
        if (!done.ok) {
          if (done.error.code === 'audio.no_transcript') missing.push(assetId);
          else return done;
          continue;
        }
        const { fillers, pauses, retakes, emphasis, ambiguous } = done.value;
        assets.push({ assetId, fillers, pauses, retakes, emphasis, ambiguous });
      }
      return ok({ assets, missing });
    },
  });
}

/** Audio's cleanup tools, for the agent root's `audio` module. */
export function cleanupTools(deps: CleanupToolDeps): AnyTool[] {
  return [analyzeCleanupTool(deps)];
}
