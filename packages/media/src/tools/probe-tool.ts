// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `media.probe`: the agent tool over probeMedia (P1-G7). Read-only and local.
 * The model gets a short summary; the full ProbeResult is stored as a JSON
 * artifact and referenced, so it never floods the context.
 */
import { defineTool, defineToolModule, ok, type ToolModule } from '@taalcut/core';
import { fileFingerprint } from '../input';
import { MEDIA_STAGE_NOTES, mediaProbeJob } from '../jobs/kinds';
import { forwardJobProgress, type JobRunner } from '../jobs/runner';
import { probeInputSchema, probeOutputSchema } from './schemas';
import { describeProbeSummary, summariseProbe } from './summary';

export interface MediaToolDeps {
  /**
   * Runs the ffprobe step as a `media.probe` job: the jobs process's runner in
   * the app, `createDirectJobRunner(createMediaJobs(media))` in tests.
   */
  readonly jobs: JobRunner;
}

/** ffprobe has its own 30 s limit; the tool's is longer so the typed, retryable media.timeout wins. */
export const PROBE_TOOL_TIMEOUT_MS = 35_000;

export function createProbeTool(deps: MediaToolDeps) {
  return defineTool({
    name: 'media.probe',
    version: '1.0.0',
    description:
      'Reads a media file on this Mac and reports its duration, displayed resolution, rotation, exact frame rate ' +
      '(and whether it is variable), HDR format, bit depth, codecs, creation time and recording device. ' +
      'Use it before cutting, describing or importing a clip. Nothing leaves the device. ' +
      'Returns a summary; the full probe (every stream, colour data, chapters, tags) is in the `details` artifact.',
    summary: 'Reads duration, resolution, fps, HDR, rotation and codecs of a media file.',
    tags: ['ffprobe', 'metadata', 'video-info', 'duration', 'resolution', 'codec'],
    input: probeInputSchema,
    output: probeOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: PROBE_TOOL_TIMEOUT_MS,
    // Only retryable errors (media.timeout on a slow volume, media.spawn_failed) are retried.
    retry: { maxAttempts: 2, initialDelayMs: 500 },
    permission: { filesystem: { read: ['library', 'user-selected'] }, network: 'none' },
    // The executor caches by (tool, version, input), i.e. by path: keep it short, since a file can be
    // replaced in place. The idempotency key below also covers size and mtime within a run.
    cache: { ttlMs: 5 * 60_000 },
    idempotencyKey: (input) => fileFingerprint(input.path),
    summarize: (output) => describeProbeSummary(output.summary),
    run: async (input, ctx) => {
      const probed = await deps.jobs.run(
        mediaProbeJob,
        { path: input.path },
        {
          signal: ctx.signal,
          onProgress: forwardJobProgress((f, note) => ctx.reportProgress(f, note), {
            notes: MEDIA_STAGE_NOTES,
          }),
        },
      );
      if (!probed.ok) return probed;
      const summary = summariseProbe(probed.value);
      const stored = await ctx.artifacts.put({
        mediaType: 'application/json',
        data: JSON.stringify(probed.value),
        // No file name or tags here: artifact summaries reach the model without untrusted-data wrapping.
        summary: `Full ffprobe result (all streams, colour, chapters, tags): ${describeProbeSummary(summary)}`,
      });
      // Without an artifact store the summary still answers the question.
      return ok(stored.ok ? { summary, details: stored.value } : { summary });
    },
  });
}

/** The media tool module for the composition root's registry list. */
export function mediaToolModule(deps: MediaToolDeps): ToolModule {
  return defineToolModule({ id: 'media', tools: [createProbeTool(deps)] });
}
